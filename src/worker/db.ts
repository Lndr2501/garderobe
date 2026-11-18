import type { Item, Outfit, Trip, TryOn } from "../shared/types.ts";
import type { CategoryKey } from "../shared/taxonomy.ts";
import { JOB_TABLES } from "./jobs.ts";
import type { Db } from "./platform.ts";

/** Schema migrations, applied once per isolate on first request. */
const MIGRATIONS: string[][] = [
	[
		`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS items (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT 'other',
			subcategory TEXT NOT NULL DEFAULT '',
			colors TEXT NOT NULL DEFAULT '[]',
			color_hex TEXT NOT NULL DEFAULT '',
			material TEXT NOT NULL DEFAULT '',
			pattern TEXT NOT NULL DEFAULT '',
			fit TEXT NOT NULL DEFAULT '',
			style_tags TEXT NOT NULL DEFAULT '[]',
			seasons TEXT NOT NULL DEFAULT '[]',
			warmth INTEGER NOT NULL DEFAULT 3,
			formality INTEGER NOT NULL DEFAULT 2,
			waterproof INTEGER NOT NULL DEFAULT 0,
			brand TEXT NOT NULL DEFAULT '',
			size TEXT NOT NULL DEFAULT '',
			price REAL,
			purchased_at TEXT,
			notes TEXT NOT NULL DEFAULT '',
			image_front TEXT,
			thumb_front TEXT,
			image_back TEXT,
			thumb_back TEXT,
			favorite INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			needs_review INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS outfits (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			item_ids TEXT NOT NULL DEFAULT '[]',
			occasion TEXT NOT NULL DEFAULT '',
			favorite INTEGER NOT NULL DEFAULT 0,
			notes TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS wears (
			date TEXT NOT NULL,
			item_id TEXT NOT NULL,
			outfit_id TEXT,
			created_at TEXT NOT NULL,
			PRIMARY KEY (date, item_id)
		)`,
		`CREATE INDEX IF NOT EXISTS wears_item ON wears(item_id)`,
		`CREATE TABLE IF NOT EXISTS trips (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			destination TEXT NOT NULL DEFAULT '',
			lat REAL,
			lon REAL,
			start_date TEXT,
			end_date TEXT,
			activities TEXT NOT NULL DEFAULT '[]',
			entries TEXT NOT NULL DEFAULT '[]',
			weather TEXT,
			notes TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tryons (
			id TEXT PRIMARY KEY,
			item_ids TEXT NOT NULL DEFAULT '[]',
			image TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL)`,
	],
	[
		// Server-side AI recognition: state, fields the user set by hand, pending rotation.
		`ALTER TABLE items ADD COLUMN ai_state TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE items ADD COLUMN ai_error TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE items ADD COLUMN ai_image TEXT`,
		`ALTER TABLE items ADD COLUMN user_fields TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE items ADD COLUMN rotate INTEGER NOT NULL DEFAULT 0`,
	],
	// v3: self-hosted background jobs (replaces Cloudflare Workflows)
	JOB_TABLES,
	[
		// v4: AI studio pictures and the daily usage of metered image providers
		`ALTER TABLE items ADD COLUMN image_studio TEXT`,
		`ALTER TABLE items ADD COLUMN thumb_studio TEXT`,
		`ALTER TABLE items ADD COLUMN studio_state TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE items ADD COLUMN studio_error TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE items ADD COLUMN studio_raw TEXT`,
		`ALTER TABLE items ADD COLUMN studio_input TEXT`,
		`ALTER TABLE items ADD COLUMN studio_job TEXT`,
		`ALTER TABLE items ADD COLUMN prefer_original INTEGER NOT NULL DEFAULT 0`,
		`CREATE TABLE IF NOT EXISTS ai_usage (
			day TEXT NOT NULL,
			provider TEXT NOT NULL,
			neurons INTEGER NOT NULL DEFAULT 0,
			images INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (day, provider)
		)`,
	],
];

let migrated: Promise<void> | null = null;

export function ensureSchema(db: Db): Promise<void> {
	if (!migrated) {
		migrated = migrate(db).catch((err) => {
			migrated = null;
			throw err;
		});
	}
	return migrated;
}

async function migrate(db: Db): Promise<void> {
	await db.prepare(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
	const row = await db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first<{ value: string }>();
	const current = row ? Number(row.value) : 0;
	for (let v = current; v < MIGRATIONS.length; v++) {
		const stmts = MIGRATIONS[v]!.map((sql) => db.prepare(sql));
		stmts.push(
			db
				.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
				.bind(String(v + 1)),
		);
		await db.batch(stmts);
	}
}

export function now(): string {
	return new Date().toISOString();
}

export function newId(): string {
	return crypto.randomUUID();
}

function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== "string" || value === "") return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export interface ItemRow {
	id: string;
	name: string;
	category: string;
	subcategory: string;
	colors: string;
	color_hex: string;
	material: string;
	pattern: string;
	fit: string;
	style_tags: string;
	seasons: string;
	warmth: number;
	formality: number;
	waterproof: number;
	brand: string;
	size: string;
	price: number | null;
	purchased_at: string | null;
	notes: string;
	image_front: string | null;
	thumb_front: string | null;
	image_back: string | null;
	thumb_back: string | null;
	favorite: number;
	status: string;
	needs_review: number;
	ai_state?: string;
	ai_error?: string;
	ai_image?: string | null;
	user_fields?: string;
	rotate?: number;
	image_studio?: string | null;
	thumb_studio?: string | null;
	studio_state?: string;
	studio_error?: string;
	studio_raw?: string | null;
	studio_input?: string | null;
	prefer_original?: number;
	created_at: string;
	updated_at: string;
	wear_count?: number | null;
	last_worn?: string | null;
}

