import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { pairingItems, packingList, similarItems, suggestOutfits, daysSince } from "../shared/rules.ts";
import type { AppSettings, Item, OutfitSuggestion, ShoppingCheckResult, Stats, TripWeatherDay, WearDay } from "../shared/types.ts";
import { CATEGORY_KEYS, COLOR_KEYS } from "../shared/taxonomy.ts";
import {
	AiError,
	aiConfigured,
	chatJson,
	chatStream,
	chatText,
	imageEdit,
	imageViaChat,
	listModels,
	normalizeBaseUrl,
	type ChatMessage,
} from "./ai.ts";
import {
	clearFailedLogins,
	createSession,
	getPasswordHash,
	loginBlocked,
	recordFailedLogin,
	rotateSessionSecret,
	SESSION_COOKIE,
	SESSION_DAYS,
	setPassword,
	verifyPassword,
	verifySession,
} from "./auth.ts";
import {
	ensureSchema,
	getSetting,
	ITEM_COLUMNS,
	ITEM_SELECT,
	listItems,
	newId,
	now,
	rowToItem,
	rowToOutfit,
	rowToTrip,
	rowToTryOn,
	setSetting,
	type ItemRow,
	type OutfitRow,
	type TripRow,
} from "./db.ts";
import {
	deleteImages,
	getImage,
	getImageBytes,
	isAllowedType,
	isValidKey,
	listImageKeys,
	MAX_IMAGE_BYTES,
	newImageKey,
	putImage,
} from "./images.ts";
import { chatSystemPrompt, packingPrompt, shoppingPrompt, suggestPrompt, tryOnPrompt } from "./prompts.ts";
import { isDate, isObj, sanitizeEntries, sanitizeItem, sanitizeOutfit, str } from "./validate.ts";
import { LOCKABLE, loadAi, startTagging, tagImage, type TagParams } from "./tagging.ts";

export { TagWorkflow } from "./tagging.ts";

export interface Bindings {
	DB: D1Database;
	IMAGES: KVNamespace;
	BUCKET?: R2Bucket;
	ALLOW_SETUP?: string;
	TAGGER?: Workflow<TagParams>;
}

type Ctx = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

app.onError((err, c) => {
	if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
	if (err instanceof AiError) return c.json({ error: err.message }, err.status as 502);
	console.error("unhandled", err);
	return c.json({ error: "Interner Fehler" }, 500);
});

app.use("/api/*", async (c, next) => {
	await ensureSchema(c.env.DB);
	await next();
	c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Referrer-Policy", "same-origin");
});

// CSRF protection: state-changing requests must come from our own origin.
app.use("/api/*", async (c, next) => {
	if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
		const origin = c.req.header("Origin");
		if (origin && origin !== new URL(c.req.url).origin) throw new HttpError(403, "Fremder Ursprung");
	}
	await next();
});

app.use("/api/*", async (c, next) => {
	const path = new URL(c.req.url).pathname;
	if (path.startsWith("/api/auth/") && path !== "/api/auth/password") return next();
	if (path === "/api/health") return next();
	const ok = await verifySession(c.env.DB, getCookie(c, SESSION_COOKIE));
	if (!ok) return c.json({ error: "Nicht angemeldet" }, 401);
	return next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

// ---------- Auth ----------

function setSessionCookie(c: Ctx, token: string) {
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === "https:",
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_DAYS * 86_400,
	});
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
	try {
		const b = await c.req.json();
		return isObj(b) ? b : {};
	} catch {
		throw new HttpError(400, "Ungültiger JSON-Body");
	}
}

app.get("/api/auth/status", async (c) => {
	const hash = await getPasswordHash(c.env.DB);
	const authenticated = await verifySession(c.env.DB, getCookie(c, SESSION_COOKIE));
	return c.json({ authenticated, setupRequired: !hash, setupAllowed: !hash && c.env.ALLOW_SETUP === "true" });
});

app.post("/api/auth/setup", async (c) => {
	const hash = await getPasswordHash(c.env.DB);
	if (hash || c.env.ALLOW_SETUP !== "true") throw new HttpError(403, "Einrichtung nicht erlaubt");
	const b = await body(c);
	const pw = typeof b.password === "string" ? b.password : "";
	if (pw.length < 8) throw new HttpError(400, "Passwort muss mindestens 8 Zeichen haben");
	await setPassword(c.env.DB, pw);
	setSessionCookie(c, await createSession(c.env.DB));
	return c.json({ ok: true });
});

app.post("/api/auth/login", async (c) => {
	const ip = c.req.header("cf-connecting-ip") ?? "local";
	if (await loginBlocked(c.env.DB, ip)) throw new HttpError(429, "Zu viele Versuche. Bitte 15 Minuten warten.");
	const b = await body(c);
	const pw = typeof b.password === "string" ? b.password : "";
	const hash = await getPasswordHash(c.env.DB);
	if (!hash || !pw || !(await verifyPassword(pw, hash))) {
		await recordFailedLogin(c.env.DB, ip);
		throw new HttpError(401, "Falsches Passwort");
	}
	await clearFailedLogins(c.env.DB, ip);
	setSessionCookie(c, await createSession(c.env.DB));
	return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
	return c.json({ ok: true });
});

