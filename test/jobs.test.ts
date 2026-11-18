import { describe, expect, it } from "vite-plus/test";
import { SqliteDb } from "../src/server/sqlite.ts";
import { JOB_TABLES, JobRunner, NonRetryableError, parseDuration } from "../src/worker/jobs.ts";

function freshDb(): SqliteDb {
	const db = new SqliteDb(":memory:");
	for (const sql of JOB_TABLES) db.raw.exec(sql);
	return db;
}

async function state(db: SqliteDb, id: string) {
	return db.prepare(`SELECT state, error FROM jobs WHERE id = ?`).bind(id).first<{ state: string; error: string }>();
}

describe("background jobs", () => {
	it("parses durations", () => {
		expect(parseDuration(250)).toBe(250);
		expect(parseDuration("20 seconds")).toBe(20_000);
		expect(parseDuration("6 minutes")).toBe(360_000);
		expect(parseDuration("1 day")).toBe(86_400_000);
		expect(() => parseDuration("bald")).toThrow();
	});

	it("retries failing steps and gives up on NonRetryableError", async () => {
		const db = freshDb();
		const runner = new JobRunner(db);
		let tries = 0;
		let fatal = 0;
		const q = runner.register<{ n: number }>("t", async ({ n }, step) => {
			const v = await step.do("flaky", { retries: { limit: 3, delay: 1, backoff: "constant" } }, async () => {
				if (++tries < 3) throw new Error("noch nicht");
				return n * 2;
			});
			expect(v).toBe(42);
			await step.do("fatal", { retries: { limit: 5, delay: 1 } }, async () => {
				fatal++;
				throw new NonRetryableError("kaputt");
			});
		});
		const { id } = await q.create({ params: { n: 21 } });
		await runner.idle();
		expect(tries).toBe(3);
		expect(fatal).toBe(1);
		expect(await state(db, id)).toEqual({ state: "failed", error: "kaputt" });
	});

	it("resumes after a restart and skips finished steps", async () => {
		const db = freshDb();
		const calls: string[] = [];
		// First process: step "a" finishes, then the process "dies" while sleeping.
		const first = new JobRunner(db);
		const q = first.register<null>("r", async (_p, step) => {
			await step.do("a", async () => {
				calls.push("a");
				return { ok: 1 };
			});
			await step.sleep("pause", "1 hour");
		});
		const { id } = await q.create({ params: null });
		await new Promise((r) => setTimeout(r, 30));
		expect(calls).toEqual(["a"]);
		expect((await state(db, id))?.state).toBe("running");

		// Second process with a shorter handler: "a" comes from the database, the job finishes.
		const second = new JobRunner(db);
		second.register<null>("r", async (_p, step) => {
			const a = await step.do("a", async () => {
				calls.push("a-again");
				return { ok: 2 };
			});
			calls.push(`a=${a.ok}`);
			await step.do("b", async () => void calls.push("b"));
		});
		expect(await second.resume()).toBe(1);
		await second.idle();
		expect(calls).toEqual(["a", "a=1", "b"]);
		expect((await state(db, id))?.state).toBe("done");
	});
});
