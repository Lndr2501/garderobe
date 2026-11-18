// Rule-based outfit logic. Works without any AI provider and serves as fallback.
import { colorDef, COLOR_FRIENDS, currentSeason } from "./taxonomy.ts";
import type { Item, OutfitSuggestion, TripEntry } from "./types.ts";

export interface WeatherInput {
	feelsLike: number;
	tMin?: number;
	tMax?: number;
	precipProb?: number;
}

/** 1 (very light) … 5 (very warm) */
export function targetWarmth(feelsLike: number): number {
	if (feelsLike >= 24) return 1;
	if (feelsLike >= 18) return 2;
	if (feelsLike >= 12) return 3;
	if (feelsLike >= 5) return 4;
	return 5;
}

export function needsOuterwear(w: WeatherInput): boolean {
	return w.feelsLike < 17 || (w.precipProb ?? 0) >= 50;
}

export function occasionFormality(occasion: string): number | null {
	const o = occasion.toLowerCase();
	if (/(sport|gym|training|joggen|laufen|wandern)/.test(o)) return 1;
	if (/(hochzeit|gala|beerdigung|abiball|anzug)/.test(o)) return 5;
	if (/(arbeit|büro|buero|meeting|präsentation|vorstellung|interview|bewerbung)/.test(o)) return 4;
	if (/(date|essen|restaurant|party|feier|theater|konzert|geburtstag)/.test(o)) return 3;
	if (/(schule|uni|chillen|zuhause|einkaufen|stadt|freunde)/.test(o)) return 2;
	return null;
}

export function daysSince(dateIso: string | null, today = new Date()): number | null {
	if (!dateIso) return null;
	const d = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
	return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

function isNeutral(color: string): boolean {
	return colorDef(color)?.neutral ?? true;
}

/** Score in [-2, 1]; higher means the pieces work together. */
export function colorHarmony(items: Pick<Item, "colors" | "pattern">[]): number {
	const accents = new Set<string>();
	let patterned = 0;
	for (const it of items) {
		const main = it.colors[0];
		if (main && !isNeutral(main)) accents.add(main);
		if (it.pattern && it.pattern !== "uni" && it.pattern !== "strick") patterned++;
	}
	let score = 0;
	if (accents.size <= 1) score += 1;
	else {
		const list = [...accents];
		let friendly = true;
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i]!;
				const b = list[j]!;
				if (!(COLOR_FRIENDS[a]?.includes(b) || COLOR_FRIENDS[b]?.includes(a))) friendly = false;
			}
		}
		score += friendly ? 0.3 : -1;
		if (list.length > 2) score -= 0.5;
	}
	if (patterned > 1) score -= 0.8;
	return score;
}

/** Simple deterministic PRNG so that "today's suggestion" is stable for a day. */
export function seededRandom(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return () => {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
}

interface ScoreCtx {
	warmth: number;
	formality: number | null;
	season: string;
	today: Date;
	rainy: boolean;
}

function itemScore(it: Item, ctx: ScoreCtx, warmthWeight = 1): number {
	let s = 0;
	s -= Math.abs(it.warmth - ctx.warmth) * 0.9 * warmthWeight;
	if (it.seasons.length === 0 || it.seasons.includes(ctx.season)) s += 0.6;
	else s -= 0.8;
	if (ctx.formality !== null) s -= Math.abs(it.formality - ctx.formality) * 0.7;
	const since = daysSince(it.lastWorn, ctx.today);
	s += since === null ? 0.8 : Math.min(since, 21) / 21;
	if (it.favorite) s += 0.35;
	if (ctx.rainy && it.waterproof) s += 0.8;
	return s;
}

function pickWeighted<T>(cands: { v: T; s: number }[], rnd: () => number, exclude: Set<T>): T | null {
	const pool = cands.filter((c) => !exclude.has(c.v));
	if (pool.length === 0) return null;
	pool.sort((a, b) => b.s - a.s);
	const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 3)));
	const min = Math.min(...top.map((t) => t.s));
	const weights = top.map((t) => t.s - min + 0.25);
	const sum = weights.reduce((a, b) => a + b, 0);
	let r = rnd() * sum;
	for (let i = 0; i < top.length; i++) {
		r -= weights[i]!;
		if (r <= 0) return top[i]!.v;
	}
	return top[0]!.v;
}

export interface SuggestOptions {
	weather: WeatherInput;
	occasion?: string;
	count?: number;
	seed?: string;
	today?: Date;
}

