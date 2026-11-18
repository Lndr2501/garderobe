import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryBlobStore } from "../src/server/files.ts";
import { SqliteDb } from "../src/server/sqlite.ts";
import app, { type Bindings } from "../src/worker/index.ts";
import { applyTags, type TagParams } from "../src/worker/tagging.ts";
import type { AppSettings, Item, ShoppingCheckResult, Stats, Trip, WearDay } from "../src/shared/types.ts";

const BASE = "https://garderobe.test";

/** Recognition jobs the API queued (the job runner itself is tested separately). */
const queuedTags: TagParams[] = [];
const env: Bindings = {
	DB: new SqliteDb(":memory:"),
	IMAGES: new MemoryBlobStore(),
	ALLOW_SETUP: "true",
	TAGGER: {
		async create({ params }) {
			queuedTags.push(params);
			return { id: crypto.randomUUID() };
		},
	},
};
const PW = "super-geheim-123";

class Client {
	cookie = "";

	async req(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
		const h = new Headers(opts.headers);
		if (this.cookie) h.set("Cookie", this.cookie);
		let body: RequestInit["body"];
		if (opts.body instanceof FormData) body = opts.body;
		else if (opts.body !== undefined) {
			body = JSON.stringify(opts.body);
			h.set("Content-Type", "application/json");
		}
		const pending: Promise<unknown>[] = [];
		const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} };
		const res = await app.fetch(new Request(BASE + path, { method: opts.method ?? (body ? "POST" : "GET"), headers: h, body }), env, ctx as never);
		await Promise.allSettled(pending);
		const sc = res.headers.get("Set-Cookie");
		const m = sc?.match(/gd_session=([^;]*)/);
		if (m) this.cookie = m[1] ? `gd_session=${m[1]}` : "";
		return res;
	}

	async json<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
		const res = await this.req(path, opts);
		const text = await res.text();
		if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
		return JSON.parse(text) as T;
	}
}

async function loggedIn(): Promise<Client> {
	const c = new Client();
	const res = await c.req("/api/auth/setup", { body: { password: PW } });
	expect(res.status).toBe(200);
	expect(c.cookie).toMatch(/^gd_session=v1\./);
	return c;
}

function sse(chunks: string[]): Response {
	const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n";
	return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

const PNG_1PX = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
	(ch) => ch.charCodeAt(0),
);
const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
	// Run the self-migration once outside of per-test storage isolation.
	const res = await new Client().req("/api/health");
	expect(res.status).toBe(200);
});

