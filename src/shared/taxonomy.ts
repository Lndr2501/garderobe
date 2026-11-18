// Shared vocabulary for clothing attributes (German labels, stable keys).

export type CategoryKey =
	| "outerwear"
	| "top"
	| "dress"
	| "bottom"
	| "base"
	| "socks"
	| "shoes"
	| "bag"
	| "accessory"
	| "other";

export interface CategoryDef {
	key: CategoryKey;
	label: string;
	singular: string;
	display: "hanger" | "shelf";
	examples: string;
}

export const CATEGORIES: CategoryDef[] = [
	{
		key: "outerwear",
		label: "Jacken & Mäntel",
		singular: "Jacke/Mantel",
		display: "hanger",
		examples: "Jacke, Mantel, Blazer, Weste, Regenjacke",
	},
	{
		key: "top",
		label: "Oberteile",
		singular: "Oberteil",
		display: "hanger",
		examples: "T-Shirt, Hemd, Bluse, Pullover, Hoodie, Top",
	},
	{
		key: "dress",
		label: "Kleider & Overalls",
		singular: "Kleid/Overall",
		display: "hanger",
		examples: "Kleid, Jumpsuit, Overall",
	},
	{
		key: "bottom",
		label: "Hosen & Röcke",
		singular: "Hose/Rock",
		display: "hanger",
		examples: "Jeans, Chino, Jogginghose, Shorts, Rock",
	},
	{
		key: "base",
		label: "Unterwäsche & Thermo",
		singular: "Basisschicht",
		display: "hanger",
		examples: "Thermoshirt, Thermohose, lange Unterhose, Unterhemd, Leggings",
	},
	{
		key: "socks",
		label: "Socken",
		singular: "Socken",
		display: "shelf",
		examples: "Socken, Wandersocken, Kniestrümpfe, Strumpfhose",
	},
	{
		key: "shoes",
		label: "Schuhe",
		singular: "Schuhe",
		display: "shelf",
		examples: "Sneaker, Stiefel, Sandalen, Halbschuhe",
	},
	{
		key: "bag",
		label: "Taschen",
		singular: "Tasche",
		display: "shelf",
		examples: "Rucksack, Umhängetasche, Tote Bag",
	},
	{
		key: "accessory",
		label: "Accessoires",
		singular: "Accessoire",
		display: "shelf",
		examples: "Schal, Mütze, Cap, Gürtel, Schmuck, Sonnenbrille, Uhr",
	},
	{
		key: "other",
		label: "Sonstiges",
		singular: "Sonstiges",
		display: "shelf",
		examples: "alles andere",
	},
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryDef(key: string): CategoryDef {
	return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

export interface ColorDef {
	key: string;
	label: string;
	hex: string;
	neutral: boolean;
}

export const COLORS: ColorDef[] = [
	{ key: "schwarz", label: "Schwarz", hex: "#1f1f22", neutral: true },
	{ key: "weiss", label: "Weiß", hex: "#f7f7f4", neutral: true },
	{ key: "grau", label: "Grau", hex: "#9aa0a8", neutral: true },
	{ key: "anthrazit", label: "Anthrazit", hex: "#45484f", neutral: true },
	{ key: "creme", label: "Creme", hex: "#f1e8d6", neutral: true },
	{ key: "beige", label: "Beige", hex: "#d6c1a0", neutral: true },
	{ key: "braun", label: "Braun", hex: "#7a5230", neutral: true },
	{ key: "navy", label: "Navy", hex: "#1f2c4d", neutral: true },
	{ key: "denim", label: "Denim", hex: "#4a6c96", neutral: true },
	{ key: "oliv", label: "Oliv", hex: "#6b7240", neutral: true },
	{ key: "blau", label: "Blau", hex: "#3567d6", neutral: false },
	{ key: "hellblau", label: "Hellblau", hex: "#9cc3ef", neutral: false },
	{ key: "gruen", label: "Grün", hex: "#3f8a55", neutral: false },
	{ key: "mint", label: "Mint", hex: "#a8e0c8", neutral: false },
	{ key: "rot", label: "Rot", hex: "#c8372d", neutral: false },
	{ key: "bordeaux", label: "Bordeaux", hex: "#6d1f2c", neutral: false },
	{ key: "rosa", label: "Rosa", hex: "#f2b3c3", neutral: false },
	{ key: "lila", label: "Lila", hex: "#8a67c2", neutral: false },
	{ key: "gelb", label: "Gelb", hex: "#f1c84b", neutral: false },
	{ key: "orange", label: "Orange", hex: "#e8822a", neutral: false },
	{ key: "senf", label: "Senf", hex: "#c99a2e", neutral: false },
	{ key: "gold", label: "Gold", hex: "#c9a646", neutral: false },
	{ key: "silber", label: "Silber", hex: "#c4c8cc", neutral: true },
	{ key: "bunt", label: "Bunt", hex: "conic-gradient", neutral: false },
];

export const COLOR_KEYS = COLORS.map((c) => c.key);

export function colorDef(key: string): ColorDef | undefined {
	return COLORS.find((c) => c.key === key);
}

/** Colors that sit next to each other and pair well even though both are not neutral. */
export const COLOR_FRIENDS: Record<string, string[]> = {
	blau: ["hellblau", "weiss", "gelb", "orange", "rosa"],
	hellblau: ["blau", "rosa", "gelb", "mint"],
	gruen: ["mint", "senf", "gelb", "bordeaux"],
	mint: ["gruen", "rosa", "hellblau"],
	rot: ["rosa", "bordeaux"],
	bordeaux: ["rosa", "rot", "senf", "gruen"],
	rosa: ["rot", "bordeaux", "hellblau", "mint", "lila", "blau"],
	lila: ["rosa", "gelb"],
	gelb: ["blau", "hellblau", "lila", "gruen"],
	orange: ["blau", "senf"],
	senf: ["bordeaux", "gruen", "orange"],
	gold: ["bordeaux", "gruen"],
	bunt: [],
};

export const SEASONS = [
	{ key: "fruehling", label: "Frühling" },
	{ key: "sommer", label: "Sommer" },
	{ key: "herbst", label: "Herbst" },
	{ key: "winter", label: "Winter" },
] as const;

export const SEASON_KEYS = SEASONS.map((s) => s.key) as string[];

export const PATTERNS = [
	"uni",
	"gestreift",
	"kariert",
	"gepunktet",
	"geblümt",
	"gemustert",
	"print",
	"strick",
];

export const STYLE_TAGS = [
	"casual",
	"elegant",
	"business",
	"sport",
	"streetwear",
	"gemütlich",
	"outdoor",
	"party",
	"vintage",
	"basic",
];

export const WARMTH_LABELS = ["", "sehr leicht", "leicht", "mittel", "warm", "sehr warm"];
export const FORMALITY_LABELS = ["", "sportlich", "lässig", "smart casual", "schick", "formell"];

export function currentSeason(date = new Date()): string {
	const m = date.getMonth() + 1;
	if (m >= 3 && m <= 5) return "fruehling";
	if (m >= 6 && m <= 8) return "sommer";
	if (m >= 9 && m <= 11) return "herbst";
	return "winter";
}