export function suggestOutfits(allItems: Item[], opts: SuggestOptions): OutfitSuggestion[] {
	const items = allItems.filter((i) => i.status === "active");
	const today = opts.today ?? new Date();
	const ctx: ScoreCtx = {
		warmth: targetWarmth(opts.weather.feelsLike),
		formality: occasionFormality(opts.occasion ?? ""),
		season: currentSeason(today),
		today,
		rainy: (opts.weather.precipProb ?? 0) >= 50,
	};
	const rnd = seededRandom(opts.seed ?? today.toISOString().slice(0, 10) + (opts.occasion ?? ""));
	const byCat = (cat: string, weight = 1) =>
		items.filter((i) => i.category === cat).map((v) => ({ v, s: itemScore(v, ctx, weight) }));

	const tops = byCat("top");
	const dresses = byCat("dress");
	const bottoms = byCat("bottom");
	const shoes = byCat("shoes", 0.6);
	const outer = byCat("outerwear");
	const accessories = byCat("accessory", 0.5);
	const wantOuter = needsOuterwear(opts.weather);

	const results: OutfitSuggestion[] = [];
	const usedMain = new Set<Item>();
	const count = opts.count ?? 3;
	for (let attempt = 0; attempt < count * 6 && results.length < count; attempt++) {
		const chosen: Item[] = [];
		const useDress = dresses.length > 0 && (tops.length === 0 || bottoms.length === 0 || rnd() < 0.25);
		if (useDress) {
			const d = pickWeighted(dresses, rnd, usedMain);
			if (!d) continue;
			chosen.push(d);
		} else {
			const t = pickWeighted(tops, rnd, usedMain);
			if (!t) break;
			chosen.push(t);
			const b = pickWeighted(
				bottoms.map((c) => ({ v: c.v, s: c.s + colorHarmony([t, c.v]) })),
				rnd,
				new Set(),
			);
			if (b) chosen.push(b);
		}
		if (wantOuter) {
			const o = pickWeighted(
				outer.map((c) => ({ v: c.v, s: c.s + colorHarmony([...chosen, c.v]) })),
				rnd,
				new Set(),
			);
			if (o) chosen.push(o);
		}
		const sh = pickWeighted(
			shoes.map((c) => ({ v: c.v, s: c.s + colorHarmony([...chosen, c.v]) * 0.6 })),
			rnd,
			new Set(),
		);
		if (sh) chosen.push(sh);
		if (ctx.warmth >= 5 && accessories.length > 0) {
			const warmAcc = accessories.filter((a) => a.v.warmth >= 3);
			const a = pickWeighted(warmAcc.length ? warmAcc : accessories, rnd, new Set());
			if (a) chosen.push(a);
		}
		const key = chosen
			.map((c) => c.id)
			.sort()
			.join(",");
		if (results.some((r) => [...r.itemIds].sort().join(",") === key)) continue;
		usedMain.add(chosen[0]!);
		results.push({
			name: outfitName(chosen, ctx),
			itemIds: chosen.map((c) => c.id),
			reason: outfitReason(opts.weather, ctx, wantOuter),
			source: "rules",
		});
	}
	return results;
}

function outfitName(chosen: Item[], ctx: ScoreCtx): string {
	const main = chosen[0];
	const vibe =
		ctx.formality === 1
			? "Sporty"
			: ctx.formality !== null && ctx.formality >= 4
				? "Schick"
				: ctx.warmth >= 4
					? "Kuschelig"
					: ctx.warmth <= 2
						? "Leicht & luftig"
						: "Easy";
	return main ? `${vibe} mit ${main.name || "Lieblingsteil"}` : vibe;
}

function outfitReason(w: WeatherInput, ctx: ScoreCtx, outer: boolean): string {
	const parts = [`gefühlt ${Math.round(w.feelsLike)} °C`];
	if (outer) parts.push(ctx.rainy ? "Regen möglich, also mit Jacke" : "mit Jacke");
	if (ctx.formality !== null) parts.push("passend zum Anlass");
	parts.push("lange nicht getragene Teile bevorzugt");
	return parts.join(" · ");
}

export interface PackingOptions {
	days: number;
	avgFeelsLike: number;
	rainy: boolean;
	activities: string[];
}

