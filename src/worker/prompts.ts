import { CATEGORIES, COLORS, PATTERNS, SEASONS, STYLE_TAGS } from "../shared/taxonomy.ts";
import type { Item } from "../shared/types.ts";
import { daysSince } from "../shared/rules.ts";

export function wardrobeSummary(items: Item[], limit = 400, includeCut = false): string {
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
				...(includeCut ? [i.subcategory || "-", i.fit || "-", i.material || "-"] : []),
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
{"category":"...","subcategory":"...","anker":"...","name":"...","colors":[...],"material":"...","pattern":"...","fit":"...","brand":"","styleTags":[...],"seasons":[...],"warmth":3,"formality":2,"waterproof":null,"subject":"single"}

Prüfe zuerst das Motiv: subject="single" für ein erkennbares Hauptteil (auch ein zusammengehöriges Paar Schuhe), "multiple" bei mehreren gleichwertigen Teilen, "unclear" wenn kein Teil sicher erkennbar ist. Bei multiple/unclear nur subject zurückgeben. Hintergrund, Bügel, Schatten und Hände sind keine Kleidungsmerkmale.

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
Bei Schuhen offene Slides, Sandalen, Hausschuhe, geschlossene Sneaker und Boots klar unterscheiden: Zehenbereich, Ferse, Riemen und Sohle beachten. Bei Hosen die Breite von Oberschenkel, Knie und Saum vergleichen: wide-leg, straight und tapered nicht verwechseln. Bei Jacke vs. Weste auf Ärmel achten. Bei Accessoires Uhr, Armband und Gürtel getrennt benennen.
fit nur bei erkennbarem Schnitt; bei Accessoires leer lassen. material nur visuell belegbar (z.B. Denim oder Strick); keine Faserzusammensetzung raten. waterproof nur bei eindeutigem Nachweis (z.B. lesbare Kennzeichnung); sonst null. Glanz allein ist kein Nachweis.
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

Auswahl in dieser Reihenfolge:
1. Wetter und Anlass zuerst. Nutze die gefühlte Temperatur, sonst die Lufttemperatur. Für draußen bei höchstens 10 °C oder bei Regen: geschlossene Schuhe; keine Slides, Sandalen oder offenen Hausschuhe. Fehlt ein geeignetes Paar, lass die Schuhe weg. Bei Kälte eine wärmende Schicht, bei Regen möglichst eine als wasserdicht markierte Jacke. Bei unbekanntem Wetter keine konkreten Bedingungen behaupten.
2. Ein tragbarer Look besteht aus Oberteil + Unterteil oder einem Kleid, dazu passende Schuhe, soweit vorhanden. Stimme Schnitt und Material aufeinander ab (z. B. genug Platz für Strick unter der Jacke). Verwende nur gelistete IDs, jede höchstens einmal pro Look. Gürtel, Mütze, Uhr oder Schmuck nur, wenn sie zum Look passen; keine Accessoires erfinden oder doppeln.
3. Variiere möglichst ein Hauptteil zwischen den Looks; ein einziges geeignetes Paar Schuhe darf sich wiederholen. Farbharmonie, Favoriten und selten getragene Teile entscheiden erst zwischen gleich geeigneten Kombinationen.

Prüfe jeden fertigen Look still als Ganzes: Gibt es ein Hauptteil, zu dem Schnitt, Farben und Stil der Begleiter passen? Bleibt bei einem auffälligen Muster der Rest ruhiger? Ist jede Schicht für Wetter und Anlass sinnvoll? Tausche unpassende Teile aus, statt sie in der Begründung schönzureden. Zwei Looks, die sich nur in Accessoires unterscheiden, zählen als eine Variante.

Begründung: max. 20 Wörter auf Deutsch in Du-Form; nenne einen konkreten Grund für die Kombination.
Antworte NUR mit JSON: {"outfits":[{"name":"kurzer, kreativer Name","itemIds":["…"],"reason":"…"}]}

Kleiderschrank (${WARDROBE_FORMAT.replace("Kategorie |", "Kategorie | Untertyp | Schnitt | Material |")}):
${wardrobeSummary(items, 400, true)}`;
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

/** Reference prompts for the local Klein model, based on the studio trials. */
const STUDIO_COLORS = new Map([
	["navy", "dark navy blue"], ["schwarz", "black"], ["anthrazit", "charcoal grey"],
	["grau", "grey"], ["hellblau", "light blue"], ["denim", "denim blue"], ["blau", "blue"],
	["creme", "cream"], ["weiss", "white"], ["beige", "beige"], ["braun", "brown"],
	["bordeaux", "burgundy"], ["rot", "red"], ["oliv", "olive green"], ["gruen", "green"],
]);

export function localStudioPrompt(category: string, kind: string, name: string, colorKeys: string[] = []): string {
	const hint = `${kind} ${name}`.toLowerCase();
	const light = "soft studio light, soft contact shadow, light grey background";
	const mannequin = "front view, natural 3D volume as if worn by an invisible mannequin";
	const shot = "Professional e-commerce product photo of";
	const noNewMarks = "Do not add any logo, badge or text.";
	// Use known palette labels as hints, while keeping the reference authoritative.
	const colors = colorKeys.slice(0, 3).map((key) => STUDIO_COLORS.get(key)).filter(Boolean);
	const palette = colors.length ? ` Keep the original ${colors.join(" and ")} tones, without changing their placement.` : "";
	if (category === "shoes") {
		const slipper = /hausschuh|pantoffel|slipper|clog/.test(hint);
		return `${shot} ${slipper ? "this exact slipper" : "the exact footwear shown"}, three-quarter side view, ${light}. Keep the number of shoes, exact shape, colors, materials, stitching, sole and any existing marks identical.${palette} ${noNewMarks}`;
	}
	if (category === "bottom") {
		const jeans = /jeans|denim/.test(hint);
		return `${shot} ${jeans ? "these exact jeans" : "this exact garment"}, ${mannequin}, ${light}. Remove the clothes hanger. Keep the exact cut, color, seams and ${jeans ? "wash and fading" : "fabric texture and finish"} identical.${palette} ${noNewMarks}`;
	}
	if (category === "socks") return `${shot} the exact socks shown, side view with natural volume on invisible feet, ${light}. Preserve the number of socks, color, knit pattern and any existing embroidery. No visible feet or legs. ${noNewMarks}`;
	if (category === "bag" || category === "accessory" || category === "other") {
		return `${shot} this exact product, front view, ${light}. Preserve shape, color, materials, stitching and existing logos. ${noNewMarks}`;
	}
	const halfZip = /(?:half|quarter)[ -]?zip|troyer|(?:1\s*\/\s*[24])[- ]?zip/.test(hint);
	const sweater = /pulli|pullover|sweater|strick/.test(hint);
	const tShirt = /t[ -]?shirt|tee/.test(hint);
	const cable = /zopf|cable/.test(hint);
	const type = halfZip ? "half-zip top" : sweater ? (cable ? "cable-knit sweater" : "sweater") : tShirt ? "T-shirt" : "garment";
	const preserve = halfZip ? "Copy the original collar, zipper length, zipper pull, fabric texture and trim."
		: sweater
			? (cable ? "Copy the original narrow vertical cable columns and fine matte knit, keeping their spacing and scale. Preserve the neckline, ribbed cuffs and hem."
				: "Copy the knit pattern, spacing and scale. Preserve the original neckline, ribbed cuffs and hem.")
			: "Copy the original fabric texture, neckline, seams, sleeve length and hem.";
	const sleeves = tShirt ? "Keep the original angle and opening of the short sleeves." : "Keep the original sleeve shape; let long sleeves hang relaxed and straight.";
	return `${shot} this exact ${type}, straight front view, on an invisible straight-sided garment form. Keep the original fit and side seams. The front panel hangs flat and even from neckline to hem, with no contouring, pinching or crosswise folds. Slight depth only at the shoulder seams and neckline. ${sleeves} ${preserve} Keep any existing embroidery, logo and visible collar label at their original size and position.${palette} Soft broad frontal fill plus a very gentle upper-left side light to reveal the fabric without changing its color. No glossy highlights or strong shading across the front. Show the complete garment, centered against a pale grey studio backdrop. No visible body, mannequin or hanger. ${noNewMarks}`;
}

/** Studio prompt for external providers. */
export function studioPrompt(category: string, kind: string): string {
	const what = kind ? ` (${kind})` : "";
	const lighting = "soft diffused studio lighting, subtle soft contact shadow, clean light grey seamless background";
	const keep = "Keep every detail identical to the reference: exact color, fabric texture, pattern, logo, print, buttons, zipper, seams, wash and fading. Do not add or invent logos, text or decorations.";
	if (category === "shoes") {
		return `Professional e-commerce product photo of the exact same pair of shoes${what} as in the reference image, three-quarter side view of the pair, centered, ${lighting}. ${keep} No person, no feet, no text.`;
	}
	if (category === "socks") {
		return `Professional e-commerce product photo of the exact same pair of socks${what} as in the reference image, shown on invisible feet so they have natural three-dimensional volume, side view, centered, ${lighting}. ${keep} No person, no legs visible, no text.`;
	}
	if (category === "bag" || category === "accessory" || category === "other") {
		return `Professional e-commerce product photo of the exact same item${what} as in the reference image, front view, standing upright with natural volume, centered, ${lighting}. ${keep} No person, no text.`;
	}
	const shape = category === "bottom" ? "with both legs fully visible" : "with natural shoulders and sleeves";
	return `Professional e-commerce product photo of the exact same garment${what} as in the reference image, shown on an invisible ghost mannequin so it has natural three-dimensional volume, ${shape}, front view, centered, ${lighting}. ${keep} No person, no hanger, no visible mannequin parts or neck stump, no text.`;
}