app.post("/api/auth/password", async (c) => {
	const b = await body(c);
	const current = typeof b.current === "string" ? b.current : "";
	const next = typeof b.next === "string" ? b.next : "";
	const hash = await getPasswordHash(c.env.DB);
	if (!hash || !(await verifyPassword(current, hash))) throw new HttpError(401, "Aktuelles Passwort stimmt nicht");
	if (next.length < 8) throw new HttpError(400, "Neues Passwort muss mindestens 8 Zeichen haben");
	await setPassword(c.env.DB, next);
	await rotateSessionSecret(c.env.DB);
	setSessionCookie(c, await createSession(c.env.DB));
	return c.json({ ok: true });
});

// ---------- Images ----------

app.post("/api/images", async (c) => {
	const form = await c.req.formData().catch(() => null);
	const file = form?.get("file");
	if (!file || typeof file === "string") throw new HttpError(400, "Datei fehlt");
	if (!isAllowedType(file.type)) throw new HttpError(415, "Bildformat nicht unterstützt");
	if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Bild zu groß (max. 12 MB)");
	const key = newImageKey(file.type);
	await putImage(c.env, key, await file.arrayBuffer(), file.type);
	return c.json({ key });
});

app.get("/api/img/:prefix/:file", async (c) => {
	const key = `${c.req.param("prefix")}/${c.req.param("file")}`;
	if (!isValidKey(key)) return c.json({ error: "Ungültiger Schlüssel" }, 400);
	const img = await getImage(c.env, key);
	if (!img) return c.json({ error: "Nicht gefunden" }, 404);
	return new Response(img.body, {
		headers: {
			"Content-Type": img.type,
			"Cache-Control": "private, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
		},
	});
});

// ---------- Items ----------

app.get("/api/items", async (c) => c.json(await listItems(c.env.DB)));

async function getItem(db: D1Database, id: string): Promise<Item> {
	const row = await db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first<ItemRow>();
	if (!row) throw new HttpError(404, "Teil nicht gefunden");
	return rowToItem(row);
}

app.get("/api/items/:id", async (c) => c.json(await getItem(c.env.DB, c.req.param("id"))));

/** Field names the client says the user set by hand (only lockable ones). */
function lockList(raw: unknown): string[] {
	return Array.isArray(raw) ? [...new Set(raw.filter((k): k is string => typeof k === "string" && LOCKABLE.has(k)))] : [];
}

/** A freshly uploaded AI helper image (JPEG) – must exist and be a valid key. */
function aiImageKey(raw: unknown): string | undefined {
	return typeof raw === "string" && isValidKey(raw) ? raw : undefined;
}

app.post("/api/items", async (c) => {
	const b = await body(c);
	const input = sanitizeItem(b);
	const id = newId();
	const t = now();
	const lock = lockList(b.lock);
	const cols = ["id", "created_at", "updated_at", "user_fields"];
	const vals: unknown[] = [id, t, t, JSON.stringify(lock)];
	if (!input.category) input.category = "other";
	for (const [k, v] of Object.entries(input)) {
		const def = ITEM_COLUMNS[k];
		if (!def) continue;
		cols.push(def[0]);
		vals.push(def[1](v));
	}
	await c.env.DB.prepare(`INSERT INTO items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
		.bind(...vals)
		.run();
	const aiImage = aiImageKey(b.aiImage);
	if (aiImage) {
		if (aiConfigured(await loadAi(c.env.DB))) await startTagging(c.env, { itemId: id, aiImage, colorHint: str(b.colorHint, 40) });
		else c.executionCtx.waitUntil(deleteImages(c.env, [aiImage]));
	}
	return c.json(await getItem(c.env.DB, id), 201);
});

/** Runs the AI recognition again (or for the first time) with a fresh helper image from the client. */
app.post("/api/items/:id/retag", async (c) => {
	const id = c.req.param("id");
	await getItem(c.env.DB, id);
	const b = await body(c);
	const aiImage = aiImageKey(b.aiImage);
	if (!aiImage) throw new HttpError(400, "Bild für die Erkennung fehlt");
	if (!aiConfigured(await loadAi(c.env.DB))) {
		c.executionCtx.waitUntil(deleteImages(c.env, [aiImage]));
		throw new HttpError(400, "Keine KI eingerichtet (Einstellungen → KI).");
	}
	// "Neu erkennen" means: let the AI decide again, also over fields the user had set.
	if (b.unlock === true) await c.env.DB.prepare(`UPDATE items SET user_fields = '[]' WHERE id = ?`).bind(id).run();
	await startTagging(c.env, { itemId: id, aiImage, colorHint: str(b.colorHint, 40) });
	return c.json(await getItem(c.env.DB, id));
});

app.patch("/api/items/:id", async (c) => {
	const id = c.req.param("id");
	const before = await getItem(c.env.DB, id);
	const b = await body(c);
	const input = sanitizeItem(b);
	const sets: string[] = [];
	const vals: unknown[] = [];
	const lock = lockList(b.lock);
	if (lock.length) {
		sets.push("user_fields = ?");
		vals.push(JSON.stringify([...new Set([...before.userFields, ...lock])]));
	}
	for (const [k, v] of Object.entries(input)) {
		const def = ITEM_COLUMNS[k];
		if (!def) continue;
		sets.push(`${def[0]} = ?`);
		vals.push(def[1](v));
	}
	if (sets.length) {
		sets.push("updated_at = ?");
		vals.push(now(), id);
		await c.env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
	}
	// Remove images that were replaced.
	const replaced = (["imageFront", "thumbFront", "imageBack", "thumbBack"] as const)
		.filter((k) => k in input && input[k] !== before[k])
		.map((k) => before[k]);
	c.executionCtx.waitUntil(deleteImages(c.env, replaced));
	return c.json(await getItem(c.env.DB, id));
});

app.delete("/api/items/:id", async (c) => {
	const id = c.req.param("id");
	const item = await getItem(c.env.DB, id);
	await c.env.DB.batch([
		c.env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(id),
		c.env.DB.prepare(`DELETE FROM wears WHERE item_id = ?`).bind(id),
	]);
	c.executionCtx.waitUntil(deleteImages(c.env, [item.imageFront, item.thumbFront, item.imageBack, item.thumbBack]));
	return c.json({ ok: true });
});

// ---------- Outfits ----------

app.get("/api/outfits", async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT * FROM outfits ORDER BY favorite DESC, updated_at DESC`).all<OutfitRow>();
	return c.json(results.map(rowToOutfit));
});

