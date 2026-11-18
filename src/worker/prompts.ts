import { CATEGORIES, COLORS, PATTERNS, SEASONS, STYLE_TAGS } from "../shared/taxonomy.ts";
import type { Item } from "../shared/types.ts";
import { daysSince } from "../shared/rules.ts";

export function wardrobeSummary(items: Item[], limit = 400): string {
	const active = items.filter((i) => i.status === "active").slice(0, limit);
	if (active.length === 0) return "(Der Kleiderschrank ist noch leer.)";
	return active
		.map((i) => {
			const since = daysSince(i.lastWorn);
			const worn = since === null ? "nie getragen" : `zuletzt vor ${since} T`;
			return [
				i.id,
				i.name || "(ohne Name)",
				i.category,
				i.colors.join("/") || "-",
				i.pattern || "uni",
				`wärme ${i.warmth}`,
				`formell ${i.formality}`,
				i.seasons.join("/") || "ganzjährig",
				i.styleTags.join("/") || "-",
				i.waterproof ? "wasserdicht" : "",
				`${i.wearCount}× getragen, ${worn}`,
				i.favorite ? "★" : "",
			]
				.filter(Boolean)
				.join(" | ");
		})
		.join("\n");
}

export const WARDROBE_FORMAT =
	"Format je Zeile: ID | Name | Kategorie | Farben | Muster | Wärme 1-5 | Formalität 1-5 | Saisons | Stil | (wasserdicht) | Tragehistorie | ★=Favorit";

/**
 * Recognition prompt for one garment photo. Tested against real phone photos (flat lays on a bed,
 * rotated or upside down): the "anker" field tells where collar / waistband / sole is, which the
 * worker turns into a rotation so every piece hangs upright.
 */
export function taggingPrompt(): string {
	return `Du katalogisierst Kleidung für eine digitale Garderobe. Das Foto zeigt EIN Teil, oft flach auf Bett oder Boden fotografiert und dabei gedreht oder auf dem Kopf.
Antworte NUR mit JSON, ohne Erklärung:
{"category":"...","subcategory":"...","anker":"...","name":"...","colors":[...],"material":"...","pattern":"...","fit":"...","brand":"","styleTags":[...],"seasons":[...],"warmth":3,"formality":2,"waterproof":false}

category (genau einer):
- "top" = Oberteil: T-Shirt, Polo, Hemd, Bluse, Pullover, Strickpullover, Half-Zip, Hoodie, Sweatshirt, Top
- "outerwear" = Jacke, Mantel, Blazer, Weste, Fleece-Jacke (vorne komplett zu öffnen)
- "bottom" = Hose, Jeans, Chino, Jogginghose, Shorts, Rock
- "dress" = Kleid, Jumpsuit, Overall
- "base" = enge Basisschicht zum Drunterziehen: Thermoshirt, Thermohose, lange Unterhose, Unterhemd, Funktionsunterwäsche, Leggings
- "socks" = Socken, Strümpfe, Kniestrümpfe, Strumpfhose
- "shoes" = Sneaker, Stiefel, Hausschuh, Slipper, Sandale, Halbschuh (auch ein einzelner Schuh)
- "bag" = Tasche, Rucksack
- "accessory" = Mütze, Cap, Schal, Gürtel, Schmuck, Uhr, Brille
- "other" nur wenn nichts davon passt

anker = auf welcher Bildseite liegt der Anker des Teils: "oben", "unten", "links" oder "rechts".
- Oberteil, Jacke, Kleid: Anker = Kragen/Halsausschnitt.
- Hose, Rock: Anker = Bund (Hosenbund mit Knopf/Gürtelschlaufen), die Beine zeigen weg davon.
- Schuh: Anker = Sohle.
Schau zuerst, wo Kragen, Bund oder Sohle im Bild ist, dann antworte.

subcategory: genauer Typ auf Deutsch (z.B. T-Shirt, Strickpullover, Half-Zip Pullover, Jeans, Sneaker, Hausschuh).
name: wie im Laden, max. 4 Wörter, Farbe + Typ, z.B. "Navy Zopfstrick-Pullover", "Helle Wide-Leg Jeans", "Asics Sneaker Creme-Bordeaux".
colors: Hauptfarbe zuerst, nur aus [${COLORS.map((c) => `"${c.key}"`).join(",")}]. Fotos sind oft zu dunkel: unterscheide schwarz/navy/anthrazit sorgfältig.
pattern: einer von [${PATTERNS.map((p) => `"${p}"`).join(",")}].
brand: nur wenn Logo/Etikett lesbar, sonst "".
styleTags aus [${STYLE_TAGS.map((t) => `"${t}"`).join(",")}]; seasons aus [${SEASONS.map((x) => `"${x.key}"`).join(",")}].
warmth 1-5 (1 Sommer, 5 Winter); formality 1-5 (1 sportlich, 3 smart casual, 5 formell).
Ein Bügel, eine Hand oder Reste vom Hintergrund gehören nicht zum Teil.`;
}

