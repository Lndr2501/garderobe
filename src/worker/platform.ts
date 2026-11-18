// What the app needs from its runtime. Implemented for Node (SQLite + files) in src/server.

export interface DbRunResult {
	meta: { changes: number; last_row_id: number };
}

export interface DbStatement {
	bind(...values: unknown[]): DbStatement;
	/** First row (or one column of it), `null` when there is none. */
	first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<DbRunResult>;
}

export interface Db {
	prepare(sql: string): DbStatement;
	/** Runs all statements in one transaction. */
	batch(statements: DbStatement[]): Promise<DbRunResult[]>;
}

export interface StoredBlob {
	data: Uint8Array;
	type: string;
	/** Last write (ms since epoch). */
	t: number;
}

export interface BlobStore {
	put(key: string, data: ArrayBuffer | Uint8Array, type: string): Promise<void>;
	get(key: string): Promise<StoredBlob | null>;
	delete(key: string): Promise<void>;
	list(): Promise<{ key: string; t: number }[]>;
}

/** Keeps the process busy with work that may outlive the response. */
export interface Background {
	waitUntil(promise: Promise<unknown>): void;
}
