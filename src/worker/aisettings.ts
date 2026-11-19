// AI providers and which one does what. Every area (texts, photo recognition, studio images,
// try-on) can use its own provider and model. Stored as one JSON setting; API keys never leave the server.
import { LOCAL_FLUX_MODEL, LOCAL_FLUX_PROVIDER, type AiArea, type AiProviderKind, type AiSettingsPublic } from "../shared/types.ts";
import { AiError, normalizeBaseUrl, type AiConfig } from "./ai.ts";
import { getSetting, setSetting } from "./db.ts";
import type { Db } from "./platform.ts";

export const AI_AREAS: readonly AiArea[] = ["text", "vision", "studio", "tryon"];
/** Areas that produce images (they have a request style instead of a chat model). */
export const IMAGE_AREAS: readonly AiArea[] = ["studio", "tryon"];

export interface AiProvider {
	id: string;
	name: string;
	kind: AiProviderKind;
	/** OpenAI-compatible base URL (kind "openai"). Cloudflare builds it from the account id. */
	baseUrl: string;
	accountId: string;
	apiKey: string;
	jsonMode: boolean;
	reasoning: boolean;
}

export interface AiRoute {
	provider: string;
	model: string;
	/** Image areas on OpenAI-style providers: /images/edits or chat with image output. */
	mode: "edits" | "chat";
}

export interface StudioConfig {
	/** Make a studio picture for every new piece automatically. */
	auto: boolean;
	/** Cloudflare: stay within the free daily allowance (waits for the next day instead). */
	freeOnly: boolean;
	/** Diffusion steps: 20 fast, 28 good, 50 best (cost grows with steps). */
	steps: number;
	/** Daily neuron budget that "freeOnly" keeps to (the free allowance is 10 000). */
	budget: number;
}

export interface AiStore {
	version: 2;
	providers: AiProvider[];
	routes: Record<AiArea, AiRoute>;
	studio: StudioConfig;
}

export const DEFAULT_STUDIO: StudioConfig = { auto: false, freeOnly: true, steps: 28, budget: 9000 };
export const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-dev";
export const CLOUDFLARE_TEXT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const EMPTY_ROUTE: AiRoute = { provider: "", model: "", mode: "edits" };

function emptyRoutes(): Record<AiArea, AiRoute> {
	return { text: { ...EMPTY_ROUTE }, vision: { ...EMPTY_ROUTE }, studio: { ...EMPTY_ROUTE }, tryon: { ...EMPTY_ROUTE } };
}

export function emptyStore(): AiStore {
	return { version: 2, providers: [], routes: emptyRoutes(), studio: { ...DEFAULT_STUDIO } };
}

/** The single-provider format from before (one base URL, chat/vision/image model). */
interface LegacyAi {
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	visionModel?: string;
	imageModel?: string;
	tryonMode?: "edits" | "chat";
	jsonMode?: boolean;
	reasoning?: boolean;
}

export function migrateLegacy(old: LegacyAi): AiStore {
	const store = emptyStore();
	if (!old.baseUrl && !old.apiKey && !old.model) return store;
	store.providers.push({
		id: "p1",
		name: providerNameFromUrl(old.baseUrl ?? ""),
		kind: "openai",
		baseUrl: old.baseUrl ?? "",
		accountId: "",
		apiKey: old.apiKey ?? "",
		jsonMode: !!old.jsonMode,
		reasoning: !!old.reasoning,
	});
	const mode = old.tryonMode === "chat" ? "chat" : "edits";
	if (old.model) store.routes.text = { provider: "p1", model: old.model, mode };
	if (old.visionModel || old.model) store.routes.vision = { provider: "p1", model: old.visionModel || old.model || "", mode };
	if (old.imageModel) store.routes.tryon = { provider: "p1", model: old.imageModel, mode };
	return store;
}

