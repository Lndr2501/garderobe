// Durable background jobs. Every finished step is stored in the database, so after a restart a
// job continues where it stopped (finished steps are skipped, sleeps keep their wake-up time).
import type { Db } from "./platform.ts";

/** Throw inside a step to fail it right away, without retries. */
export class NonRetryableError extends Error {}

export interface StepConfig {
	retries?: { limit: number; delay: number | string; backoff?: "constant" | "linear" | "exponential" };
	timeout?: number | string;
}

export interface Step {
	do<T>(name: string, fn: () => Promise<T>): Promise<T>;
	do<T>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T>;
	sleep(name: string, duration: number | string): Promise<void>;
}

export interface JobQueue<P> {
	create(opts: { id?: string; params: P }): Promise<{ id: string }>;
}

export type JobHandler<P> = (params: P, step: Step) => Promise<void>;

const UNITS: Record<string, number> = { ms: 1, millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** 1500, "20 seconds", "6 minutes", "1 day" → milliseconds. */
export function parseDuration(v: number | string): number {
	if (typeof v === "number") return v;
	const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+?)s?$/i);
	const unit = m ? UNITS[m[2]!.toLowerCase()] : undefined;
	if (!m || !unit) throw new Error(`Unbekannte Dauer: ${v}`);
	return Number(m[1]) * unit;
}