export function packingList(allItems: Item[], opts: PackingOptions): TripEntry[] {
	const items = allItems.filter((i) => i.status === "active");
	const days = Math.max(1, Math.min(opts.days, 30));
	const ctx: ScoreCtx = {
		warmth: targetWarmth(opts.avgFeelsLike),
		formality: opts.activities.includes("business") ? 4 : null,
		season: currentSeason(),
		today: new Date(),
		rainy: opts.rainy,
	};
	const take = (cat: string, n: number, reason: string, filter?: (i: Item) => boolean) => {
		const ranked = items
			.filter((i) => i.category === cat && (!filter || filter(i)))
			.map((i) => ({ i, s: itemScore(i, { ...ctx, today: new Date(0) }) }))
			.sort((a, b) => b.s - a.s)
			.slice(0, n);
		return ranked.map<TripEntry>((r) => ({ itemId: r.i.id, reason, checked: false }));
	};
	const tops = Math.min(days + (days > 3 ? 1 : 0), 8);
	const bottoms = Math.max(1, Math.min(Math.ceil(days / 3), 4));
	const entries: TripEntry[] = [
		...take("top", tops, "Oberteil für jeden Tag"),
		...take("bottom", bottoms, "lässt sich mehrfach kombinieren"),
	];
	if (ctx.warmth >= 3 || opts.rainy) entries.push(...take("outerwear", 1, opts.rainy ? "Regen erwartet" : "für kühle Abende"));
	entries.push(...take("shoes", days > 2 ? 2 : 1, "bequem und passend"));
	if (opts.activities.includes("sport") || opts.activities.includes("wandern"))
		entries.push(...take("shoes", 1, "für Sport/Wandern", (i) => i.styleTags.includes("sport") || i.styleTags.includes("outdoor")));
	if (opts.activities.includes("party") || opts.activities.includes("business"))
		entries.push(...take("top", 1, "für den schicken Anlass", (i) => i.formality >= 3));
	if (ctx.warmth >= 5) entries.push(...take("accessory", 2, "gegen die Kälte", (i) => i.warmth >= 3));
	if (ctx.warmth >= 5 || opts.activities.includes("schnee")) entries.push(...take("base", 2, "Thermo-Schicht gegen die Kälte"));
	const socks = take("socks", Math.min(days + 1, 7), "frische Socken");
	const seen = new Set<string>();
	const unique = entries.filter((e) => {
		if (!e.itemId || seen.has(e.itemId)) return false;
		seen.add(e.itemId);
		return true;
	});
	const extras: TripEntry[] = [
		{ text: "Unterwäsche", qty: days + 1, checked: false },
		...(socks.length ? [] : [{ text: "Socken", qty: days + 1, checked: false }]),
		{ text: "Schlafsachen", qty: 1, checked: false },
		{ text: "Kulturbeutel", qty: 1, checked: false },
		{ text: "Ladekabel", qty: 1, checked: false },
	];
	if (opts.rainy) extras.push({ text: "Regenschirm", qty: 1, checked: false });
	if (opts.activities.includes("strand")) {
		extras.push({ text: "Badesachen", qty: 1, checked: false }, { text: "Sonnencreme", qty: 1, checked: false });
	}
	if (opts.activities.includes("schnee")) extras.push({ text: "Handschuhe & Mütze", qty: 1, checked: false });
	return [...unique, ...socks.filter((e) => !seen.has(e.itemId!)), ...extras];
}

/** Items that look like duplicates of a candidate (same category + main color). */
export function similarItems(allItems: Item[], category: string, colors: string[]): Item[] {
	return allItems.filter(
		(i) => i.status === "active" && i.category === category && colors.length > 0 && i.colors[0] === colors[0],
	);
}

/** Items that pair well with a candidate (other categories, harmonious colors). */
export function pairingItems(allItems: Item[], category: string, colors: string[], pattern = "uni"): Item[] {
	const cand = { colors, pattern };
	const complementary: Record<string, string[]> = {
		top: ["bottom", "outerwear", "shoes"],
		bottom: ["top", "outerwear", "shoes"],
		outerwear: ["top", "bottom", "dress"],
		dress: ["outerwear", "shoes", "bag"],
		shoes: ["bottom", "dress"],
		bag: ["dress", "outerwear", "top"],
		accessory: ["outerwear", "top"],
		other: ["top", "bottom"],
		base: ["top", "bottom", "socks"],
		socks: ["shoes", "bottom"],
	};
	const cats = complementary[category] ?? [];
	return allItems
		.filter((i) => i.status === "active" && cats.includes(i.category))
		.map((i) => ({ i, s: colorHarmony([cand, i]) }))
		.filter((x) => x.s > 0.5)
		.sort((a, b) => b.s - a.s)
		.map((x) => x.i);
}