async function getOutfit(db: D1Database, id: string) {
	const row = await db.prepare(`SELECT * FROM outfits WHERE id = ?`).bind(id).first<OutfitRow>();
	if (!row) throw new HttpError(404, "Outfit nicht gefunden");
	return rowToOutfit(row);
}

app.post("/api/outfits", async (c) => {
	const o = sanitizeOutfit(await body(c));
	if (!o.itemIds?.length) throw new HttpError(400, "Outfit braucht mindestens ein Teil");
	const id = newId();
	const t = now();
	await c.env.DB.prepare(
		`INSERT INTO outfits (id, name, item_ids, occasion, favorite, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, o.name ?? "", JSON.stringify(o.itemIds), o.occasion ?? "", o.favorite ? 1 : 0, o.notes ?? "", t, t)
		.run();
	return c.json(await getOutfit(c.env.DB, id), 201);
});

app.patch("/api/outfits/:id", async (c) => {
	const id = c.req.param("id");
	const cur = await getOutfit(c.env.DB, id);
	const o = { ...cur, ...sanitizeOutfit(await body(c)) };
	await c.env.DB.prepare(`UPDATE outfits SET name = ?, item_ids = ?, occasion = ?, favorite = ?, notes = ?, updated_at = ? WHERE id = ?`)
		.bind(o.name, JSON.stringify(o.itemIds), o.occasion, o.favorite ? 1 : 0, o.notes, now(), id)
		.run();
	return c.json(await getOutfit(c.env.DB, id));
});

app.delete("/api/outfits/:id", async (c) => {
	await c.env.DB.prepare(`DELETE FROM outfits WHERE id = ?`).bind(c.req.param("id")).run();
	await c.env.DB.prepare(`UPDATE wears SET outfit_id = NULL WHERE outfit_id = ?`).bind(c.req.param("id")).run();
	return c.json({ ok: true });
});

// ---------- Wear log ----------

async function wearDays(db: D1Database, from: string, to: string): Promise<WearDay[]> {
	const { results } = await db
		.prepare(`SELECT date, item_id, outfit_id FROM wears WHERE date >= ? AND date <= ? ORDER BY date, created_at`)
		.bind(from, to)
		.all<{ date: string; item_id: string; outfit_id: string | null }>();
	const map = new Map<string, WearDay>();
	for (const r of results) {
		const d = map.get(r.date) ?? { date: r.date, itemIds: [], outfitId: null };
		d.itemIds.push(r.item_id);
		if (r.outfit_id) d.outfitId = r.outfit_id;
		map.set(r.date, d);
	}
	return [...map.values()];
}

app.get("/api/wears", async (c) => {
	const from = c.req.query("from") ?? "0000-01-01";
	const to = c.req.query("to") ?? "9999-12-31";
	if (!isDate(from) || !isDate(to)) throw new HttpError(400, "Ungültiges Datum");
	return c.json(await wearDays(c.env.DB, from, to));
});

app.put("/api/wears/:date", async (c) => {
	const date = c.req.param("date");
	if (!isDate(date)) throw new HttpError(400, "Ungültiges Datum");
	const b = await body(c);
	const ids = Array.isArray(b.itemIds) ? [...new Set(b.itemIds.filter((x): x is string => typeof x === "string"))].slice(0, 20) : [];
	const outfitId = typeof b.outfitId === "string" ? b.outfitId : null;
	const t = now();
	const stmts = [c.env.DB.prepare(`DELETE FROM wears WHERE date = ?`).bind(date)];
	for (const id of ids) {
		// INSERT … SELECT silently skips ids that don't belong to an existing item.
		stmts.push(
			c.env.DB.prepare(`INSERT INTO wears (date, item_id, outfit_id, created_at) SELECT ?, id, ?, ? FROM items WHERE id = ?`).bind(date, outfitId, t, id),
		);
	}
	await c.env.DB.batch(stmts);
	const [day] = await wearDays(c.env.DB, date, date);
	return c.json(day ?? { date, itemIds: [], outfitId: null });
});

// ---------- Stats ----------

app.get("/api/stats", async (c) => {
	const today = c.req.query("today");
	const ref = isDate(today) ? new Date(`${today}T12:00:00`) : new Date();
	const items = await listItems(c.env.DB);
	const { results: dates } = await c.env.DB.prepare(`SELECT DISTINCT date FROM wears ORDER BY date DESC`).all<{ date: string }>();
	const totalWears = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM wears`).first<{ n: number }>())?.n ?? 0;
	const active = items.filter((i) => i.status === "active");
	const wornRecently = active.filter((i) => {
		const d = daysSince(i.lastWorn, ref);
		return d !== null && d <= 30;
	}).length;
	const byCat = new Map<string, number>();
	const byColor = new Map<string, number>();
	for (const i of active) {
		byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
		const col = i.colors[0];
		if (col) byColor.set(col, (byColor.get(col) ?? 0) + 1);
	}
	const weekday = [0, 0, 0, 0, 0, 0, 0];
	for (const { date } of dates) weekday[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]!++;
	let streak = 0;
	const dateSet = new Set(dates.map((d) => d.date));
	const cursor = new Date(ref);
	if (!dateSet.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
	while (dateSet.has(cursor.toISOString().slice(0, 10))) {
		streak++;
		cursor.setDate(cursor.getDate() - 1);
	}
	const stats: Stats = {
		totalItems: active.length,
		archivedItems: items.length - active.length,
		totalValue: Math.round(active.reduce((s, i) => s + (i.price ?? 0), 0) * 100) / 100,
		wornThisMonthPct: active.length ? Math.round((wornRecently / active.length) * 100) : 0,
		totalWears,
		mostWorn: [...active]
			.filter((i) => i.wearCount > 0)
			.sort((a, b) => b.wearCount - a.wearCount)
			.slice(0, 5)
			.map((i) => ({ id: i.id, count: i.wearCount })),
		neglected: active
			.map((i) => {
				const never = !i.lastWorn;
				const days = never ? (daysSince(i.createdAt.slice(0, 10), ref) ?? 0) : (daysSince(i.lastWorn, ref) ?? 0);
				return { id: i.id, days, never };
			})
			.filter((x) => x.days >= 30)
			.sort((a, b) => b.days - a.days)
			.slice(0, 12),
		bestCostPerWear: active
			.filter((i) => i.price && i.wearCount > 0)
			.map((i) => ({ id: i.id, cpw: Math.round(((i.price ?? 0) / i.wearCount) * 100) / 100 }))
			.sort((a, b) => a.cpw - b.cpw)
			.slice(0, 5),
		byCategory: [...byCat.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
		byColor: [...byColor.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
		wearsByWeekday: weekday,
		streak,
	};
	return c.json(stats);
});

// ---------- Settings ----------

interface StoredSettings {
	name: string;
	location: AppSettings["location"];
	currency: string;
	bgRemoval: AppSettings["bgRemoval"];
	personPhoto: string | null;
}

const DEFAULT_SETTINGS: StoredSettings = {
	name: "",
	location: { name: "Bonn", lat: 50.7374, lon: 7.0982, useGeolocation: false },
	currency: "EUR",
	bgRemoval: { enabled: true, quality: "best" },
	personPhoto: null,
};

async function loadSettings(db: D1Database): Promise<AppSettings> {
	const s = { ...DEFAULT_SETTINGS, ...(await getSetting<Partial<StoredSettings>>(db, "app", {})) };
	const ai = await loadAi(db);
	return {
		...s,
		ai: {
			baseUrl: ai.baseUrl,
			model: ai.model,
			visionModel: ai.visionModel,
			imageModel: ai.imageModel,
			tryonMode: ai.tryonMode,
			jsonMode: ai.jsonMode,
			reasoning: ai.reasoning,
			hasKey: !!ai.apiKey,
			keyHint: ai.apiKey ? `…${ai.apiKey.slice(-4)}` : "",
			configured: aiConfigured(ai),
		},
	};
}

app.get("/api/settings", async (c) => c.json(await loadSettings(c.env.DB)));

app.patch("/api/settings", async (c) => {
	const b = await body(c);
	const cur = { ...DEFAULT_SETTINGS, ...(await getSetting<Partial<StoredSettings>>(c.env.DB, "app", {})) };
	const name = str(b.name, 40);
	if (name !== undefined) cur.name = name;
	if (isObj(b.location)) {
		const l = b.location;
		const lat = Number(l.lat);
		const lon = Number(l.lon);
		if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
			cur.location = { name: str(l.name, 80) ?? cur.location.name, lat, lon, useGeolocation: l.useGeolocation === true };
		} else if (typeof l.useGeolocation === "boolean") {
			cur.location = { ...cur.location, useGeolocation: l.useGeolocation };
		}
	}
	const currency = str(b.currency, 3);
	if (currency && /^[A-Z]{3}$/.test(currency)) cur.currency = currency;
	if (isObj(b.bgRemoval)) {
		cur.bgRemoval = {
			enabled: b.bgRemoval.enabled !== false,
			quality: b.bgRemoval.quality === "fast" ? "fast" : "best",
		};
	}
	if (b.personPhoto === null || (typeof b.personPhoto === "string" && isValidKey(b.personPhoto))) {
		if (cur.personPhoto && cur.personPhoto !== b.personPhoto) c.executionCtx.waitUntil(deleteImages(c.env, [cur.personPhoto]));
		cur.personPhoto = b.personPhoto as string | null;
	}
	await setSetting(c.env.DB, "app", cur);
	if (isObj(b.ai)) {
		const a = b.ai;
		const ai = await loadAi(c.env.DB);
		if (typeof a.baseUrl === "string") ai.baseUrl = a.baseUrl.trim() ? normalizeBaseUrl(a.baseUrl) : "";
		for (const k of ["model", "visionModel", "imageModel"] as const) {
			const v = str(a[k], 120);
			if (v !== undefined) ai[k] = v;
		}
		if (a.tryonMode === "edits" || a.tryonMode === "chat") ai.tryonMode = a.tryonMode;
		if (typeof a.jsonMode === "boolean") ai.jsonMode = a.jsonMode;
		if (typeof a.reasoning === "boolean") ai.reasoning = a.reasoning;
		if (typeof a.apiKey === "string" && a.apiKey.trim()) ai.apiKey = a.apiKey.trim().slice(0, 500);
		if (a.clearKey === true) ai.apiKey = "";
		await setSetting(c.env.DB, "ai", ai);
	}
	return c.json(await loadSettings(c.env.DB));
});

// ---------- AI ----------

app.get("/api/ai/models", async (c) => c.json({ models: await listModels(await loadAi(c.env.DB)) }));

app.post("/api/ai/test", async (c) => {
	const ai = await loadAi(c.env.DB);
	const result: { ok: boolean; models?: string[]; reply?: string; error?: string; modelsError?: string; ms?: number } = { ok: false };
	const [models, reply] = await Promise.allSettled([
		listModels(ai),
		(async () => {
			const t0 = Date.now();
			const text = await chatText(ai, [{ role: "user", content: "Antworte nur mit: Bereit!" }], { maxTokens: 400 });
			result.ms = Date.now() - t0;
			return text;
		})(),
	]);
	if (models.status === "fulfilled") result.models = models.value.slice(0, 200);
	else result.modelsError = (models.reason as Error).message;
	if (reply.status === "fulfilled") {
		result.reply = reply.value.slice(0, 200);
		result.ok = true;
	} else result.error = (reply.reason as Error).message;
	return c.json(result);
});

function dataUrlFrom(v: unknown): string {
	if (typeof v !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) throw new HttpError(400, "Bild fehlt");
	if (v.length > 8_000_000) throw new HttpError(413, "Bild zu groß");
	return v;
}

app.post("/api/ai/tag", async (c) => {
	const b = await body(c);
	const image = dataUrlFrom(b.image);
	const ai = await loadAi(c.env.DB);
	const { tags, rotate } = await tagImage(ai, image, str(b.colorHint, 40));
	return c.json({ ...tags, rotate });
});

function weatherText(w: Record<string, unknown>): string {
	const parts: string[] = [];
	if (typeof w.description === "string") parts.push(w.description);
	if (typeof w.temp === "number") parts.push(`${Math.round(w.temp)} °C`);
	if (typeof w.feelsLike === "number") parts.push(`gefühlt ${Math.round(w.feelsLike)} °C`);
	if (typeof w.tMin === "number" && typeof w.tMax === "number") parts.push(`Tagesspanne ${Math.round(w.tMin)}–${Math.round(w.tMax)} °C`);
	if (typeof w.precipProb === "number") parts.push(`Regenrisiko ${Math.round(w.precipProb)} %`);
	if (typeof w.wind === "number") parts.push(`Wind ${Math.round(w.wind)} km/h`);
	if (typeof w.place === "string") parts.push(`in ${w.place}`);
	return parts.join(", ") || "unbekannt";
}

async function recentWearText(db: D1Database, items: Item[]): Promise<string> {
	const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
	const days = await wearDays(db, since, "9999-12-31");
	const name = new Map(items.map((i) => [i.id, i.name]));
	return days.map((d) => `${d.date}: ${d.itemIds.map((id) => name.get(id) ?? id).join(", ")}`).join("; ");
}

app.post("/api/ai/suggest", async (c) => {
	const b = await body(c);
	const weather = isObj(b.weather) ? b.weather : {};
	const feelsLike = typeof weather.feelsLike === "number" ? weather.feelsLike : typeof weather.temp === "number" ? weather.temp : 15;
	const occasion = str(b.occasion, 120) ?? "";
	const items = (await listItems(c.env.DB)).filter((i) => i.status === "active");
	const ids = new Set(items.map((i) => i.id));
	const ai = await loadAi(c.env.DB);
	let aiError: string | undefined;
	if (b.useAi !== false && aiConfigured(ai) && items.length >= 2) {
		try {
			const date = str(b.date, 40) ?? new Date().toISOString().slice(0, 10);
			const prompt = suggestPrompt(items, weatherText(weather), occasion, await recentWearText(c.env.DB, items), date);
			const res = await chatJson<{ outfits?: { name?: string; itemIds?: string[]; reason?: string }[] }>(
				ai,
				[{ role: "user", content: prompt }],
				{ temperature: 0.7, maxTokens: 2500 },
			);
			const suggestions: OutfitSuggestion[] = (res.outfits ?? [])
				.map((o) => ({
					name: str(o.name, 60) || "Outfit",
					itemIds: (o.itemIds ?? []).filter((id) => ids.has(id)),
					reason: str(o.reason, 200) ?? "",
					source: "ai" as const,
				}))
				.filter((o) => o.itemIds.length >= 1)
				.slice(0, 3);
			if (suggestions.length) return c.json({ suggestions, source: "ai" });
			aiError = "KI hat keine gültigen Outfits geliefert";
		} catch (err) {
			aiError = (err as Error).message;
		}
	}
	const suggestions = suggestOutfits(items, {
		weather: {
			feelsLike,
			precipProb: typeof weather.precipProb === "number" ? weather.precipProb : 0,
		},
		occasion,
		seed: typeof b.seed === "string" ? b.seed : undefined,
	});
	return c.json({ suggestions, source: "rules", aiError });
});

app.post("/api/ai/chat", async (c) => {
	const b = await body(c);
	const raw = Array.isArray(b.messages) ? b.messages : [];
	const messages: ChatMessage[] = raw
		.filter((m): m is { role: string; content: string } => isObj(m) && typeof m.content === "string")
		.filter((m) => m.role === "user" || m.role === "assistant")
		.slice(-20)
		.map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
	if (!messages.length || messages[messages.length - 1]!.role !== "user") throw new HttpError(400, "Nachricht fehlt");
	const ai = await loadAi(c.env.DB);
	const items = await listItems(c.env.DB);
	const settings = await loadSettings(c.env.DB);
	const context = [str(b.context, 600) ?? "", `Zuletzt getragen: ${await recentWearText(c.env.DB, items)}`].join(" ");
	const image = typeof b.image === "string" ? dataUrlFrom(b.image) : null;
	if (image) {
		const last = messages[messages.length - 1]!;
		last.content = [
			{ type: "text", text: last.content as string },
			{ type: "image_url", image_url: { url: image, detail: "low" } },
		];
	}
	const stream = await chatStream(ai, [{ role: "system", content: chatSystemPrompt(items, context, settings.name) }, ...messages], {
		temperature: 0.6,
		model: image ? ai.visionModel || ai.model : ai.model,
	});
	return new Response(stream, {
		headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
	});
});

app.post("/api/ai/shopping", async (c) => {
	const b = await body(c);
	const items = (await listItems(c.env.DB)).filter((i) => i.status === "active");
	const ids = new Set(items.map((i) => i.id));
	const ai = await loadAi(c.env.DB);
	const note = str(b.note, 300) ?? "";
	if (typeof b.image === "string" && aiConfigured(ai)) {
		const image = dataUrlFrom(b.image);
		const raw = await chatJson<Record<string, unknown>>(
			ai,
			[
				{
					role: "user",
					content: [
						{ type: "text", text: shoppingPrompt(items, note ? `Hinweis der Person: ${note}` : "") },
						{ type: "image_url", image_url: { url: image, detail: "low" } },
					],
				},
			],
			{ model: ai.visionModel || ai.model, temperature: 0.3, maxTokens: 2000 },
		);
		const clean = sanitizeItem(raw);
		const idList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ids.has(x)) : []);
		const verdict = raw.verdict === "kaufen" || raw.verdict === "lassen" ? raw.verdict : "überlegen";
		const result: ShoppingCheckResult = {
			name: clean.name ?? "Neues Teil",
			category: clean.category ?? "other",
			colors: clean.colors ?? [],
			similarIds: idList(raw.similarIds),
			pairsWithIds: idList(raw.pairsWithIds).slice(0, 8),
			verdict,
			reasoning: str(raw.reasoning, 600) ?? "",
			source: "ai",
		};
		return c.json(result);
	}
	const category = typeof b.category === "string" && CATEGORY_KEYS.includes(b.category as never) ? b.category : null;
	const colors = Array.isArray(b.colors) ? b.colors.filter((x): x is string => typeof x === "string" && COLOR_KEYS.includes(x)) : [];
	if (!category) throw new HttpError(400, "Ohne KI bitte Kategorie und Farbe wählen");
	const similar = similarItems(items, category, colors);
	const pairs = pairingItems(items, category, colors);
	const verdict = similar.length >= 3 ? "lassen" : similar.length >= 1 ? "überlegen" : pairs.length >= 3 ? "kaufen" : "überlegen";
	const result: ShoppingCheckResult = {
		name: "Neues Teil",
		category,
		colors,
		similarIds: similar.map((i) => i.id),
		pairsWithIds: pairs.slice(0, 8).map((i) => i.id),
		verdict,
		reasoning:
			similar.length > 0
				? `Du hast schon ${similar.length} ähnliche${similar.length === 1 ? "s" : ""} Teil${similar.length === 1 ? "" : "e"} in dieser Farbe. ${pairs.length} Teile würden dazu passen.`
				: `So etwas hast du noch nicht. ${pairs.length} Teile aus deinem Schrank würden dazu passen.`,
		source: "rules",
	};
	return c.json(result);
});

