// "KI-Studio": turns the user's photo of a piece into a clean product shot (FLUX.2 on Cloudflare,
// or any image model of the chosen provider). Durable background job; on Cloudflare it keeps to the
// free daily allowance and simply waits for the next day when it is used up.
import { LOCAL_FLUX_PROVIDER } from "../shared/types.ts";
import { AiError, aiConfigured, generateImage } from "./ai.ts";
import { configFor, exhaustUsage, loadAiStore, msUntilNextUtcDay, releaseUsage, reserveUsage } from "./aisettings.ts";
import { now, parseJson } from "./db.ts";
import { deleteImages, getImageBytes, newImageKey, putImage, type ImageEnv } from "./images.ts";
import { NonRetryableError, type JobQueue, type Step } from "./jobs.ts";
import type { Db } from "./platform.ts";
import { localStudioPrompt, studioPrompt } from "./prompts.ts";

export interface StudioParams {
	itemId: string;
	/** Only the newest job of an item may write its result. */
	jobId: string;
	/** Disposable reference JPEG, unless original or repair points at a stored photo. */
	input: string;
	/** Existing opaque Studio PNG; only run foreground segmentation, not FLUX again. */
	repair?: true;
	/** Use the stored original without any generative redraw. */
	original?: true;
}

export interface StudioEnv extends ImageEnv {
	DB: Db;
	STUDIO?: JobQueue<StudioParams>;
	LOCAL_STUDIO?: JobQueue<StudioParams>;
	FLUX_STUDIO?: LocalStudio;
}

export type StudioReference = { data: ArrayBuffer; type: string };
export type StudioCutout = { full: Uint8Array; thumb: Uint8Array };
export interface LocalStudio {
	tryOn?(prompt: string, images: StudioReference[]): Promise<StudioReference>;
	generate(prompt: string, image: StudioReference, size: { width: number; height: number }): Promise<StudioCutout>;
	cutout(image: StudioReference): Promise<StudioCutout>;
}

export function localStudioAvailable(env: StudioEnv): boolean {
	return !!(env.LOCAL_STUDIO && env.FLUX_STUDIO);
}

export function studioSize(category: string): { width: number; height: number } {
	return category === "shoes" || category === "bag" ? { width: 1024, height: 768 } : { width: 768, height: 1024 };
}

const TILE = 512 * 512;
const USD_PER_NEURON = 0.011 / 1000;

/**
 * Workers AI price of FLUX.2 [dev]: $0.00021 per 512² input tile and $0.00041 per 512² output tile,
 * each per step – converted to neurons (the unit of the free allowance).
 */
export function fluxNeurons(inputs: { w: number; h: number }[], out: { w: number; h: number }, steps: number): number {
	const tiles = (d: { w: number; h: number }) => Math.ceil((d.w * d.h) / TILE);
	const inTiles = inputs.reduce((s, d) => s + tiles(d), 0);
	return Math.ceil(((inTiles * 0.00021 + tiles(out) * 0.00041) * steps) / USD_PER_NEURON);
}