beforeEach(async () => {
	// Storage persists across tests in this pool, so wipe app data (but keep the schema).
	await env.DB.batch(
		["items", "outfits", "wears", "trips", "tryons", "settings", "login_attempts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
	);
	await env.DB.prepare(`DELETE FROM meta WHERE key != 'schema_version'`).run();
	for (const k of await env.IMAGES.list()) await env.IMAGES.delete(k.key);
	queuedTags.length = 0;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("auth", () => {
	it("requires setup, then a session", async () => {
		const anon = new Client();
		expect(await anon.json("/api/auth/status")).toEqual({ authenticated: false, setupRequired: true, setupAllowed: true });
		expect((await anon.req("/api/items")).status).toBe(401);
		expect((await anon.req("/api/auth/setup", { body: { password: "kurz" } })).status).toBe(400);

		const c = await loggedIn();
		expect(await c.json("/api/auth/status")).toMatchObject({ authenticated: true, setupRequired: false });
		expect((await c.req("/api/items")).status).toBe(200);
		// a second setup is refused
		expect((await new Client().req("/api/auth/setup", { body: { password: "noch-ein-passwort" } })).status).toBe(403);
	});

	it("logs in with the right password only", async () => {
		await loggedIn();
		const c = new Client();
		expect((await c.req("/api/auth/login", { body: { password: "falsch-falsch" } })).status).toBe(401);
		expect(c.cookie).toBe("");
		expect((await c.req("/api/auth/login", { body: { password: PW } })).status).toBe(200);
		expect((await c.req("/api/items")).status).toBe(200);
		const forged = new Client();
		forged.cookie = "gd_session=v1.9999999999.abc.def";
		expect((await forged.req("/api/items")).status).toBe(401);
	});

	it("rejects cross-origin writes", async () => {
		const c = await loggedIn();
		const res = await c.req("/api/items", { body: { name: "X" }, headers: { Origin: "https://evil.example" } });
		expect(res.status).toBe(403);
	});

	it("changes the password and invalidates old sessions", async () => {
		const c = await loggedIn();
		const old = new Client();
		old.cookie = c.cookie;
		expect((await c.req("/api/auth/password", { body: { current: "falsch", next: "neues-passwort-1" } })).status).toBe(401);
		expect((await c.req("/api/auth/password", { body: { current: PW, next: "neues-passwort-1" } })).status).toBe(200);
		expect((await c.req("/api/items")).status).toBe(200);
		expect((await old.req("/api/items")).status).toBe(401);
	});

	it("blocks brute force after repeated failures", async () => {
		await loggedIn();
		const c = new Client();
		for (let i = 0; i < 8; i++) await c.req("/api/auth/login", { body: { password: `nope-${i}` }, headers: { "cf-connecting-ip": "203.0.113.9" } });
		const res = await c.req("/api/auth/login", { body: { password: PW }, headers: { "cf-connecting-ip": "203.0.113.9" } });
		expect(res.status).toBe(429);
	});
});

describe("items & images", () => {
	it("uploads an image and serves it back", async () => {
		const c = await loggedIn();
		const form = new FormData();
		form.append("file", new File([PNG_1PX], "a.png", { type: "image/png" }));
		const { key } = await c.json<{ key: string }>("/api/images", { body: form });
		expect(key).toMatch(/^img\/[0-9a-f-]{36}\.png$/);
		const res = await c.req(`/api/img/${key}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("Cache-Control")).toContain("immutable");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_1PX);

		const bad = new FormData();
		bad.append("file", new File(["hi"], "a.txt", { type: "text/plain" }));
		expect((await c.req("/api/images", { body: bad })).status).toBe(415);
	});

	it("creates, sanitizes, updates and deletes items", async () => {
		const c = await loggedIn();
		const created = await c.json<Item>("/api/items", {
			body: { name: "  Blaue Jeans ", category: "bottom", colors: ["blau", "lila-glitzer"], warmth: 9, seasons: ["herbst", "x"], price: "49.9", evil: "drop table" },
		});
		expect(created).toMatchObject({ name: "Blaue Jeans", category: "bottom", colors: ["blau"], seasons: ["herbst"], status: "active", wearCount: 0 });
		expect(created.warmth).toBeLessThanOrEqual(5);

		const odd = await c.json<Item>("/api/items", { body: { name: "Ding", category: "raumschiff" } });
		expect(odd.category).toBe("other");

		const patched = await c.json<Item>(`/api/items/${created.id}`, { method: "PATCH", body: { favorite: true, status: "archived" } });
		expect(patched).toMatchObject({ favorite: true, status: "archived", name: "Blaue Jeans" });

		const list = await c.json<Item[]>("/api/items");
		expect(list.map((i) => i.id).sort()).toEqual([created.id, odd.id].sort());

		expect((await c.req(`/api/items/${created.id}`, { method: "DELETE" })).status).toBe(200);
		expect((await c.req(`/api/items/${created.id}`)).status).toBe(404);
	});
});

describe("wear diary & stats", () => {
	it("logs a day and derives counts, streak and stats", async () => {
		const c = await loggedIn();
		const a = await c.json<Item>("/api/items", { body: { name: "Shirt", category: "top", colors: ["weiss"], price: 20 } });
		const b = await c.json<Item>("/api/items", { body: { name: "Hose", category: "bottom", colors: ["schwarz"] } });
		const today = new Date().toISOString().slice(0, 10);
		const day = await c.json<WearDay>(`/api/wears/${today}`, { method: "PUT", body: { itemIds: [a.id, b.id, "unknown-id"], outfitId: null } });
		expect(day.itemIds.sort()).toEqual([a.id, b.id].sort());

		const range = await c.json<WearDay[]>(`/api/wears?from=${today}&to=${today}`);
		expect(range).toHaveLength(1);

		const items = await c.json<Item[]>("/api/items");
		const shirt = items.find((i) => i.id === a.id)!;
		expect(shirt.wearCount).toBe(1);
		expect(shirt.lastWorn).toBe(today);

		const stats = await c.json<Stats>(`/api/stats?today=${today}`);
		expect(stats).toMatchObject({ totalItems: 2, totalWears: 2, streak: 1, wornThisMonthPct: 100 });
		expect(stats.bestCostPerWear[0]).toMatchObject({ id: a.id, cpw: 20 });

		// clearing the day removes it
		await c.json(`/api/wears/${today}`, { method: "PUT", body: { itemIds: [] } });
		expect(await c.json<WearDay[]>(`/api/wears?from=${today}&to=${today}`)).toHaveLength(0);
	});
});

describe("settings", () => {
	it("stores the AI key server-side and never returns it", async () => {
		const c = await loggedIn();
		const before = await c.json<AppSettings>("/api/settings");
		expect(before.ai.configured).toBe(false);
		expect(before.location.useGeolocation).toBe(false);

		const res = await c.req("/api/settings", {
			method: "PATCH",
			body: { name: "Lndr", currency: "CHF", ai: { baseUrl: "https://llm.example", apiKey: "sk-test-1234567890abcd", model: "m-1" } },
		});
		const text = await res.text();
		expect(text).not.toContain("sk-test");
		const s = JSON.parse(text) as AppSettings;
		expect(s).toMatchObject({ name: "Lndr", currency: "CHF" });
		expect(s.ai).toMatchObject({ baseUrl: "https://llm.example/v1", model: "m-1", hasKey: true, keyHint: "…abcd", configured: true });

		const cleared = await c.json<AppSettings>("/api/settings", { method: "PATCH", body: { ai: { clearKey: true } } });
		expect(cleared.ai.hasKey).toBe(false);
	});
});

async function withAi(c: Client) {
	await c.json("/api/settings", { method: "PATCH", body: { ai: { baseUrl: "https://llm.example/v1", apiKey: "sk-abc", model: "m-1", visionModel: "v-1" } } });
}

describe("AI (OpenAI-compatible)", () => {
	it("tags a photo from a streamed reply with <think> noise", async () => {
		const c = await loggedIn();
		await withAi(c);
		const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const req = new Request(input, init);
			calls.push({ url: req.url, body: (await req.json()) as Record<string, unknown>, auth: req.headers.get("Authorization") });
			return sse(["<thi", "nk>hmm, blau…</th", "ink>```json\n{\"name\":\"Jeansjacke\",", "\"category\":\"outerwear\",\"colors\":[\"blau\"],\"warmth\":3}\n```"]);
		});
		const tags = await c.json<Partial<Item>>("/api/ai/tag", { body: { image: DATA_URL } });
		expect(tags).toMatchObject({ name: "Jeansjacke", category: "outerwear", colors: ["blau"], warmth: 3 });
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("https://llm.example/v1/chat/completions");
		expect(calls[0]!.auth).toBe("Bearer sk-abc");
		expect(calls[0]!.body).toMatchObject({ model: "v-1", stream: true });
	});

	it("accepts plain JSON (non-streaming) replies too", async () => {
		const c = await loggedIn();
		await withAi(c);
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			Response.json({ choices: [{ message: { content: '{"name":"Sneaker","category":"shoes","colors":["weiss"]}' } }] }),
		);
		expect(await c.json<Partial<Item>>("/api/ai/tag", { body: { image: DATA_URL } })).toMatchObject({ name: "Sneaker", category: "shoes" });
	});

	it("streams chat as SSE and maps provider errors", async () => {
		const c = await loggedIn();
		await withAi(c);
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse(["Hallo ", "Lndr", "!"]));
		const res = await c.req("/api/ai/chat", { body: { messages: [{ role: "user", content: "Hi" }] } });
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");
		const raw = await res.text();
		const text = raw
			.split("\n")
			.filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
			.map((l) => (JSON.parse(l.slice(5)) as { t?: string }).t ?? "")
			.join("");
		expect(text).toBe("Hallo Lndr!");

		vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: { message: "bad key" } }, { status: 401 }));
		const bad = await c.req("/api/ai/tag", { body: { image: DATA_URL } });
		expect(bad.status).toBe(502);
		expect(await bad.text()).toContain("API-Key");
	});

	it("falls back to rules when the AI fails, and uses AI ids when it works", async () => {
		const c = await loggedIn();
		const top = await c.json<Item>("/api/items", { body: { name: "Pulli", category: "top", colors: ["grau"], warmth: 3 } });
		const bottom = await c.json<Item>("/api/items", { body: { name: "Chino", category: "bottom", colors: ["beige"], warmth: 3 } });
		await c.json<Item>("/api/items", { body: { name: "Sneaker", category: "shoes", colors: ["weiss"] } });

		const rules = await c.json<{ source: string; suggestions: { itemIds: string[] }[] }>("/api/ai/suggest", { body: { weather: { feelsLike: 14 }, occasion: "" } });
		expect(rules.source).toBe("rules");
		expect(rules.suggestions.length).toBeGreaterThan(0);
		expect(rules.suggestions[0]!.itemIds).toEqual(expect.arrayContaining([top.id, bottom.id]));

		await withAi(c);
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			throw new Error("ECONNREFUSED");
		});
		const failed = await c.json<{ source: string; aiError?: string }>("/api/ai/suggest", { body: { weather: { feelsLike: 14 } } });
		expect(failed.source).toBe("rules");
		expect(failed.aiError).toContain("nicht erreichbar");

		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			sse([JSON.stringify({ outfits: [{ name: "Casual", itemIds: [top.id, bottom.id, "erfunden"], reason: "passt" }] })]),
		);
		const ai = await c.json<{ source: string; suggestions: { itemIds: string[] }[] }>("/api/ai/suggest", { body: { weather: { feelsLike: 14 } } });
		expect(ai.source).toBe("ai");
		expect(ai.suggestions[0]!.itemIds).toEqual([top.id, bottom.id]);
	});

	it("generates image try-ons via /images/edits", async () => {
		const c = await loggedIn();
		const form = new FormData();
		form.append("file", new File([PNG_1PX], "me.png", { type: "image/png" }));
		const { key } = await c.json<{ key: string }>("/api/images", { body: form });
		await c.json("/api/settings", { method: "PATCH", body: { personPhoto: key } });
		const item = await c.json<Item>("/api/items", { body: { name: "Mantel", category: "outerwear", imageFront: key } });
		await c.json("/api/settings", { method: "PATCH", body: { ai: { baseUrl: "https://llm.example/v1", apiKey: "sk-abc", model: "m-1", imageModel: "img-1", tryonMode: "edits" } } });
		let seen: FormData | null = null;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const req = new Request(input, init);
			expect(req.url).toBe("https://llm.example/v1/images/edits");
			seen = await req.formData();
			return Response.json({ data: [{ b64_json: btoa(String.fromCharCode(...PNG_1PX)) }] });
		});
		const t = await c.json<{ id: string; image: string }>("/api/ai/tryon", { body: { itemIds: [item.id] } });
		expect(t.image).toMatch(/^tryon\//);
		expect(seen!.get("model")).toBe("img-1");
		expect(seen!.getAll("image[]").length + seen!.getAll("image").length).toBeGreaterThanOrEqual(2);
		const list = await c.json<{ id: string }[]>("/api/tryons");
		expect(list.map((x) => x.id)).toContain(t.id);
	});
});

