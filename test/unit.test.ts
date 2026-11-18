import { describe, expect, it, vi } from "vite-plus/test";
import { colorHarmony, packingList, seededRandom, suggestOutfits, targetWarmth } from "../src/shared/rules.ts";
import type { Item } from "../src/shared/types.ts";
import { chatText, extractJson, normalizeBaseUrl, ThinkFilter, type AiConfig } from "../src/worker/ai.ts";
import { applyAiPatch, configFor, emptyStore, migrateLegacy, msUntilNextUtcDay } from "../src/worker/aisettings.ts";
import { fluxNeurons, imageDims } from "../src/worker/studio.ts";

const EMPTY_AI: AiConfig = {
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
import { rotationFor } from "../src/worker/tagging.ts";
import { addLayer, emptyLayers, idsFromLayers, layersFromIds, moveLayer, zoneOf } from "../src/shared/layers.ts";

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
		aiState: "",
		aiError: "",
		userFields: [],
		rotate: 0,
		imageStudio: null,
		thumbStudio: null,
		studioState: "",
		studioError: "",
		studioRaw: null,
		preferOriginal: false,
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

describe("thinking switch", () => {
	const sse = (text: string) =>
		new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
			headers: { "content-type": "text/event-stream" },
		});

	it("asks the model to skip thinking and retries without the flag when a strict provider rejects it", async () => {
		const bodies: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			bodies.push(body);
			if ("chat_template_kwargs" in body) return new Response('{"error":{"message":"unknown field"}}', { status: 400 });
			return sse("Bereit!");
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const cfg = { ...EMPTY_AI, baseUrl: "https://strict.example/v1", model: "m" };
			expect(await chatText(cfg, [{ role: "user", content: "hi" }])).toBe("Bereit!");
			expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: false });
			expect("chat_template_kwargs" in bodies[1]!).toBe(false);
			// remembered: the next request goes out without the flag straight away
			await chatText(cfg, [{ role: "user", content: "hi" }]);
			expect(bodies).toHaveLength(3);
			expect("chat_template_kwargs" in bodies[2]!).toBe(false);
			// reasoning on: never sent
			bodies.length = 0;
			await chatText({ ...cfg, baseUrl: "https://other.example/v1", reasoning: true }, [{ role: "user", content: "hi" }]);
			expect("chat_template_kwargs" in bodies[0]!).toBe(false);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("upright rotation from the AI anchor", () => {
	it("turns tops and trousers so collar/waistband is on top, shoes so the sole is at the bottom", () => {
		expect(rotationFor("top", "oben")).toBe(0);
		expect(rotationFor("top", "links")).toBe(90);
		expect(rotationFor("bottom", "rechts")).toBe(270);
		expect(rotationFor("top", "unten")).toBe(180);
		expect(rotationFor("shoes", "rechts")).toBe(90);
		expect(rotationFor("shoes", "links")).toBe(270);
		expect(rotationFor("shoes", "unten")).toBe(0);
		expect(rotationFor("bag", "links")).toBe(0);
		expect(rotationFor("top", "quer")).toBe(0);
		expect(rotationFor(undefined, "links")).toBe(0);
	});
});

describe("AI areas", () => {
	it("migrates the old single config", () => {
		const s = migrateLegacy({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt", imageModel: "img", tryonMode: "chat" });
		expect(s.providers).toHaveLength(1);
		expect(s.providers[0]!.name).toBe("OpenAI");
		expect(s.routes.vision).toMatchObject({ provider: "p1", model: "gpt" });
		expect(configFor(s, "tryon")).toMatchObject({ model: "img", mode: "chat", baseUrl: "https://api.openai.com/v1", apiKey: "k" });
		expect(configFor(s, "studio").baseUrl).toBe("");
		expect(migrateLegacy({}).providers).toEqual([]);
	});

	it("keeps keys when providers are re-sent without them, and builds the Cloudflare URL", () => {
		let s = applyAiPatch(emptyStore(), {
			providers: [{ id: "cf", kind: "cloudflare", accountId: "0123456789abcdef0123456789abcdef", apiKey: "tok" }],
			routes: { studio: { provider: "cf", model: "@cf/x" } },
		});
		s = applyAiPatch(s, { providers: [{ id: "cf", kind: "cloudflare", name: "Mein CF" }] });
		expect(s.providers[0]).toMatchObject({ name: "Mein CF", apiKey: "tok", accountId: "0123456789abcdef0123456789abcdef" });
		expect(configFor(s, "studio").baseUrl).toBe("https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1");
		expect(applyAiPatch(s, { studio: { steps: 33, budget: 5 } }).studio).toMatchObject({ steps: 28, budget: 9000 });
	});
});

describe("studio cost", () => {
	it("matches the measured Workers AI usage", () => {
		// 768×1024 output with a 512² reference at 50 steps was billed with ~6 560 neurons.
		expect(fluxNeurons([{ w: 512, h: 512 }], { w: 768, h: 1024 }, 50)).toBeGreaterThan(6400);
		expect(fluxNeurons([{ w: 512, h: 512 }], { w: 768, h: 1024 }, 50)).toBeLessThan(6700);
		expect(fluxNeurons([{ w: 768, h: 1024 }], { w: 768, h: 1024 }, 28)).toBeLessThan(5000);
	});

	it("reads image sizes from headers", () => {
		const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
		expect(imageDims(png)).toEqual({ w: 1, h: 1 });
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x03, 0x00, 0x02, 0x40, 3, 0, 0, 0, 0]);
		expect(imageDims(jpeg)).toEqual({ w: 576, h: 768 });
		expect(imageDims(new Uint8Array([1, 2, 3]))).toBeNull();
	});

	it("waits until just after midnight UTC", () => {
		const t = Date.UTC(2026, 10, 18, 23, 0);
		expect(msUntilNextUtcDay(t)).toBe(62 * 60_000);
	});
});

describe("layered outfits", () => {
	const thermo = item({ name: "Thermoshirt", category: "base", subcategory: "Thermoshirt" });
	const leggings = item({ name: "Thermohose", category: "base", subcategory: "lange Unterhose" });
	const tee = item({ name: "Shirt", category: "top", subcategory: "T-Shirt" });
	const pulli = item({ name: "Pulli", category: "top", subcategory: "Strickpullover" });
	const jacket = item({ name: "Jacke", category: "outerwear", subcategory: "Daunenjacke" });
	const jeans = item({ name: "Jeans", category: "bottom" });
	const socks = item({ name: "Socken", category: "socks" });
	const shoes = item({ name: "Stiefel", category: "shoes" });
	const map = new Map([thermo, leggings, tee, pulli, jacket, jeans, socks, shoes].map((i) => [i.id, i]));

	it("sorts pieces into body zones", () => {
		expect([thermo, leggings, tee, jacket, jeans, socks, shoes].map(zoneOf)).toEqual(["torso", "legs", "torso", "torso", "legs", "feet", "feet"]);
	});

	it("puts new pieces at their natural depth, inside out", () => {
		let l = emptyLayers();
		for (const it of [jacket, tee, jeans, shoes, pulli, thermo, socks, leggings]) l = addLayer(l, it, map);
		expect(l.torso).toEqual([thermo.id, tee.id, pulli.id, jacket.id]);
		expect(l.legs).toEqual([leggings.id, jeans.id]);
		expect(l.feet).toEqual([socks.id, shoes.id]);
		l = moveLayer(l, pulli.id, 1);
		expect(l.torso).toEqual([thermo.id, tee.id, jacket.id, pulli.id]);
		expect(layersFromIds(idsFromLayers(l), map)).toEqual(l);
	});

	it("reads old outfits (jacket listed before the top) the right way round", () => {
		expect(layersFromIds([jacket.id, tee.id, jeans.id, shoes.id], map).torso).toEqual([tee.id, jacket.id]);
	});
});