export function suggestPrompt(
	items: Item[],
	weatherText: string,
	occasion: string,
	recent: string,
	dateText: string,
): string {
	return `Du bist ein persönlicher Stylist. Stelle aus dem Kleiderschrank 3 unterschiedliche, tragbare Outfits zusammen.
Datum: ${dateText}
Wetter: ${weatherText}
Anlass: ${occasion || "Alltag"}
Zuletzt getragen (vermeide Wiederholungen): ${recent || "keine Daten"}

Regeln:
- Nur IDs aus der Liste verwenden.
- Jedes Outfit: Oberteil + Unterteil ODER Kleid, dazu Schuhe falls vorhanden; Jacke bei Kälte/Regen; Accessoires optional.
- Wärme an das Wetter anpassen, Farben harmonisch kombinieren, selten getragene Teile bevorzugen.
- Begründung kurz (max. 20 Wörter), locker, auf Deutsch, Du-Form.

Antworte NUR mit JSON: {"outfits":[{"name":"kurzer, kreativer Name","itemIds":["…"],"reason":"…"}]}

Kleiderschrank (${WARDROBE_FORMAT}):
${wardrobeSummary(items)}`;
}

export function chatSystemPrompt(items: Item[], context: string, name: string): string {
	return `Du bist „Bügel“, der freundliche Garderoben-Assistent von ${name || "deinem Nutzer"}. Du sprichst Deutsch, duzt, antwortest kurz und konkret (max. ~120 Wörter, gern mit kurzen Listen).
Du kennst den kompletten Kleiderschrank (unten). Wenn du konkrete Teile empfiehlst, nenne sie mit ihrer ID in doppelten eckigen Klammern, z.B. [[${items[0]?.id ?? "ID"}]] – die App zeigt dann ein Bild. Erfinde keine Teile; wenn etwas fehlt, sag es ehrlich (z.B. als Einkaufsidee).
Kontext: ${context}

Kleiderschrank (${WARDROBE_FORMAT}):
${wardrobeSummary(items)}`;
}

export function packingPrompt(items: Item[], trip: string, weather: string): string {
	return `Du hilfst beim Kofferpacken. Stelle aus dem Kleiderschrank eine sinnvolle, kompakte Packliste zusammen (kombinierbar, nicht zu viel).
Reise: ${trip}
Wetter: ${weather || "unbekannt"}

Antworte NUR mit JSON:
{"items":[{"itemId":"ID aus der Liste","reason":"max. 8 Wörter"}],"extras":[{"text":"Nicht-Kleidung oder fehlende Dinge, z.B. Socken","qty":Zahl}],"notes":"1-2 Sätze Tipp"}

Kleiderschrank (${WARDROBE_FORMAT}):
${wardrobeSummary(items)}`;
}