export function providerNameFromUrl(url: string): string {
	try {
		const host = new URL(url).hostname.replace(/^(api|www)\./, "");
		if (host.includes("openai.com")) return "OpenAI";
		if (host.includes("openrouter")) return "OpenRouter";
		if (host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.")) return "Lokal";
		return host || "KI-Anbieter";
	} catch {
		return "KI-Anbieter";
	}
}

export async function loadAiStore(db: Db): Promise<AiStore> {
	const raw = await getSetting<Partial<AiStore> & LegacyAi>(db, "ai", {});
	if (raw.version !== 2) return migrateLegacy(raw);
	const base = emptyStore();
	const routes = { ...base.routes, ...(raw.routes ?? {}) };
	for (const area of IMAGE_AREAS) if (routes[area]?.provider === LOCAL_FLUX_PROVIDER) {
		routes[area] = { provider: LOCAL_FLUX_PROVIDER, model: LOCAL_FLUX_MODEL, mode: "edits" };
	}
	return {
		version: 2,
		providers: Array.isArray(raw.providers) ? raw.providers : [],
		routes,
		studio: { ...base.studio, ...(raw.studio ?? {}) },
	};
}

export function saveAiStore(db: Db, store: AiStore): Promise<void> {
	return setSetting(db, "ai", store);
}

export function providerBaseUrl(p: AiProvider): string {
	if (p.kind === "cloudflare") return p.accountId ? `https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1` : "";
	return p.baseUrl;
}

const NO_AI: AiConfig = {
	providerId: "",
	kind: "openai",
	baseUrl: "",
	apiKey: "",
	accountId: "",
	model: "",
	mode: "edits",
	jsonMode: false,
	reasoning: false,
};

export function configFor(store: AiStore, area: AiArea): AiConfig {
	const route = store.routes[area];
	const p = store.providers.find((x) => x.id === route?.provider);
	if (!route || route.provider === LOCAL_FLUX_PROVIDER || !p) return { ...NO_AI };
	return providerConfig(p, route.model, route.mode);
}

export function providerConfig(p: AiProvider, model = "", mode: AiRoute["mode"] = "edits"): AiConfig {
	return {
		providerId: p.id,
		kind: p.kind,
		baseUrl: providerBaseUrl(p),
		apiKey: p.apiKey,
		accountId: p.accountId,
		model,
		mode,
		jsonMode: p.jsonMode,
		reasoning: p.reasoning,
	};
}

/** Connection + model for one area ("text" = chat, outfits, shopping, packing; "vision" = photo recognition). */
export async function loadAi(db: Db, area: AiArea): Promise<AiConfig> {
	return configFor(await loadAiStore(db), area);
}

export function areaReady(cfg: AiConfig): boolean {
	if (!cfg.baseUrl || !cfg.model) return false;
	return cfg.kind !== "cloudflare" || !!cfg.apiKey;
}

/** Today's Workers AI usage that this app caused (estimated neurons) – for the free allowance. */
export async function usageToday(db: Db, provider: string): Promise<{ neurons: number; images: number }> {
	const row = await db
		.prepare(`SELECT neurons, images FROM ai_usage WHERE day = ? AND provider = ?`)
		.bind(utcDay(), provider)
		.first<{ neurons: number; images: number }>();
	return { neurons: row?.neurons ?? 0, images: row?.images ?? 0 };
}

export function utcDay(t = Date.now()): string {
	return new Date(t).toISOString().slice(0, 10);
}

/** Milliseconds until the free allowance resets (00:00 UTC) plus a small margin. */
export function msUntilNextUtcDay(t = Date.now()): number {
	const d = new Date(t);
	const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 2);
	return next - t;
}

/**
 * Books `neurons` for today if they still fit in the budget. Returns false when they don't.
 * A single SQL statement, so two jobs can't both take the last slot.
 */
export async function reserveUsage(db: Db, provider: string, neurons: number, budget: number | null): Promise<boolean> {
	const day = utcDay();
	await db.prepare(`INSERT OR IGNORE INTO ai_usage (day, provider, neurons, images) VALUES (?, ?, 0, 0)`).bind(day, provider).run();
	const r = await db
		.prepare(`UPDATE ai_usage SET neurons = neurons + ?, images = images + 1 WHERE day = ? AND provider = ? AND (? IS NULL OR neurons + ? <= ?)`)
		.bind(neurons, day, provider, budget, neurons, budget)
		.run();
	return r.meta.changes > 0;
}