describe("server-side recognition", () => {
	async function upload(c: Client): Promise<string> {
		const form = new FormData();
		form.append("file", new File([PNG_1PX], "ai.png", { type: "image/png" }));
		return (await c.json<{ key: string }>("/api/images", { body: form })).key;
	}

	it("without AI the helper image is dropped and nothing waits", async () => {
		const c = await loggedIn();
		const aiImage = await upload(c);
		const item = await c.json<Item>("/api/items", { body: { category: "top", aiImage, lock: ["category", "bogus"] } });
		expect(item.aiState).toBe("");
		expect(item.userFields).toEqual(["category"]);
		expect((await c.req(`/api/img/${aiImage}`)).status).toBe(404);
	});

	it("queues the recognition job when an AI is configured", async () => {
		const c = await loggedIn();
		await withAi(c);
		const aiImage = await upload(c);
		const item = await c.json<Item>("/api/items", { body: { aiImage, colorHint: "navy" } });
		expect(item.aiState).toBe("pending");
		expect(queuedTags).toEqual([{ itemId: item.id, aiImage, colorHint: "navy" }]);
		const again = await c.json<Item>(`/api/items/${item.id}/retag`, { body: { aiImage: await upload(c), unlock: true } });
		expect(again.aiState).toBe("pending");
		expect((await c.req(`/api/items/${item.id}/retag`, { body: {} })).status).toBe(400);
	});

	it("AI results never overwrite fields the user set by hand", async () => {
		const c = await loggedIn();
		const item = await c.json<Item>("/api/items", { body: { name: "Mein Lieblingspulli", category: "top", lock: ["name"] } });
		await c.json<Item>(`/api/items/${item.id}`, { method: "PATCH", body: { material: "Kaschmir", lock: ["material"] } });
		await applyTags(env.DB, item.id, {
			tags: { name: "Navy Pullover", category: "top", material: "Wolle", colors: ["navy"], brand: "" },
			rotate: 90,
		});
		const after = await c.json<Item>(`/api/items/${item.id}`);
		expect(after).toMatchObject({ name: "Mein Lieblingspulli", material: "Kaschmir", colors: ["navy"], aiState: "done", rotate: 90 });
		expect(after.userFields.sort()).toEqual(["material", "name"]);
		expect(await applyTags(env.DB, "gibt-es-nicht", { tags: {}, rotate: 0 })).toBe(false);
	});
});