/** Width/height from a PNG, JPEG or WebP header (null if unknown). */
export function imageDims(b: Uint8Array): { w: number; h: number } | null {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
	if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = b[i + 1]!;
			const len = dv.getUint16(i + 2);
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
			}
			i += 2 + len;
		}
		return null;
	}
	if (b.length > 30 && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
		const chunk = String.fromCharCode(...b.subarray(12, 16));
		if (chunk === "VP8X") return { w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
		if (chunk === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
		if (chunk === "VP8L") {
			const bits = dv.getUint32(21, true);
			return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
		}
	}
	return null;
}

/** Queues a studio picture for an item (replaces a running one). */
export async function startStudio(
	env: StudioEnv, itemId: string, input: string, { local = false, repair = false, original = false } = {},
): Promise<void> {
	const queue = local ? env.LOCAL_STUDIO : env.STUDIO;
	const jobId = crypto.randomUUID();
	const guard = repair ? " AND studio_state = 'done' AND thumb_studio IS NULL AND image_studio = ?" : "";
	const update = await env.DB.prepare(
		`UPDATE items SET studio_state = 'queued', studio_error = '', studio_input = ?, studio_job = ?,
		 prefer_original = CASE WHEN ? THEN 1 ELSE prefer_original END, updated_at = ? WHERE id = ?${guard}`,
	).bind(input, jobId, original, now(), itemId, ...(repair ? [input] : [])).run();
	if (!update.meta.changes) return;
	try {
		if (!queue) throw new Error("Studio-Bilder sind hier nicht verfügbar");
		await queue.create({ id: jobId, params: { itemId, jobId, input, ...(repair ? { repair: true } : {}), ...(original ? { original: true } : {}) } });
	} catch (err) {
		await env.DB.prepare(`UPDATE items SET studio_state = 'failed', studio_error = ?, studio_input = NULL WHERE id = ? AND studio_job = ?`)
			.bind(String((err as Error).message).slice(0, 300), itemId, jobId)
			.run();
		if (!repair && !original) await deleteImages(env, [input]);
	}
}

/** Upgrade opaque PNGs made by the original local job without redrawing the garment. */
export async function repairLegacyStudio(env: StudioEnv): Promise<void> {
	if (!localStudioAvailable(env)) return;
	const { results } = await env.DB.prepare(
		`SELECT id, image_studio FROM items WHERE studio_state = 'done' AND thumb_studio IS NULL
		 AND image_studio = 'studio/' || studio_job || '.png'
		 AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id = items.studio_job AND jobs.state IN ('queued', 'running'))`,
	).all<{ id: string; image_studio: string }>();
	for (const item of results) await startStudio(env, item.id, item.image_studio, { local: true, repair: true });
}

export async function runLocalStudioJob(env: StudioEnv, { itemId, jobId, input, repair, original }: StudioParams, step: Step): Promise<void> {
	const db = env.DB;
	try {
		const output = await step.do<{ full: string; thumb: string } | string | null>("generate-local", async () => {
			const result = await db.prepare(`UPDATE items SET studio_state = 'running', updated_at = ? WHERE id = ? AND studio_job = ?`)
				.bind(now(), itemId, jobId).run();
			if (!result.meta.changes) return null;
			const img = await getImageBytes(env, input);
			if (!img) throw new NonRetryableError("Ausgangsbild fehlt.");
			if (!env.FLUX_STUDIO) throw new NonRetryableError("Der lokale FLUX-Anbieter ist nicht eingerichtet.");
			const item = await db.prepare(`SELECT category, subcategory, name, colors FROM items WHERE id = ?`)
				.bind(itemId).first<{ category: string; subcategory: string; name: string; colors: string }>();
			const colors = parseJson<string[]>(item?.colors, []);
			const rendered = repair || original
				? await env.FLUX_STUDIO.cutout(img)
				: await env.FLUX_STUDIO.generate(localStudioPrompt(item?.category ?? "", item?.subcategory ?? "", item?.name ?? "", Array.isArray(colors) ? colors : []), img, studioSize(item?.category ?? ""));
			const full = newImageKey("image/png", "studio");
			const thumb = newImageKey("image/png", "studio");
			await Promise.all([putImage(env, full, rendered.full, "image/png"), putImage(env, thumb, rendered.thumb, "image/png")]);
			return { full, thumb };
		});
		if (!output) return;
		// A step completed by the previous version stored just the opaque PNG key.
		// Finish clipping it instead of publishing it or rerunning FLUX.
		const { full, thumb } = typeof output === "string"
			? await step.do("finish-legacy-local", async () => {
					const img = await getImageBytes(env, output);
					if (!img || !env.FLUX_STUDIO) throw new Error("Studio-Ausgangsbild fehlt.");
					const rendered = await env.FLUX_STUDIO.cutout(img);
					const full = newImageKey("image/png", "studio");
					const thumb = newImageKey("image/png", "studio");
					await Promise.all([putImage(env, full, rendered.full, "image/png"), putImage(env, thumb, rendered.thumb, "image/png")]);
					return { full, thumb };
				})
			: output;

		await step.do("publish-cutout", async () => {
			const previous = await db.prepare(`SELECT image_studio, thumb_studio, studio_raw FROM items WHERE id = ? AND studio_job = ?`)
				.bind(itemId, jobId).first<{ image_studio: string | null; thumb_studio: string | null; studio_raw: string | null }>();
			const result = await db.prepare(
				`UPDATE items SET studio_state = 'done', image_studio = ?, thumb_studio = ?, studio_raw = NULL,
				 studio_error = '', prefer_original = CASE WHEN ? THEN prefer_original ELSE 0 END, updated_at = ?
				 WHERE id = ? AND studio_job = ? AND (NOT ? OR coalesce(image_front, thumb_front) = ?)`,
			).bind(full, thumb, !!repair, now(), itemId, jobId, !!original, input).run();
			if (!result.meta.changes) {
				await deleteImages(env, [full, thumb]);
				if (original) throw new Error("Das Originalfoto wurde inzwischen geändert. Bitte erneut freistellen.");
			}
			// Retain previous files during a switch to the original or an upgrade, for rollback.
			else if (previous && !repair && !original) await deleteImages(env, Object.values(previous).filter((old) => old !== full && old !== thumb));
			if (typeof output === "string") await deleteImages(env, [output]);
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Studio-Bild fehlgeschlagen.";
		await db.prepare(`UPDATE items SET studio_state = 'failed', studio_error = ?, updated_at = ? WHERE id = ? AND studio_job = ?`)
			.bind(message.slice(0, 300), now(), itemId, jobId).run();
	} finally {
		await step.do("cleanup-local", async () => {
			if (!repair && !original) await deleteImages(env, [input]);
			await db.prepare(`UPDATE items SET studio_input = NULL WHERE id = ? AND studio_input = ?`).bind(itemId, input).run();
		});
	}
}

const QUOTA_DAYS = 14;

export async function runStudioJob(env: StudioEnv, params: StudioParams, step: Step): Promise<void> {
	const { itemId, jobId, input } = params;
	const db = env.DB;
	const isCurrent = async () =>
		(await db.prepare(`SELECT studio_job FROM items WHERE id = ?`).bind(itemId).first<{ studio_job: string | null }>())?.studio_job === jobId;
	const setState = (state: string, error = "") =>
		db.prepare(`UPDATE items SET studio_state = ?, studio_error = ? WHERE id = ? AND studio_job = ?`).bind(state, error.slice(0, 300), itemId, jobId).run();

	let raw: string | null = null;
	let error = "";
	try {
		for (let n = 0; n < QUOTA_DAYS && !raw; n++) {
			const plan = await step.do(`plan-${n}`, async () => {
				if (!(await isCurrent())) return { stop: true, ok: false, neurons: 0, provider: "" };
				const store = await loadAiStore(db);
				const cfg = configFor(store, "studio");
				if (!aiConfigured(cfg)) throw new NonRetryableError("Kein Bild-Anbieter für Studio-Bilder eingerichtet (Einstellungen → KI).");
				const img = await env.IMAGES.get(input);
				if (!img) throw new NonRetryableError("Ausgangsbild fehlt.");
				const item = await db.prepare(`SELECT category FROM items WHERE id = ?`).bind(itemId).first<{ category: string }>();
				const size = studioSize(item?.category ?? "");
				const dims = imageDims(img.data) ?? { w: 1024, h: 1024 };
				const metered = cfg.kind === "cloudflare";
				const neurons = metered ? fluxNeurons([dims], { w: size.width, h: size.height }, store.studio.steps) : 0;
				const budget = metered && store.studio.freeOnly ? store.studio.budget : null;
				if (budget !== null && neurons > budget) throw new NonRetryableError("Ein Bild braucht mehr als das Tagesbudget – weniger Schritte wählen.");
				const ok = await reserveUsage(db, cfg.providerId, neurons, budget);
				return { stop: false, ok, neurons, provider: cfg.providerId };
			});
			if (plan.stop) return;
			if (!plan.ok) {
				await step.do(`waiting-${n}`, () => setState("waiting"));
				await step.sleep(`wait-${n}`, msUntilNextUtcDay());
				continue;
			}
			let out: { key: string | null; quota: boolean };
			try {
				out = await step.do(`generate-${n}`, { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" }, async () => {
					if (!(await isCurrent())) return { key: null, quota: false };
					await setState("running");
					const store = await loadAiStore(db);
					if (store.routes.studio.provider === LOCAL_FLUX_PROVIDER) throw new NonRetryableError("Studio-Anbieter wurde geändert. Starte das Studio-Bild erneut.");
					const cfg = configFor(store, "studio");
					const img = await getImageBytes(env, input);
					if (!img) throw new NonRetryableError("Ausgangsbild fehlt.");
					const item = await db
						.prepare(`SELECT category, subcategory FROM items WHERE id = ?`)
						.bind(itemId)
						.first<{ category: string; subcategory: string }>();
					const size = studioSize(item?.category ?? "");
					try {
						const res = await generateImage(cfg, studioPrompt(item?.category ?? "", item?.subcategory ?? ""), [{ ...img, name: `ref.${img.type.split("/")[1]}` }], {
							...size,
							steps: store.studio.steps,
						});
						const key = newImageKey(res.type, "studio");
						await putImage(env, key, res.data, res.type);
						return { key, quota: false };
					} catch (err) {
						if (err instanceof AiError && err.status === 429 && /Tageskontingent/.test(err.message)) {
							await exhaustUsage(db, cfg.providerId, store.studio.budget);
							return { key: null, quota: true };
						}
						throw err;
					}
				});
			} catch (err) {
				await step.do(`release-${n}`, () => releaseUsage(db, plan.provider, plan.neurons));
				throw err;
			}
			if (out.quota) {
				await step.do(`waiting-q-${n}`, () => setState("waiting"));
				await step.sleep(`wait-q-${n}`, msUntilNextUtcDay());
				continue;
			}
			if (!out.key) return;
			raw = out.key;
		}
		if (!raw) error = "Das Tageskontingent war zu lange aufgebraucht.";
	} catch (err) {
		error = (err as Error).message || "Studio-Bild fehlgeschlagen";
	} finally {
		await step.do("cleanup", async () => {
			await deleteImages(env, [input]);
			await db.prepare(`UPDATE items SET studio_input = NULL WHERE id = ? AND studio_input = ?`).bind(itemId, input).run();
		});
	}
	await step.do("save", async () => {
		if (!(await isCurrent())) {
			if (raw) await deleteImages(env, [raw]);
			return;
		}
		if (raw) {
			await db.prepare(`UPDATE items SET studio_state = 'raw', studio_raw = ?, studio_error = '', updated_at = ? WHERE id = ? AND studio_job = ?`)
				.bind(raw, now(), itemId, jobId)
				.run();
		} else await setState("failed", error);
	});
}