// ---------- Trips ----------

app.get("/api/trips", async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT * FROM trips ORDER BY COALESCE(start_date, created_at) DESC`).all<TripRow>();
	return c.json(results.map(rowToTrip));
});

async function getTrip(db: D1Database, id: string) {
	const row = await db.prepare(`SELECT * FROM trips WHERE id = ?`).bind(id).first<TripRow>();
	if (!row) throw new HttpError(404, "Reise nicht gefunden");
	return rowToTrip(row);
}

app.get("/api/trips/:id", async (c) => c.json(await getTrip(c.env.DB, c.req.param("id"))));

function sanitizeWeather(v: unknown): TripWeatherDay[] | null {
	if (!Array.isArray(v)) return null;
	return v
		.filter(isObj)
		.slice(0, 31)
		.map((d) => ({
			date: typeof d.date === "string" ? d.date.slice(0, 10) : "",
			tMin: Number(d.tMin) || 0,
			tMax: Number(d.tMax) || 0,
			precip: Number(d.precip) || 0,
			code: Number(d.code) || 0,
		}));
}

function tripFields(b: Record<string, unknown>) {
	return {
		name: str(b.name, 80),
		destination: str(b.destination, 120),
		lat: typeof b.lat === "number" ? b.lat : b.lat === null ? null : undefined,
		lon: typeof b.lon === "number" ? b.lon : b.lon === null ? null : undefined,
		startDate: isDate(b.startDate) ? b.startDate : b.startDate === null ? null : undefined,
		endDate: isDate(b.endDate) ? b.endDate : b.endDate === null ? null : undefined,
		activities: Array.isArray(b.activities) ? b.activities.filter((x): x is string => typeof x === "string").slice(0, 12) : undefined,
		entries: Array.isArray(b.entries) ? sanitizeEntries(b.entries) : undefined,
		weather: "weather" in b ? sanitizeWeather(b.weather) : undefined,
		notes: str(b.notes, 2000),
	};
}

async function saveTrip(db: D1Database, id: string, t: ReturnType<typeof rowToTrip>) {
	await db
		.prepare(
			`UPDATE trips SET name = ?, destination = ?, lat = ?, lon = ?, start_date = ?, end_date = ?, activities = ?, entries = ?, weather = ?, notes = ?, updated_at = ? WHERE id = ?`,
		)
		.bind(
			t.name,
			t.destination,
			t.lat,
			t.lon,
			t.startDate,
			t.endDate,
			JSON.stringify(t.activities),
			JSON.stringify(t.entries),
			t.weather ? JSON.stringify(t.weather) : null,
			t.notes,
			now(),
			id,
		)
		.run();
}

app.post("/api/trips", async (c) => {
	const f = tripFields(await body(c));
	const id = newId();
	const t = now();
	await c.env.DB.prepare(`INSERT INTO trips (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
		.bind(id, f.name || f.destination || "Reise", t, t)
		.run();
	const trip = await getTrip(c.env.DB, id);
	const merged = { ...trip, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as typeof trip;
	if (!merged.name) merged.name = merged.destination || "Reise";
	await saveTrip(c.env.DB, id, merged);
	return c.json(await getTrip(c.env.DB, id), 201);
});

app.patch("/api/trips/:id", async (c) => {
	const id = c.req.param("id");
	const trip = await getTrip(c.env.DB, id);
	const f = tripFields(await body(c));
	const merged = { ...trip, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as typeof trip;
	await saveTrip(c.env.DB, id, merged);
	return c.json(await getTrip(c.env.DB, id));
});

app.delete("/api/trips/:id", async (c) => {
	await c.env.DB.prepare(`DELETE FROM trips WHERE id = ?`).bind(c.req.param("id")).run();
	return c.json({ ok: true });
});

app.post("/api/trips/:id/generate", async (c) => {
	const id = c.req.param("id");
	const trip = await getTrip(c.env.DB, id);
	const b = await body(c);
	const items = (await listItems(c.env.DB)).filter((i) => i.status === "active");
	const ids = new Set(items.map((i) => i.id));
	const days =
		trip.startDate && trip.endDate
			? Math.max(1, Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86_400_000) + 1)
			: 3;
	const w = trip.weather ?? [];
	const avg = w.length ? w.reduce((s, d) => s + (d.tMin + d.tMax) / 2, 0) / w.length : 15;
	const rainy = w.some((d) => d.precip >= 3);
	const ai = await loadAi(c.env.DB);
	let aiError: string | undefined;
	let entries = null as ReturnType<typeof sanitizeEntries> | null;
	let notes = trip.notes;
	if (b.useAi !== false && aiConfigured(ai) && items.length > 0) {
		try {
			const tripText = `${trip.destination || trip.name}, ${days} Tage${trip.startDate ? ` ab ${trip.startDate}` : ""}, Aktivitäten: ${trip.activities.join(", ") || "keine Angabe"}`;
			const weather = w.length
				? w.map((d) => `${d.date}: ${Math.round(d.tMin)}–${Math.round(d.tMax)} °C, ${d.precip} mm`).join("; ")
				: "";
			const res = await chatJson<{ items?: { itemId?: string; reason?: string }[]; extras?: { text?: string; qty?: number }[]; notes?: string }>(
				ai,
				[{ role: "user", content: packingPrompt(items, tripText, weather) }],
				{ temperature: 0.4, maxTokens: 3000 },
			);
			const list = [
				...(res.items ?? []).filter((x) => x.itemId && ids.has(x.itemId)).map((x) => ({ itemId: x.itemId, reason: x.reason, checked: false })),
				...(res.extras ?? []).map((x) => ({ text: x.text, qty: x.qty, checked: false })),
			];
			entries = sanitizeEntries(list);
			if (typeof res.notes === "string") notes = res.notes.slice(0, 600);
			if (!entries.length) entries = null;
		} catch (err) {
			aiError = (err as Error).message;
		}
	}
	const source = entries ? "ai" : "rules";
	if (!entries) entries = packingList(items, { days, avgFeelsLike: avg, rainy, activities: trip.activities });
	const updated = { ...trip, entries, notes };
	await saveTrip(c.env.DB, id, updated);
	return c.json({ trip: await getTrip(c.env.DB, id), source, aiError });
});

// ---------- Try-on ----------

app.get("/api/tryons", async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT * FROM tryons ORDER BY created_at DESC LIMIT 50`).all<{
		id: string;
		item_ids: string;
		image: string;
		created_at: string;
	}>();
	return c.json(results.map(rowToTryOn));
});

app.delete("/api/tryons/:id", async (c) => {
	const row = await c.env.DB.prepare(`SELECT image FROM tryons WHERE id = ?`).bind(c.req.param("id")).first<{ image: string }>();
	await c.env.DB.prepare(`DELETE FROM tryons WHERE id = ?`).bind(c.req.param("id")).run();
	if (row) c.executionCtx.waitUntil(deleteImages(c.env, [row.image]));
	return c.json({ ok: true });
});

app.post("/api/ai/tryon", async (c) => {
	const b = await body(c);
	const itemIds = Array.isArray(b.itemIds) ? b.itemIds.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
	if (!itemIds.length) throw new HttpError(400, "Bitte Teile auswählen");
	const settings = await loadSettings(c.env.DB);
	if (!settings.personPhoto) throw new HttpError(400, "Bitte zuerst ein Ganzkörperfoto von dir hochladen");
	const ai = await loadAi(c.env.DB);
	const person = await getImageBytes(c.env, settings.personPhoto);
	if (!person) throw new HttpError(400, "Dein Foto wurde nicht gefunden, bitte neu hochladen");
	const items = await Promise.all(itemIds.map((id) => getItem(c.env.DB, id)));
	const images = [{ ...person, name: `person.${person.type.split("/")[1]}` }];
	for (const it of items) {
		if (!it.imageFront) continue;
		const img = await getImageBytes(c.env, it.imageFront);
		if (img) images.push({ ...img, name: `item-${images.length}.${img.type.split("/")[1]}` });
	}
	const prompt = tryOnPrompt(items.map((i) => i.name || i.subcategory || i.category));
	const out = ai.tryonMode === "chat" ? await imageViaChat(ai, prompt, images) : await imageEdit(ai, prompt, images);
	const key = newImageKey(out.type, "tryon");
	await putImage(c.env, key, out.data, out.type);
	const id = newId();
	await c.env.DB.prepare(`INSERT INTO tryons (id, item_ids, image, created_at) VALUES (?, ?, ?, ?)`)
		.bind(id, JSON.stringify(itemIds), key, now())
		.run();
	return c.json({ id, itemIds, image: key, createdAt: now() });
});

// ---------- Export & maintenance ----------

app.get("/api/export", async (c) => {
	const [items, outfits, wears, trips, settings] = await Promise.all([
		listItems(c.env.DB),
		c.env.DB.prepare(`SELECT * FROM outfits`).all<OutfitRow>(),
		c.env.DB.prepare(`SELECT date, item_id, outfit_id FROM wears ORDER BY date`).all(),
		c.env.DB.prepare(`SELECT * FROM trips`).all<TripRow>(),
		loadSettings(c.env.DB),
	]);
	const data = {
		app: "garderobe",
		version: 1,
		exportedAt: now(),
		items,
		outfits: outfits.results.map(rowToOutfit),
		wears: wears.results,
		trips: trips.results.map(rowToTrip),
		settings: { ...settings, ai: { ...settings.ai, hasKey: undefined, keyHint: undefined } },
	};
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="garderobe-${now().slice(0, 10)}.json"`,
		},
	});
});

