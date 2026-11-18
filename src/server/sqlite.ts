// Db (see src/worker/platform.ts) on top of Node's built-in SQLite.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Db, DbRunResult, DbStatement } from "../worker/platform.ts";

type SqlValue = null | number | bigint | string | Uint8Array;

function toSql(v: unknown): SqlValue {
	if (v === undefined || v === null) return null;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
	if (v instanceof Uint8Array) return v;
	if (v instanceof ArrayBuffer) return new Uint8Array(v);
	throw new TypeError(`Wert kann nicht gespeichert werden: ${typeof v}`);
}

class Statement implements DbStatement {
	constructor(
		private db: SqliteDb,
		private sql: string,
		private values: SqlValue[] = [],
	) {}

	bind(...values: unknown[]): DbStatement {
		return new Statement(this.db, this.sql, values.map(toSql));
	}

	async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
		const row = this.db.statement(this.sql).get(...this.values) as Record<string, unknown> | undefined;
		if (!row) return null;
		return (column ? (row[column] ?? null) : row) as T;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		return { results: this.db.statement(this.sql).all(...this.values) as T[] };
	}

	async run(): Promise<DbRunResult> {
		return this.runSync();
	}

	runSync(): DbRunResult {
		const r = this.db.statement(this.sql).run(...this.values);
		return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
	}
}

export class SqliteDb implements Db {
	readonly raw: DatabaseSync;
	private cache = new Map<string, StatementSync>();

	constructor(path: string) {
		this.raw = new DatabaseSync(path);
		this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
	}

	/** Cached prepared statement (SQLite re-prepares them itself after schema changes). */
	statement(sql: string): StatementSync {
		let s = this.cache.get(sql);
		if (!s) {
			s = this.raw.prepare(sql);
			if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
			this.cache.set(sql, s);
		}
		return s;
	}

	prepare(sql: string): DbStatement {
		return new Statement(this, sql);
	}

	async batch(statements: DbStatement[]): Promise<DbRunResult[]> {
		this.raw.exec("BEGIN");
		try {
			const out = statements.map((s) => (s as Statement).runSync());
			this.raw.exec("COMMIT");
			return out;
		} catch (err) {
			this.raw.exec("ROLLBACK");
			throw err;
		}
	}

	close(): void {
		this.raw.close();
	}
}