/** Marks today's budget as used up (the provider said so). */
export async function exhaustUsage(db: Db, provider: string, budget: number): Promise<void> {
	const day = utcDay();
	await db.prepare(`INSERT OR IGNORE INTO ai_usage (day, provider, neurons, images) VALUES (?, ?, 0, 0)`).bind(day, provider).run();
	await db.prepare(`UPDATE ai_usage SET neurons = MAX(neurons, ?) WHERE day = ? AND provider = ?`).bind(budget, day, provider).run();
}

export async function releaseUsage(db: Db, provider: string, neurons: number): Promise<void> {
	await db
		.prepare(`UPDATE ai_usage SET neurons = MAX(0, neurons - ?), images = MAX(0, images - 1) WHERE day = ? AND provider = ?`)
		.bind(neurons, utcDay(), provider)
		.run();
}

export async function publicAi(db: Db, store: AiStore, localFluxAvailable = false): Promise<AiSettingsPublic> {
	const areas = Object.fromEntries(AI_AREAS.map((a) => [a, areaReady(configFor(store, a))])) as Record<AiArea, boolean>;
	for (const area of IMAGE_AREAS) if (store.routes[area].provider === LOCAL_FLUX_PROVIDER) areas[area] = localFluxAvailable;
	const studioCfg = configFor(store, "studio");
	const used = studioCfg.providerId ? await usageToday(db, studioCfg.providerId) : { neurons: 0, images: 0 };
	return {
		providers: store.providers.map((p) => ({
			id: p.id,
			name: p.name,
			kind: p.kind,
			baseUrl: p.baseUrl,
			accountId: p.accountId,
			jsonMode: p.jsonMode,
			reasoning: p.reasoning,
			hasKey: !!p.apiKey,
			keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : "",
		})),
		routes: store.routes,
		studio: { ...store.studio, usedToday: used.neurons, imagesToday: used.images, metered: studioCfg.kind === "cloudflare", localFluxAvailable },
		areas,
		configured: areas.text,
	};
}

// ---------- Applying a settings PATCH ----------

