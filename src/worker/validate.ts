import { CATEGORY_KEYS, COLOR_KEYS, PATTERNS, SEASON_KEYS } from "../shared/taxonomy.ts";
import type { ItemInput, OutfitInput, TripEntry } from "../shared/types.ts";
import { isValidKey } from "./images.ts";

type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown, max = 200): string | undefined {
	if (typeof v !== "string") return undefined;
	return v.trim().slice(0, max);
}

function strList(v: unknown, allowed?: string[], max = 20): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: string[] = [];
	for (const x of v) {
		if (typeof x !== "string") continue;
		const s = x.trim().toLowerCase().slice(0, 40);
		if (!s || out.includes(s)) continue;
		if (allowed && !allowed.includes(s)) continue;
		out.push(s);
		if (out.length >= max) break;
	}
	return out;
}

function int(v: unknown, min: number, max: number): number | undefined {
	const n = typeof v === "string" ? Number(v) : v;
	if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
	return Math.max(min, Math.min(max, Math.round(n)));
}

function bool(v: unknown): boolean | undefined {
	return typeof v === "boolean" ? v : undefined;
}

function imageKey(v: unknown): string | null | undefined {
	if (v === null) return null;
	if (typeof v === "string" && isValidKey(v)) return v;
	return undefined;
}

function dateStr(v: unknown): string | null | undefined {
	if (v === null || v === "") return null;
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
	return undefined;
}

export function isDate(v: unknown): v is string {
	return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Maps a loosely typed object (from client or AI) to a clean ItemInput. Unknown/invalid fields are dropped. */
export function sanitizeItem(raw: unknown): ItemInput {
	if (!isObj(raw)) return {};
	const out: ItemInput = {};
	const name = str(raw.name, 80);
	if (name !== undefined) out.name = name;
	const cat = str(raw.category, 20)?.toLowerCase();
	if (cat && CATEGORY_KEYS.includes(cat as never)) out.category = cat as ItemInput["category"];
	const sub = str(raw.subcategory, 60);
	if (sub !== undefined) out.subcategory = sub;
	const colors = strList(raw.colors, COLOR_KEYS, 5);
	if (colors) out.colors = colors;
	const hex = str(raw.colorHex, 7);
	if (hex !== undefined && (hex === "" || /^#[0-9a-fA-F]{6}$/.test(hex))) out.colorHex = hex;
	for (const k of ["material", "fit", "brand", "size"] as const) {
		const v = str(raw[k], 60);
		if (v !== undefined) out[k] = v;
	}
	const pattern = str(raw.pattern, 20)?.toLowerCase();
	if (pattern !== undefined && (pattern === "" || PATTERNS.includes(pattern))) out.pattern = pattern;
	const tags = strList(raw.styleTags, undefined, 10);
	if (tags) out.styleTags = tags;
	const seasons = strList(raw.seasons, SEASON_KEYS, 4);
	if (seasons) out.seasons = seasons;
	const warmth = int(raw.warmth, 1, 5);
	if (warmth !== undefined) out.warmth = warmth;
	const formality = int(raw.formality, 1, 5);
	if (formality !== undefined) out.formality = formality;
	const wp = bool(raw.waterproof);
	if (wp !== undefined) out.waterproof = wp;
	if (raw.price === null || raw.price === "") out.price = null;
	else if (typeof raw.price === "number" || typeof raw.price === "string") {
		const p = Number(String(raw.price).replace(",", "."));
		if (Number.isFinite(p) && p >= 0 && p < 1_000_000) out.price = Math.round(p * 100) / 100;
	}
	const pa = dateStr(raw.purchasedAt);
	if (pa !== undefined) out.purchasedAt = pa;
	const notes = str(raw.notes, 2000);
	if (notes !== undefined) out.notes = notes;
	for (const k of ["imageFront", "thumbFront", "imageBack", "thumbBack"] as const) {
		const v = imageKey(raw[k]);
		if (v !== undefined) out[k] = v;
	}
	const fav = bool(raw.favorite);
	if (fav !== undefined) out.favorite = fav;
	if (raw.status === "active" || raw.status === "archived") out.status = raw.status;
	const nr = bool(raw.needsReview);
	if (nr !== undefined) out.needsReview = nr;
	if (raw.rotate === 0 || raw.rotate === 90 || raw.rotate === 180 || raw.rotate === 270) out.rotate = raw.rotate;
	const po = bool(raw.preferOriginal);
	if (po !== undefined) out.preferOriginal = po;
	return out;
}

export function sanitizeOutfit(raw: unknown): OutfitInput {
	if (!isObj(raw)) return {};
	const out: OutfitInput = {};
	const name = str(raw.name, 80);
	if (name !== undefined) out.name = name;
	if (Array.isArray(raw.itemIds)) out.itemIds = raw.itemIds.filter((x): x is string => typeof x === "string").slice(0, 12);
	const occ = str(raw.occasion, 80);
	if (occ !== undefined) out.occasion = occ;
	const fav = bool(raw.favorite);
	if (fav !== undefined) out.favorite = fav;
	const notes = str(raw.notes, 1000);
	if (notes !== undefined) out.notes = notes;
	return out;
}

export function sanitizeEntries(raw: unknown): TripEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: TripEntry[] = [];
	for (const e of raw.slice(0, 200)) {
		if (!isObj(e)) continue;
		const itemId = str(e.itemId, 64);
		const text = str(e.text, 120);
		if (!itemId && !text) continue;
		out.push({
			...(itemId ? { itemId } : {}),
			...(text ? { text } : {}),
			...(typeof e.qty === "number" && e.qty > 0 ? { qty: Math.min(99, Math.round(e.qty)) } : {}),
			...(str(e.reason, 120) ? { reason: str(e.reason, 120) } : {}),
			checked: e.checked === true,
		});
	}
	return out;
}
