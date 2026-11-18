// Layered outfits: every piece sits in a body zone, and within a zone the pieces are ordered
// from the inside out (thermal shirt → T-shirt → sweater → jacket). Outfits store their item
// ids in exactly that order, zone by zone.
import type { Item } from "./types.ts";

export type Zone = "torso" | "legs" | "feet" | "extras";

export const ZONES: { key: Zone; label: string; max: number }[] = [
	{ key: "torso", label: "Oberkörper", max: 5 },
	{ key: "legs", label: "Beine", max: 3 },
	{ key: "feet", label: "Füße", max: 3 },
	{ key: "extras", label: "Extras", max: 4 },
];

type Piece = Pick<Item, "category" | "subcategory" | "name">;

const LEG_WORDS = /hose|leggings|tights|strumpfhose|boxer|slip|pants|unterteil|shorts|legging/i;

export function zoneOf(item: Piece): Zone {
	switch (item.category) {
		case "top":
		case "dress":
		case "outerwear":
			return "torso";
		case "bottom":
			return "legs";
		case "base":
			return LEG_WORDS.test(`${item.subcategory} ${item.name}`) ? "legs" : "torso";
		case "socks":
		case "shoes":
			return "feet";
		default:
			return "extras";
	}
}

const MID = /pullover|pulli|hoodie|sweat|strick|cardigan|half-?zip|fleece|rollkragen|troyer|knit/i;
const LIGHT_OUTER = /weste|blazer|gilet|overshirt|hemdjacke/i;

/** 0 = next to the skin … 4 = outermost. Decides where a newly added piece goes. */
export function layerRank(item: Piece): number {
	const text = `${item.subcategory} ${item.name}`;
	switch (item.category) {
		case "base":
		case "socks":
			return 0;
		case "top":
			return MID.test(text) ? 2 : 1;
		case "dress":
			return 1.5;
		case "outerwear":
			return LIGHT_OUTER.test(text) || MID.test(text) ? 3 : 4;
		case "bottom":
			return /regenhose|überhose|skihose|schneehose/i.test(text) ? 2 : 1;
		case "shoes":
			return 1;
		default:
			return 0;
	}
}

export type Layers = Record<Zone, string[]>;

export function emptyLayers(): Layers {
	return { torso: [], legs: [], feet: [], extras: [] };
}

/** Groups saved item ids by zone. Old outfits listed the jacket before the top → turned around. */
export function layersFromIds(ids: string[], map: Map<string, Item>): Layers {
	const out = emptyLayers();
	for (const id of ids) {
		const it = map.get(id);
		if (it && !out[zoneOf(it)].includes(id)) out[zoneOf(it)].push(id);
	}
	for (const z of Object.keys(out) as Zone[]) {
		const ranks = out[z].map((id) => layerRank(map.get(id)!));
		const descending = ranks.length > 1 && ranks.every((r, i) => i === 0 || r < ranks[i - 1]!);
		if (descending) out[z].reverse();
	}
	return out;
}

export function idsFromLayers(layers: Layers): string[] {
	return ZONES.flatMap((z) => layers[z.key]);
}

/** Adds a piece at its natural depth (after everything with the same or a lower rank). */
export function addLayer(layers: Layers, item: Item, map: Map<string, Item>): Layers {
	const z = zoneOf(item);
	const list = layers[z].filter((id) => id !== item.id);
	const rank = layerRank(item);
	let at = list.length;
	for (let i = 0; i < list.length; i++) {
		const other = map.get(list[i]!);
		if (other && layerRank(other) > rank) {
			at = i;
			break;
		}
	}
	list.splice(at, 0, item.id);
	return { ...layers, [z]: list };
}

export function removeLayer(layers: Layers, id: string): Layers {
	const out = { ...layers };
	for (const z of Object.keys(out) as Zone[]) out[z] = out[z].filter((x) => x !== id);
	return out;
}

/** Moves a piece one layer outwards (+1) or inwards (-1). */
export function moveLayer(layers: Layers, id: string, dir: 1 | -1): Layers {
	const out = { ...layers };
	for (const z of Object.keys(out) as Zone[]) {
		const list = [...out[z]];
		const i = list.indexOf(id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= list.length) continue;
		[list[i], list[j]] = [list[j]!, list[i]!];
		out[z] = list;
	}
	return out;
}

/** Warmth of the layers on the upper body (outer layers count fully, inner ones half). */
export function torsoWarmth(layers: Layers, map: Map<string, Item>): number {
	const list = layers.torso.map((id) => map.get(id)).filter((x): x is Item => !!x);
	if (!list.length) return 0;
	const sorted = [...list].sort((a, b) => b.warmth - a.warmth);
	return Math.min(5, sorted[0]!.warmth + sorted.slice(1).reduce((s, i) => s + i.warmth * 0.35, 0));
}
