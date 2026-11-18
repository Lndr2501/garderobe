import type { Item, ItemInput } from "../../shared/types.ts";
import { api, imgUrl, uploadImage } from "../api.ts";
import { autoEnhance, encodePair, hasTransparency, loadCanvas, refineAlpha, trimTransparent } from "./image.ts";

// v2: new enhancement (clarity) – lets existing photos be optimized once more.
const DONE_KEY = "gd-optimized-v2";

function doneMap(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, string>;
	} catch {
		return {};
	}
}

function markDone(id: string, key: string) {
	try {
		const m = doneMap();
		m[id] = key;
		localStorage.setItem(DONE_KEY, JSON.stringify(m));
	} catch {
		/* storage unavailable – worst case an item is optimized twice */
	}
}

/** Items whose current front image has not been through the optimizer on this device yet. */
export function itemsToOptimize(items: Item[]): Item[] {
	const done = doneMap();
	return items.filter((i) => i.imageFront && done[i.id] !== i.imageFront);
}

async function redo(key: string, enhance: boolean): Promise<{ full: string; thumb: string }> {
	let c = await loadCanvas(imgUrl(key)!, 1600);
	const alpha = hasTransparency(c);
	if (alpha) refineAlpha(c);
	if (enhance) autoEnhance(c, alpha);
	if (alpha) c = trimTransparent(c);
	const pair = await encodePair(c, alpha);
	const [full, thumb] = await Promise.all([uploadImage(pair.full), uploadImage(pair.thumb)]);
	return { full, thumb };
}

/** Re-encodes an item's photos: sharper thumbnails, WebP, cleaned edges, optional auto-fix. */
export async function optimizeItem(item: Item, enhance: boolean): Promise<Item> {
	const data: ItemInput = {};
	if (item.imageFront) {
		const r = await redo(item.imageFront, enhance);
		data.imageFront = r.full;
		data.thumbFront = r.thumb;
	}
	if (item.imageBack) {
		const r = await redo(item.imageBack, enhance);
		data.imageBack = r.full;
		data.thumbBack = r.thumb;
	}
	const saved = await api<Item>(`/api/items/${item.id}`, { method: "PATCH", body: data });
	if (saved.imageFront) markDone(saved.id, saved.imageFront);
	return saved;
}