const STUDIO_STATES = ["queued", "waiting", "running", "raw", "done", "failed", "off"];

export function rowToItem(r: ItemRow): Item {
	return {
		id: r.id,
		name: r.name,
		category: r.category as CategoryKey,
		subcategory: r.subcategory,
		colors: parseJson<string[]>(r.colors, []),
		colorHex: r.color_hex,
		material: r.material,
		pattern: r.pattern,
		fit: r.fit,
		styleTags: parseJson<string[]>(r.style_tags, []),
		seasons: parseJson<string[]>(r.seasons, []),
		warmth: r.warmth,
		formality: r.formality,
		waterproof: r.waterproof === 1,
		brand: r.brand,
		size: r.size,
		price: r.price,
		purchasedAt: r.purchased_at,
		notes: r.notes,
		imageFront: r.image_front,
		thumbFront: r.thumb_front,
		imageBack: r.image_back,
		thumbBack: r.thumb_back,
		favorite: r.favorite === 1,
		status: r.status === "archived" ? "archived" : "active",
		needsReview: r.needs_review === 1,
		aiState: (["pending", "done", "failed"].includes(r.ai_state ?? "") ? r.ai_state : "") as Item["aiState"],
		aiError: r.ai_error ?? "",
		userFields: parseJson<string[]>(r.user_fields, []),
		rotate: r.rotate ?? 0,
		imageStudio: r.image_studio ?? null,
		thumbStudio: r.thumb_studio ?? null,
		studioState: (STUDIO_STATES.includes(r.studio_state ?? "") ? r.studio_state : "") as Item["studioState"],
		studioError: r.studio_error ?? "",
		studioRaw: r.studio_raw ?? null,
		preferOriginal: r.prefer_original === 1,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		wearCount: r.wear_count ?? 0,
		lastWorn: r.last_worn ?? null,
	};
}

/** API field → [column, encoder]. */
export const ITEM_COLUMNS: Record<string, [string, (v: unknown) => unknown]> = {
	name: ["name", (v) => v],
	category: ["category", (v) => v],
	subcategory: ["subcategory", (v) => v],
	colors: ["colors", (v) => JSON.stringify(v)],
	colorHex: ["color_hex", (v) => v],
	material: ["material", (v) => v],
	pattern: ["pattern", (v) => v],
	fit: ["fit", (v) => v],
	styleTags: ["style_tags", (v) => JSON.stringify(v)],
	seasons: ["seasons", (v) => JSON.stringify(v)],
	warmth: ["warmth", (v) => v],
	formality: ["formality", (v) => v],
	waterproof: ["waterproof", (v) => (v ? 1 : 0)],
	brand: ["brand", (v) => v],
	size: ["size", (v) => v],
	price: ["price", (v) => v],
	purchasedAt: ["purchased_at", (v) => v],
	notes: ["notes", (v) => v],
	imageFront: ["image_front", (v) => v],
	thumbFront: ["thumb_front", (v) => v],
	imageBack: ["image_back", (v) => v],
	thumbBack: ["thumb_back", (v) => v],
	favorite: ["favorite", (v) => (v ? 1 : 0)],
	status: ["status", (v) => v],
	needsReview: ["needs_review", (v) => (v ? 1 : 0)],
	rotate: ["rotate", (v) => v],
	preferOriginal: ["prefer_original", (v) => (v ? 1 : 0)],
};

export const ITEM_SELECT = `SELECT i.*, w.wear_count, w.last_worn FROM items i
	LEFT JOIN (SELECT item_id, COUNT(*) AS wear_count, MAX(date) AS last_worn FROM wears GROUP BY item_id) w
	ON w.item_id = i.id`;

export interface OutfitRow {
	id: string;
	name: string;
	item_ids: string;
	occasion: string;
	favorite: number;
	notes: string;
	created_at: string;
	updated_at: string;
}

export function rowToOutfit(r: OutfitRow): Outfit {
	return {
		id: r.id,
		name: r.name,
		itemIds: parseJson<string[]>(r.item_ids, []),
		occasion: r.occasion,
		favorite: r.favorite === 1,
		notes: r.notes,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

export interface TripRow {
	id: string;
	name: string;
	destination: string;
	lat: number | null;
	lon: number | null;
	start_date: string | null;
	end_date: string | null;
	activities: string;
	entries: string;
	weather: string | null;
	notes: string;
	created_at: string;
	updated_at: string;
}

export function rowToTrip(r: TripRow): Trip {
	return {
		id: r.id,
		name: r.name,
		destination: r.destination,
		lat: r.lat,
		lon: r.lon,
		startDate: r.start_date,
		endDate: r.end_date,
		activities: parseJson<string[]>(r.activities, []),
		entries: parseJson(r.entries, []),
		weather: parseJson(r.weather, null),
		notes: r.notes,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

export function rowToTryOn(r: { id: string; item_ids: string; image: string; created_at: string }): TryOn {
	return { id: r.id, itemIds: parseJson<string[]>(r.item_ids, []), image: r.image, createdAt: r.created_at };
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
	const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>();
	return row ? parseJson<T>(row.value, fallback) : fallback;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
	await db
		.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
		.bind(key, JSON.stringify(value))
		.run();
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
	const row = await db.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
	await db
		.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
		.bind(key, value)
		.run();
}

export async function listItems(db: Db, includeArchived = true): Promise<Item[]> {
	const sql = includeArchived ? `${ITEM_SELECT} ORDER BY i.created_at DESC` : `${ITEM_SELECT} WHERE i.status = 'active' ORDER BY i.created_at DESC`;
	const { results } = await db.prepare(sql).all<ItemRow>();
	return results.map(rowToItem);
}