export function shoppingPrompt(items: Item[], extra: string): string {
	return `Du bist ein ehrlicher Shopping-Berater. Auf dem Bild ist ein Kleidungsstück, das die Person kaufen möchte.
Vergleiche es mit dem vorhandenen Kleiderschrank. ${extra}
Antworte NUR mit JSON:
{
  "name": "kurzer deutscher Name des Teils",
  "category": eine von [${CATEGORIES.map((c) => `"${c.key}"`).join(", ")}],
  "colors": aus [${COLORS.map((c) => `"${c.key}"`).join(", ")}],
  "similarIds": [IDs sehr ähnlicher vorhandener Teile],
  "pairsWithIds": [bis zu 8 IDs, die gut dazu passen],
  "verdict": "kaufen" | "überlegen" | "lassen",
  "reasoning": "2-3 Sätze, Du-Form, ehrlich (Doppelungen, Kombinierbarkeit, Lücke im Schrank?)"
}

Kleiderschrank (${WARDROBE_FORMAT}):
${wardrobeSummary(items)}`;
}

export function tryOnPrompt(itemNames: string[]): string {
	return `Fotorealistische virtuelle Anprobe: Zeige die Person aus dem ersten Bild, wie sie folgende Kleidungsstücke aus den weiteren Bildern trägt: ${itemNames.join(", ")}.
Behalte Gesicht, Frisur, Körperform, Pose, Licht und Hintergrund der Person exakt bei. Übernimm Schnitt, Farbe, Muster und Material der Kleidung originalgetreu. Ganzkörperansicht, natürlicher Faltenwurf, keine zusätzlichen Personen, kein Text.`;
}

/** Try-on prompt for FLUX.2 (English, references are numbered: image 1 = person). */
export function tryOnPromptEn(itemNames: string[]): string {
	return `Photorealistic virtual try-on. Show the person from image 1 wearing the clothing from the other reference images (${itemNames.join(", ")}). Keep the face, hair, body shape, pose, lighting and background of image 1 exactly. Reproduce cut, color, pattern, logos and material of each garment faithfully. Full body view, natural folds, no extra people, no text.`;
}

/** Studio picture from the user's photo (FLUX.2 reference edit). English works best for these models. */
export function studioPrompt(category: string, kind: string): string {
	const what = kind ? ` (${kind})` : "";
	const keep =
		"Keep every detail identical to the reference: exact color, fabric texture, pattern, logo, print, buttons, zipper, seams, wash and fading. Do not add or invent logos, text or decorations.";
	if (category === "shoes") {
		return `Professional e-commerce product photo of the exact same pair of shoes${what} as in the reference image, three-quarter side view of the pair, centered, soft diffused studio lighting, subtle soft contact shadow, clean light grey seamless background. ${keep} No person, no feet, no text.`;
	}
	if (category === "socks") {
		return `Professional e-commerce product photo of the exact same pair of socks${what} as in the reference image, shown on invisible feet so they have natural three-dimensional volume, side view, centered, soft diffused studio lighting, subtle soft contact shadow, clean light grey seamless background. ${keep} No person, no legs visible, no text.`;
	}
	if (category === "bag" || category === "accessory" || category === "other") {
		return `Professional e-commerce product photo of the exact same item${what} as in the reference image, front view, standing upright with natural volume, centered, soft diffused studio lighting, subtle soft contact shadow, clean light grey seamless background. ${keep} No person, no text.`;
	}
	const shape = category === "bottom" ? "with both legs fully visible" : "with natural shoulders and sleeves";
	return `Professional e-commerce product photo of the exact same garment${what} as in the reference image, shown on an invisible ghost mannequin so it has natural three-dimensional volume, ${shape}, front view, centered, soft diffused studio lighting, subtle soft contact shadow, clean light grey seamless background. ${keep} No person, no hanger, no mannequin visible, no text.`;
}
