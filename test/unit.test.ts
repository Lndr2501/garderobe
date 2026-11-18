import { describe, expect, it } from "vite-plus/test";
import { colorHarmony, packingList, seededRandom, suggestOutfits, targetWarmth } from "../src/shared/rules.ts";
import type { Item } from "../src/shared/types.ts";
import { extractJson, normalizeBaseUrl, ThinkFilter } from "../src/worker/ai.ts";

function item(p: Partial<Item>): Item {
	return {
		id: crypto.randomUUID(),
		name: "Teil",
		category: "top",
		subcategory: "",
		colors: [],
		colorHex: "",
		material: "",
		pattern: "uni",
		fit: "",
		styleTags: [],
		seasons: [],
		warmth: 2,
		formality: 2,
		waterproof: false,
		brand: "",
		size: "",
		price: null,
		purchasedAt: null,
		notes: "",
		imageFront: null,
		thumbFront: null,
		imageBack: null,
		thumbBack: null,
		favorite: false,
		status: "active",
		needsReview: false,
		createdAt: "",
		updatedAt: "",
		wearCount: 0,
		lastWorn: null,
		...p,
	};
}

describe("ThinkFilter", () => {
	it("strips think blocks split across chunks", () => {
		const f = new ThinkFilter();
		const out = ["Hal", "lo <th", "ink>geheim", " gedacht</thi", "nk> Welt", "!"].map((c) => f.push(c)).join("") + f.flush();
		expect(out).toBe("Hallo  Welt!");
	});
	it("keeps text that only looks like a tag start", () => {
		const f = new ThinkFilter();
		expect(f.push("a <b> c <") + f.flush()).toBe("a <b> c <");
	});
});

describe("extractJson", () => {
	it("finds JSON in fences or prose", () => {
		expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(extractJson<{ a: number }>('Klar! Hier: {"a":2} – viel Spaß')).toEqual({ a: 2 });
		expect(extractJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
	});
	it("throws on garbage", () => {
		expect(() => extractJson("kein json")).toThrow();
	});
});

describe("normalizeBaseUrl", () => {
	it("adds /v1 only for bare hosts and trims slashes", () => {
		expect(normalizeBaseUrl("https://api.openai.com")).toBe("https://api.openai.com/v1");
		expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
		expect(normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
	});
});

describe("rules", () => {
	it("maps temperature to warmth", () => {
		expect(targetWarmth(28)).toBeLessThan(targetWarmth(5));
	});
	it("prefers neutral + friend colors", () => {
		expect(colorHarmony([{ colors: ["schwarz"], pattern: "uni" }, { colors: ["weiss"], pattern: "uni" }])).toBeGreaterThan(
			colorHarmony([{ colors: ["rot"], pattern: "kariert" }, { colors: ["gruen"], pattern: "gestreift" }]),
		);
	});
	it("is deterministic per seed", () => {
		const a = seededRandom("x");
		const b = seededRandom("x");
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
	});
	it("suggests complete outfits and adds a jacket when cold", () => {
		const items = [
			item({ name: "Pulli", category: "top", warmth: 4, colors: ["grau"] }),
			item({ name: "T-Shirt", category: "top", warmth: 1, colors: ["weiss"] }),
			item({ name: "Jeans", category: "bottom", warmth: 3, colors: ["blau"] }),
			item({ name: "Mantel", category: "outerwear", warmth: 5, colors: ["schwarz"] }),
			item({ name: "Boots", category: "shoes", warmth: 4, colors: ["braun"] }),
		];
		const cold = suggestOutfits(items, { weather: { feelsLike: 2, precipProb: 0 }, occasion: "", count: 3, seed: "s" });
		expect(cold.length).toBeGreaterThan(0);
		const ids = new Set(cold[0]!.itemIds);
		const byName = (n: string) => items.find((i) => i.name === n)!.id;
		expect(ids.has(byName("Jeans"))).toBe(true);
		expect(ids.has(byName("Mantel"))).toBe(true);
		expect(cold.every((o) => o.source === "rules")).toBe(true);
	});
	it("packs enough for the trip length", () => {
		const items = [
			item({ name: "Shirt A", category: "top", warmth: 1 }),
			item({ name: "Shirt B", category: "top", warmth: 1 }),
			item({ name: "Shorts", category: "bottom", warmth: 1 }),
			item({ name: "Sandalen", category: "shoes", warmth: 1 }),
		];
		const list = packingList(items, { days: 5, avgFeelsLike: 26, rainy: false, activities: ["strand"] });
		expect(list.filter((e) => e.itemId).length).toBeGreaterThanOrEqual(3);
		expect(list.some((e) => e.text?.toLowerCase().includes("unterw"))).toBe(true);
	});
});
