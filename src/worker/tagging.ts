// Server-side garment recognition. Runs as a durable background job so slow AI providers
// (30–150 s per photo) never lose a result: retries, survives restarts, no dependency on the open app.
import { STYLE_TAGS, type CategoryKey } from "../shared/taxonomy.ts";
import type { ItemInput } from "../shared/types.ts";
import { aiConfigured, chatJson, type AiConfig } from "./ai.ts";
import { loadAi } from "./aisettings.ts";
import { ensureSchema, ITEM_COLUMNS, now } from "./db.ts";
import { deleteImages, getImageBytes, toDataUrl, type ImageEnv } from "./images.ts";
import { NonRetryableError, type JobQueue, type Step } from "./jobs.ts";
import type { Db } from "./platform.ts";
import { taggingPrompt } from "./prompts.ts";
import { sanitizeItem, str } from "./validate.ts";

export interface TagParams {
	itemId: string;
	/** Image key of a JPEG on a light background made for the vision model; deleted afterwards. */
	aiImage: string;
	colorHint?: string;
}

export interface TagEnv extends ImageEnv {
	DB: Db;
	TAGGER?: JobQueue<TagParams>;
}

export interface TagResult {
	tags: ItemInput;
	needsReview?: boolean;
	/** Clockwise degrees to turn the photo so the piece is upright. */
	rotate: number;
}

/** Fields the AI may fill. Everything else (price, size, notes …) is the user's. */
export const AI_FIELDS = [
	"name",
	"category",
	"subcategory",
	"colors",
	"material",
	"pattern",
	"fit",
	"styleTags",
	"seasons",
	"warmth",
	"formality",
	"waterproof",
	"brand",
] as const;

/** Every field a user can lock by editing it (AI fields + rotation). */
export const LOCKABLE = new Set<string>([...AI_FIELDS, "rotate"]);

const UPRIGHT: Record<string, number> = { oben: 0, links: 90, unten: 180, rechts: 270 };
const SOLE_DOWN: Record<string, number> = { unten: 0, rechts: 90, oben: 180, links: 270 };

/**
 * Rotation from the side the model saw collar/waistband (should be on top) or sole (bottom).
 * Clockwise by 90° moves left → top and right → bottom.
 */
export function rotationFor(category: CategoryKey | undefined, anchor: string | undefined): number {
	if (!anchor || !category) return 0;
	const a = anchor.trim().toLowerCase();
	if (category === "top" || category === "outerwear" || category === "dress" || category === "bottom" || category === "base") return UPRIGHT[a] ?? 0;
	if (category === "shoes") return SOLE_DOWN[a] ?? 0;
	return 0;
}

export async function tagImage(ai: AiConfig, imageDataUrl: string, colorHint?: string): Promise<TagResult> {
	const ask = colorHint
		? `Analysiere dieses Kleidungsstück. Hinweis aus der Pixelanalyse: Die häufigste Farbe ähnelt „${colorHint}“ (kann durch Licht verfälscht sein).`
		: "Analysiere dieses Kleidungsstück.";
	const raw = await chatJson<Record<string, unknown>>(
		ai,
		[
			{ role: "system", content: taggingPrompt() },
			{
				role: "user",
				content: [
					{ type: "text", text: ask },
					{ type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
				],
			},
		],
		{ temperature: 0.1, maxTokens: 900 },
	);
	return parseRecognition(raw);
}

export function parseRecognition(raw: Record<string, unknown>): TagResult {
	if (raw.subject !== undefined && raw.subject !== "single") return { tags: {}, rotate: 0, needsReview: true };
	const tags = sanitizeItem(raw);
	if (tags.styleTags) tags.styleTags = tags.styleTags.filter((tag) => STYLE_TAGS.includes(tag));
	for (const k of Object.keys(tags)) if (!(AI_FIELDS as readonly string[]).includes(k)) delete tags[k as keyof ItemInput];
	return { tags, needsReview: !tags.category || tags.category === "other" || !tags.subcategory || !tags.name, rotate: rotationFor(tags.category, str(raw.anker ?? raw.anchor, 12)) };
}

/** Writes an AI result into the item, skipping fields the user set by hand. */
export async function applyTags(db: Db, itemId: string, result: TagResult): Promise<boolean> {
	const row = await db.prepare(`SELECT user_fields FROM items WHERE id = ?`).bind(itemId).first<{ user_fields: string }>();
	if (!row) return false;
	let locked: string[] = [];
	try {
		locked = JSON.parse(row.user_fields) as string[];
	} catch {
		/* keep empty */
	}
	const sets: string[] = [];
	const vals: unknown[] = [];
	for (const [k, v] of Object.entries(result.tags)) {
		if (locked.includes(k) || v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
		const def = ITEM_COLUMNS[k];
		if (!def) continue;
		sets.push(`${def[0]} = ?`);
		vals.push(def[1](v));
	}
	if (result.rotate && !locked.includes("rotate")) {
		sets.push("rotate = ?");
		vals.push(result.rotate);
	}
	sets.push("ai_state = 'done'", "ai_error = ''", "ai_image = NULL", "needs_review = ?", "updated_at = ?");
	vals.push(result.needsReview ? 1 : 0, now(), itemId);
	await db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
	return true;
}

/** Marks the item as waiting and queues the job. Falls back to "failed" when it cannot start. */
export async function startTagging(env: TagEnv, params: TagParams): Promise<void> {
	await env.DB.prepare(`UPDATE items SET ai_state = 'pending', ai_error = '', ai_image = ?, updated_at = ? WHERE id = ?`)
		.bind(params.aiImage, now(), params.itemId)
		.run();
	try {
		if (!env.TAGGER) throw new Error("Hintergrund-Erkennung ist hier nicht verfügbar");
		await env.TAGGER.create({ params });
	} catch (err) {
		await env.DB.prepare(`UPDATE items SET ai_state = 'failed', needs_review = 1, ai_error = ? WHERE id = ?`)
			.bind(String((err as Error).message).slice(0, 300), params.itemId)
			.run();
	}
}

/** The recognition job: ask the AI (with retries), store the result, drop the helper image. */
export async function runTagJob(env: TagEnv, params: TagParams, step: Step): Promise<void> {
	const { itemId, aiImage, colorHint } = params;
	let result: TagResult | null = null;
	let error = "";
	try {
		result = await step.do(
			"ask-ai",
			{ retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "6 minutes" },
			async () => {
				await ensureSchema(env.DB);
				const ai = await loadAi(env.DB, "vision");
				if (!aiConfigured(ai)) throw new NonRetryableError("Keine KI für die Erkennung eingerichtet (Einstellungen → KI).");
				const img = await getImageBytes(env, aiImage);
				if (!img) throw new NonRetryableError("Bild für die Erkennung fehlt.");
				return await tagImage(ai, toDataUrl(img.data, img.type), colorHint);
			},
		);
	} catch (err) {
		error = (err as Error).message || "KI-Erkennung fehlgeschlagen";
	}
	await step.do("save", async () => {
		if (result) await applyTags(env.DB, itemId, result);
		else
			await env.DB.prepare(`UPDATE items SET ai_state = 'failed', needs_review = 1, ai_error = ?, ai_image = NULL WHERE id = ?`)
				.bind(error.slice(0, 300), itemId)
				.run();
	});
	await step.do("cleanup", async () => {
		await deleteImages(env, [aiImage]);
	});
}