app.post("/api/maintenance/cleanup", async (c) => {
	const items = await listItems(c.env.DB);
	const settings = await loadSettings(c.env.DB);
	const { results: tryons } = await c.env.DB.prepare(`SELECT image FROM tryons`).all<{ image: string }>();
	const used = new Set<string>();
	for (const i of items) for (const k of [i.imageFront, i.thumbFront, i.imageBack, i.thumbBack]) if (k) used.add(k);
	const { results: pendingAi } = await c.env.DB.prepare(`SELECT ai_image FROM items WHERE ai_image IS NOT NULL`).all<{ ai_image: string }>();
	for (const r of pendingAi) used.add(r.ai_image);
	for (const t of tryons) used.add(t.image);
	if (settings.personPhoto) used.add(settings.personPhoto);
	const keys = await listImageKeys(c.env);
	// Images uploaded in the last 24h may belong to an unsaved form – keep them.
	const recent = new Set<string>();
	if (!c.env.BUCKET) {
		let cursor: string | undefined;
		do {
			const page: KVNamespaceListResult<{ t?: number }> = await c.env.IMAGES.list({ cursor, limit: 1000 });
			for (const k of page.keys) if ((k.metadata?.t ?? 0) > Date.now() - 86_400_000) recent.add(k.name);
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
	}
	const orphans = keys.filter((k) => isValidKey(k) && !used.has(k) && !recent.has(k));
	await deleteImages(c.env, orphans);
	return c.json({ total: keys.length, deleted: orphans.length });
});

// Unknown API routes → JSON 404 (everything else is served from static assets).
app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

export default app;