describe("trips & shopping", () => {
	it("creates a trip and fills a rule-based packing list", async () => {
		const c = await loggedIn();
		await c.json<Item>("/api/items", { body: { name: "Shirt", category: "top", colors: ["weiss"], warmth: 1 } });
		await c.json<Item>("/api/items", { body: { name: "Shorts", category: "bottom", colors: ["blau"], warmth: 1 } });
		await c.json<Item>("/api/items", { body: { name: "Regenjacke", category: "outerwear", colors: ["gelb"], waterproof: true, warmth: 2 } });
		const trip = await c.json<Trip>("/api/trips", {
			body: {
				name: "Lissabon",
				destination: "Lissabon, Portugal",
				startDate: "2026-12-01",
				endDate: "2026-12-04",
				activities: ["strand"],
				weather: [{ date: "2026-12-01", tMin: 12, tMax: 18, precip: 5, code: 61 }],
			},
		});
		const r = await c.json<{ trip: Trip; source: string }>(`/api/trips/${trip.id}/generate`, { body: {} });
		expect(r.source).toBe("rules");
		expect(r.trip.entries.length).toBeGreaterThan(2);
		expect(r.trip.entries.some((e) => e.itemId)).toBe(true);
		expect(r.trip.entries.some((e) => e.text)).toBe(true);

		const checked = await c.json<Trip>(`/api/trips/${trip.id}`, { method: "PATCH", body: { entries: r.trip.entries.map((e) => ({ ...e, checked: true })) } });
		expect(checked.entries.every((e) => e.checked)).toBe(true);
	});

	it("checks a purchase against the wardrobe without AI", async () => {
		const c = await loggedIn();
		await c.json<Item>("/api/items", { body: { name: "Schwarzes Shirt", category: "top", colors: ["schwarz"] } });
		await c.json<Item>("/api/items", { body: { name: "Jeans", category: "bottom", colors: ["blau"] } });
		const r = await c.json<ShoppingCheckResult>("/api/ai/shopping", { body: { category: "top", colors: ["schwarz"] } });
		expect(r.source).toBe("rules");
		expect(r.similarIds).toHaveLength(1);
		expect(r.verdict).toBe("überlegen");
		expect((await c.req("/api/ai/shopping", { body: {} })).status).toBe(400);
	});
});

describe("export & cleanup", () => {
	it("exports everything and removes orphaned images", async () => {
		const c = await loggedIn();
		await c.json<Item>("/api/items", { body: { name: "Kappe", category: "accessory" } });
		const exp = await c.req("/api/export");
		expect(exp.headers.get("Content-Disposition")).toContain("attachment");
		const data = (await exp.json()) as { items: unknown[] };
		expect(data.items).toHaveLength(1);
		const r = await c.json<{ total: number; deleted: number }>("/api/maintenance/cleanup", { body: {} });
		expect(r.deleted).toBe(0);
	});
});