/** setTimeout without the ~24.8 day limit. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const tick = (left: number) => {
			if (left <= 0) return resolve();
			const chunk = Math.min(left, 2 ** 31 - 1);
			// A sleeping job alone must not keep the process alive (the HTTP server does that).
			const timer = setTimeout(() => tick(left - chunk), chunk) as { unref?: () => void };
			timer.unref?.();
		};
		tick(ms);
	});
}

async function withTimeout<T>(p: Promise<T>, ms: number | undefined): Promise<T> {
	if (!ms) return p;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			p,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${Math.round(ms / 1000)} s`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export const JOB_TABLES = [
	`CREATE TABLE IF NOT EXISTS jobs (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		params TEXT NOT NULL,
		state TEXT NOT NULL,
		error TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS job_steps (
		job_id TEXT NOT NULL,
		name TEXT NOT NULL,
		output TEXT,
		PRIMARY KEY (job_id, name)
	)`,
];

export class JobRunner {
	private handlers = new Map<string, JobHandler<never>>();
	private active = new Set<string>();
	private waiting: string[] = [];
	private idleWaiters: (() => void)[] = [];

	constructor(
		private db: Db,
		private opts: { concurrency?: number; log?: (msg: string, err?: unknown) => void } = {},
	) {}

	register<P>(kind: string, handler: JobHandler<P>): JobQueue<P> {
		this.handlers.set(kind, handler as JobHandler<never>);
		return {
			create: async ({ id = crypto.randomUUID(), params }) => {
				const t = new Date().toISOString();
				await this.db
					.prepare(`INSERT INTO jobs (id, kind, params, state, error, created_at, updated_at) VALUES (?, ?, ?, 'queued', '', ?, ?)`)
					.bind(id, kind, JSON.stringify(params), t, t)
					.run();
				this.enqueue(id);
				return { id };
			},
		};
	}

	/**
	 * Picks up this runner's jobs (its registered kinds) that were queued or running when the process
	 * stopped. Drops old finished ones.
	 */
	async resume(): Promise<number> {
		const old = new Date(Date.now() - 7 * 86_400_000).toISOString();
		await this.db.batch([
			this.db.prepare(`DELETE FROM job_steps WHERE job_id IN (SELECT id FROM jobs WHERE state IN ('done', 'failed') AND updated_at < ?)`).bind(old),
			this.db.prepare(`DELETE FROM jobs WHERE state IN ('done', 'failed') AND updated_at < ?`).bind(old),
		]);
		const kinds = [...this.handlers.keys()];
		if (!kinds.length) return 0;
		const { results } = await this.db
			.prepare(`SELECT id FROM jobs WHERE state IN ('queued', 'running') AND kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY created_at`)
			.bind(...kinds)
			.all<{ id: string }>();
		for (const r of results) this.enqueue(r.id);
		return results.length;
	}

	/** Resolves once nothing runs or waits (used by tests). */
	idle(): Promise<void> {
		if (!this.active.size && !this.waiting.length) return Promise.resolve();
		return new Promise((resolve) => this.idleWaiters.push(resolve));
	}

	private enqueue(id: string): void {
		if (this.active.has(id) || this.waiting.includes(id)) return;
		this.waiting.push(id);
		this.pump();
	}

	private pump(): void {
		while (this.active.size < (this.opts.concurrency ?? 3) && this.waiting.length) {
			const id = this.waiting.shift()!;
			this.active.add(id);
			void this.execute(id).finally(() => {
				this.active.delete(id);
				this.pump();
				if (!this.active.size && !this.waiting.length) for (const w of this.idleWaiters.splice(0)) w();
			});
		}
	}

	private async setState(id: string, state: string, error = ""): Promise<void> {
		await this.db
			.prepare(`UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?`)
			.bind(state, error.slice(0, 500), new Date().toISOString(), id)
			.run();
	}

	private async execute(id: string): Promise<void> {
		try {
			const job = await this.db.prepare(`SELECT kind, params, state FROM jobs WHERE id = ?`).bind(id).first<{ kind: string; params: string; state: string }>();
			if (!job || job.state === "done" || job.state === "failed") return;
			const handler = this.handlers.get(job.kind);
			if (!handler) return await this.setState(id, "failed", `Unbekannter Job-Typ ${job.kind}`);
			await this.setState(id, "running");
			try {
				await handler(JSON.parse(job.params) as never, this.step(id));
				await this.setState(id, "done");
			} catch (err) {
				this.opts.log?.(`job ${job.kind} ${id} failed`, err);
				await this.setState(id, "failed", (err as Error).message ?? String(err));
			}
		} catch (err) {
			this.opts.log?.(`job ${id} crashed`, err);
		}
	}

	private step(jobId: string): Step {
		const db = this.db;
		const cached = (name: string) =>
			db.prepare(`SELECT output FROM job_steps WHERE job_id = ? AND name = ?`).bind(jobId, name).first<{ output: string | null }>();
		const store = (name: string, value: unknown) =>
			db.prepare(`INSERT OR REPLACE INTO job_steps (job_id, name, output) VALUES (?, ?, ?)`).bind(jobId, name, JSON.stringify(value ?? null)).run();

		const run = async <T>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T> => {
			const hit = await cached(name);
			if (hit) return JSON.parse(hit.output ?? "null") as T;
			const limit = config.retries?.limit ?? 0;
			const base = config.retries ? parseDuration(config.retries.delay) : 0;
			const timeout = config.timeout === undefined ? undefined : parseDuration(config.timeout);
			for (let attempt = 0; ; attempt++) {
				try {
					const out = await withTimeout(fn(), timeout);
					await store(name, out);
					return out;
				} catch (err) {
					if (err instanceof NonRetryableError || attempt >= limit) throw err;
					const backoff = config.retries?.backoff ?? "exponential";
					const wait = backoff === "constant" ? base : backoff === "linear" ? base * (attempt + 1) : base * 2 ** attempt;
					this.opts.log?.(`step ${name} of job ${jobId} failed, retry ${attempt + 1}/${limit} in ${Math.round(wait / 1000)} s`, err);
					await delay(wait);
				}
			}
		};

		return {
			do: (<T>(name: string, a: StepConfig | (() => Promise<T>), b?: () => Promise<T>) =>
				typeof a === "function" ? run(name, {}, a) : run(name, a, b!)) as Step["do"],
			sleep: async (name, duration) => {
				const hit = await cached(name);
				let until: number;
				if (hit) until = (JSON.parse(hit.output ?? "{}") as { until?: number }).until ?? 0;
				else {
					until = Date.now() + parseDuration(duration);
					await store(name, { until });
				}
				await delay(until - Date.now());
			},
		};
	}
}
