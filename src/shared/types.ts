import type { CategoryKey } from "./taxonomy.ts";

export interface Item {
	id: string;
	name: string;
	category: CategoryKey;
	subcategory: string;
	colors: string[];
	colorHex: string;
	material: string;
	pattern: string;
	fit: string;
	styleTags: string[];
	seasons: string[];
	warmth: number;
	formality: number;
	waterproof: boolean;
	brand: string;
	size: string;
	price: number | null;
	purchasedAt: string | null;
	notes: string;
	imageFront: string | null;
	thumbFront: string | null;
	imageBack: string | null;
	thumbBack: string | null;
	favorite: boolean;
	status: "active" | "archived";
	needsReview: boolean;
	/** Server-side AI recognition: "" = never ran, pending, done, failed. */
	aiState: "" | "pending" | "done" | "failed";
	aiError: string;
	/** Fields the user set by hand – the AI never overwrites them. */
	userFields: string[];
	/** Clockwise rotation (deg) the client still has to apply to the photos. */
	rotate: number;
	/** AI studio picture (background removed) made from the front photo. */
	imageStudio: string | null;
	thumbStudio: string | null;
	/** queued/waiting/running: in the works; raw: generated, the app still removes the background; off: removed by hand. */
	studioState: StudioState;
	studioError: string;
	/** Generated picture that still needs its background removed (state "raw"). */
	studioRaw: string | null;
	/** Show the own photo even though a studio picture exists. */
	preferOriginal: boolean;
	createdAt: string;
	updatedAt: string;
	/** Derived from the wear log. */
	wearCount: number;
	lastWorn: string | null;
}

export type StudioState = "" | "queued" | "waiting" | "running" | "raw" | "done" | "failed" | "off";

export type ItemInput = Partial<
	Omit<
		Item,
		| "id"
		| "createdAt"
		| "updatedAt"
		| "wearCount"
		| "lastWorn"
		| "aiState"
		| "aiError"
		| "userFields"
		| "imageStudio"
		| "thumbStudio"
		| "studioState"
		| "studioError"
		| "studioRaw"
	>
>;

/** What the client sends when creating/updating an item. */
export type ItemPayload = ItemInput & {
	/** Fields the user set by hand – the AI will not overwrite them. */
	lock?: string[];
	/** Uploaded JPEG for the server-side AI recognition (create only). */
	aiImage?: string;
	colorHint?: string;
};

export interface Outfit {
	id: string;
	name: string;
	itemIds: string[];
	occasion: string;
	favorite: boolean;
	notes: string;
	createdAt: string;
	updatedAt: string;
}

export type OutfitInput = Partial<Omit<Outfit, "id" | "createdAt" | "updatedAt">>;

export interface WearDay {
	date: string;
	itemIds: string[];
	outfitId: string | null;
}

export interface TripEntry {
	/** Either a wardrobe item or a free text line. */
	itemId?: string;
	text?: string;
	qty?: number;
	reason?: string;
	checked: boolean;
}

export interface TripWeatherDay {
	date: string;
	tMin: number;
	tMax: number;
	precip: number;
	code: number;
}

export interface Trip {
	id: string;
	name: string;
	destination: string;
	lat: number | null;
	lon: number | null;
	startDate: string | null;
	endDate: string | null;
	activities: string[];
	entries: TripEntry[];
	weather: TripWeatherDay[] | null;
	notes: string;
	createdAt: string;
	updatedAt: string;
}

export interface TryOn {
	id: string;
	itemIds: string[];
	image: string;
	createdAt: string;
}

/** text: chat, outfits, shopping, packing · vision: photo recognition · studio: studio pictures · tryon: try-on. */
export type AiArea = "text" | "vision" | "studio" | "tryon";
export type AiProviderKind = "openai" | "cloudflare";
/** Built-in studio-only route, configured by the self-hosted server rather than the provider editor. */
export const LOCAL_FLUX_PROVIDER = "local-flux";

export interface AiProviderPublic {
	id: string;
	name: string;
	kind: AiProviderKind;
	baseUrl: string;
	accountId: string;
	jsonMode: boolean;
	reasoning: boolean;
	hasKey: boolean;
	keyHint: string;
}

export interface AiRoutePublic {
	provider: string;
	model: string;
	mode: "edits" | "chat";
}

export interface AiSettingsPublic {
	providers: AiProviderPublic[];
	routes: Record<AiArea, AiRoutePublic>;
	studio: {
		auto: boolean;
		freeOnly: boolean;
		steps: number;
		budget: number;
		/** Estimated neurons used today (Cloudflare) and pictures made today. */
		usedToday: number;
		imagesToday: number;
		/** The studio provider counts against a daily allowance (Cloudflare). */
		metered: boolean;
		/** SSH has been configured on the server (reachability is checked by the job). */
		localFluxAvailable: boolean;
	};
	/** Which areas are ready to use. */
	areas: Record<AiArea, boolean>;
	/** Texts (chat, outfits …) are set up. */
	configured: boolean;
}

export interface AppSettings {
	name: string;
	location: { name: string; lat: number; lon: number; useGeolocation: boolean };
	currency: string;
	bgRemoval: { enabled: boolean; quality: "fast" | "best" };
	personPhoto: string | null;
	ai: AiSettingsPublic;
}

export interface WeatherNow {
	temp: number;
	feelsLike: number;
	tMin: number;
	tMax: number;
	precipProb: number;
	precip: number;
	wind: number;
	code: number;
	description: string;
	isDay: boolean;
	place: string;
	daily?: { date: string; tMin: number; tMax: number; code: number; precipProb: number }[];
}

export interface OutfitSuggestion {
	name: string;
	itemIds: string[];
	reason: string;
	source: "ai" | "rules";
}

export interface ShoppingCheckResult {
	name: string;
	category: string;
	colors: string[];
	similarIds: string[];
	pairsWithIds: string[];
	verdict: "kaufen" | "überlegen" | "lassen";
	reasoning: string;
	source: "ai" | "rules";
}

export interface Stats {
	totalItems: number;
	archivedItems: number;
	totalValue: number;
	wornThisMonthPct: number;
	totalWears: number;
	mostWorn: { id: string; count: number }[];
	neglected: { id: string; days: number; never: boolean }[];
	bestCostPerWear: { id: string; cpw: number }[];
	byCategory: { key: string; count: number }[];
	byColor: { key: string; count: number }[];
	wearsByWeekday: number[];
	streak: number;
}