function text(v: unknown, max: number): string | undefined {
	return typeof v === "string" ? v.trim().slice(0, max) : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanBaseUrl(v: string): string {
	return v ? normalizeBaseUrl(v) : "";
}

/** Applies the new format (`providers`, `routes`, `studio`) and the old single-provider fields. */
export function applyAiPatch(store: AiStore, a: Record<string, unknown>): AiStore {
	const next: AiStore = structuredClone(store);

	if (Array.isArray(a.providers)) {
		const old = new Map(store.providers.map((p) => [p.id, p]));
		const seen = new Set<string>();
		next.providers = [];
		for (const raw of a.providers.slice(0, 8)) {
			if (!isObj(raw)) continue;
			let id = text(raw.id, 40) || "";
			if (!/^[a-z0-9-]{1,40}$/.test(id) || id === LOCAL_FLUX_PROVIDER || seen.has(id)) id = `p${crypto.randomUUID().slice(0, 8)}`;
			seen.add(id);
			const prev = old.get(id);
			const kind: AiProviderKind = raw.kind === "cloudflare" ? "cloudflare" : "openai";
			const accountId = text(raw.accountId, 64) ?? prev?.accountId ?? "";
			if (accountId && !/^[0-9a-f]{32}$/i.test(accountId)) throw new AiError("Cloudflare-Account-ID hat 32 Zeichen (0-9, a-f).", 400);
			const baseUrl = kind === "openai" ? cleanBaseUrl(text(raw.baseUrl, 300) ?? prev?.baseUrl ?? "") : "";
			let apiKey = prev?.apiKey ?? "";
			const key = text(raw.apiKey, 500);
			if (key) apiKey = key;
			if (raw.clearKey === true) apiKey = "";
			next.providers.push({
				id,
				name: text(raw.name, 40) || (kind === "cloudflare" ? "Cloudflare" : providerNameFromUrl(baseUrl)),
				kind,
				baseUrl,
				accountId,
				apiKey,
				jsonMode: typeof raw.jsonMode === "boolean" ? raw.jsonMode : (prev?.jsonMode ?? false),
				reasoning: typeof raw.reasoning === "boolean" ? raw.reasoning : (prev?.reasoning ?? false),
			});
		}
	}

	if (isObj(a.routes)) {
		for (const area of AI_AREAS) {
			const r = a.routes[area];
			if (!isObj(r)) continue;
			const cur = next.routes[area];
			const provider = text(r.provider, 40);
			const model = text(r.model, 160);
			if (provider === LOCAL_FLUX_PROVIDER && !IMAGE_AREAS.includes(area)) throw new AiError("Lokales FLUX ist nur für Studio-Bilder und Anprobe verfügbar.", 400);
			if ((provider ?? cur.provider) === LOCAL_FLUX_PROVIDER) {
				next.routes[area] = { provider: LOCAL_FLUX_PROVIDER, model: LOCAL_FLUX_MODEL, mode: "edits" };
				continue;
			}
			next.routes[area] = {
				provider: provider ?? cur.provider,
				model: model ?? cur.model,
				mode: r.mode === "chat" ? "chat" : r.mode === "edits" ? "edits" : cur.mode,
			};
		}
	}

	if (isObj(a.studio)) {
		const s = a.studio;
		if (typeof s.auto === "boolean") next.studio.auto = s.auto;
		if (typeof s.freeOnly === "boolean") next.studio.freeOnly = s.freeOnly;
		if ([20, 28, 50].includes(Number(s.steps))) next.studio.steps = Number(s.steps);
		const budget = Number(s.budget);
		if (Number.isFinite(budget) && budget >= 1000 && budget <= 1_000_000) next.studio.budget = Math.round(budget);
	}

	// Old single-provider fields: they edit the first provider and the text/vision/try-on routes.
	const legacy = ["baseUrl", "apiKey", "clearKey", "model", "visionModel", "imageModel", "tryonMode", "jsonMode", "reasoning"].some((k) => k in a);
	if (legacy && !Array.isArray(a.providers)) {
		let p = next.providers[0];
		if (!p) {
			p = { id: "p1", name: "", kind: "openai", baseUrl: "", accountId: "", apiKey: "", jsonMode: false, reasoning: false };
			next.providers.push(p);
		}
		const baseUrl = text(a.baseUrl, 300);
		if (baseUrl !== undefined) {
			p.baseUrl = cleanBaseUrl(baseUrl);
			if (!p.name) p.name = providerNameFromUrl(p.baseUrl);
		}
		const key = text(a.apiKey, 500);
		if (key) p.apiKey = key;
		if (a.clearKey === true) p.apiKey = "";
		if (typeof a.jsonMode === "boolean") p.jsonMode = a.jsonMode;
		if (typeof a.reasoning === "boolean") p.reasoning = a.reasoning;
		const model = text(a.model, 160);
		const vision = text(a.visionModel, 160);
		const image = text(a.imageModel, 160);
		const mode = a.tryonMode === "chat" ? "chat" : a.tryonMode === "edits" ? "edits" : undefined;
		if (model !== undefined) next.routes.text = { ...next.routes.text, provider: p.id, model };
		if (vision !== undefined || model !== undefined) {
			const cur = next.routes.vision.provider === p.id ? next.routes.vision.model : "";
			next.routes.vision = { ...next.routes.vision, provider: p.id, model: vision || (vision === undefined && cur) || model || cur };
		}
		if (image !== undefined) next.routes.tryon = { ...next.routes.tryon, provider: p.id, model: image };
		if (mode) next.routes.tryon.mode = mode;
	}

	// Routes pointing at a removed provider are switched off.
	const ids = new Set(next.providers.map((p) => p.id));
	for (const area of AI_AREAS) {
		const { provider } = next.routes[area];
		if (IMAGE_AREAS.includes(area) && provider === LOCAL_FLUX_PROVIDER) continue;
		if (provider && !ids.has(provider)) next.routes[area] = { ...EMPTY_ROUTE };
	}
	return next;
}
