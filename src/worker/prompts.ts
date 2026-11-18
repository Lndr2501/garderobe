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

export function taggingPrompt(): string {
	return `Du bist ein Mode-Experte und katalogisierst Kleidung für eine digitale Garderobe.
Analysiere das Kleidungsstück auf dem Bild und antworte NUR mit einem JSON-Objekt (keine Erklärung, kein Markdown):
{
  "name": "kurzer, natürlicher deutscher Name, max. 4 Wörter, z.B. \\"Creme Teddy-Jacke\\" oder \\"Blaue Jeansjacke\\"",
  "category": eine von [${CATEGORIES.map((c) => `"${c.key}"`).join(", ")}],
  "subcategory": "genauer Typ auf Deutsch, z.B. Hoodie, Chino, Sneaker",
  "colors": Liste der Farben, Hauptfarbe zuerst, nur aus [${COLORS.map((c) => `"${c.key}"`).join(", ")}],
  "material": "vermutetes Material auf Deutsch, z.B. Baumwolle, Wolle, Denim, Leder, Fleece",
  "pattern": eine von [${PATTERNS.map((p) => `"${p}"`).join(", ")}],
  "fit": "Schnitt/Passform auf Deutsch, z.B. oversized, regular, slim, boxy, cropped",
  "styleTags": passende aus [${STYLE_TAGS.map((s) => `"${s}"`).join(", ")}],
  "seasons": passende aus [${SEASONS.map((s) => `"${s.key}"`).join(", ")}],
  "warmth": Zahl 1-5 (1 = sehr leicht/Sommer, 5 = sehr warm/Winter),
  "formality": Zahl 1-5 (1 = sportlich, 2 = lässig, 3 = smart casual, 4 = schick, 5 = formell),
  "waterproof": true/false,
  "brand": "Marke, nur wenn sichtbar, sonst leer"
}
Kategorien: ${CATEGORIES.map((c) => `${c.key} = ${c.label} (${c.examples})`).join("; ")}.`;
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
