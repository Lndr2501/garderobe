import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	AiArea,
	AiProviderPublic,
	AiRoutePublic,
	AppSettings,
	Item,
	ItemPayload,
	Outfit,
	OutfitInput,
	OutfitSuggestion,
	ShoppingCheckResult,
	Stats,
	Trip,
	TryOn,
	WeatherNow,
	WearDay,
} from "../shared/types.ts";
import { api } from "./api.ts";
import { localDate } from "./lib/date.ts";
import { currentPosition, fetchWeather } from "./lib/weather.ts";

export const keys = {
	items: ["items"] as const,
	outfits: ["outfits"] as const,
	settings: ["settings"] as const,
	wears: (from: string, to: string) => ["wears", from, to] as const,
	stats: ["stats"] as const,
	trips: ["trips"] as const,
	tryons: ["tryons"] as const,
};

export function useItems() {
	return useQuery({
		queryKey: keys.items,
		queryFn: () => api<Item[]>("/api/items"),
		// While the server recognizes new pieces or makes studio pictures, look for results every few seconds.
		refetchInterval: (q) =>
			q.state.data?.some(
				(i) =>
					(i.aiState === "pending" || i.studioState === "queued" || i.studioState === "running") && Date.now() - Date.parse(i.updatedAt) < 12 * 60_000,
			)
				? 4000
				: false,
	});
}

export function useItemMap(): Map<string, Item> {
	const { data } = useItems();
	return useMemo(() => new Map((data ?? []).map((i) => [i.id, i])), [data]);
}

export function useActiveItems(): Item[] {
	const { data } = useItems();
	return useMemo(() => (data ?? []).filter((i) => i.status === "active"), [data]);
}

export function useSaveItem() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, data }: { id?: string; data: ItemPayload }) =>
			id ? api<Item>(`/api/items/${id}`, { method: "PATCH", body: data }) : api<Item>("/api/items", { method: "POST", body: data }),
		onSuccess: (item) => {
			qc.setQueryData<Item[]>(keys.items, (old) => {
				if (!old) return [item];
				const idx = old.findIndex((i) => i.id === item.id);
				if (idx < 0) return [item, ...old];
				const copy = [...old];
				copy[idx] = item;
				return copy;
			});
			void qc.invalidateQueries({ queryKey: keys.stats });
		},
	});
}

export function useDeleteItem() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api(`/api/items/${id}`, { method: "DELETE" }),
		onSuccess: (_r, id) => {
			qc.setQueryData<Item[]>(keys.items, (old) => old?.filter((i) => i.id !== id));
			void qc.invalidateQueries({ queryKey: ["wears"] });
			void qc.invalidateQueries({ queryKey: keys.stats });
		},
	});
}

export function useOutfits() {
	return useQuery({ queryKey: keys.outfits, queryFn: () => api<Outfit[]>("/api/outfits") });
}

export function useSaveOutfit() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, data }: { id?: string; data: OutfitInput }) =>
			id ? api<Outfit>(`/api/outfits/${id}`, { method: "PATCH", body: data }) : api<Outfit>("/api/outfits", { method: "POST", body: data }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: keys.outfits }),
	});
}

export function useDeleteOutfit() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api(`/api/outfits/${id}`, { method: "DELETE" }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: keys.outfits }),
	});
}

export function useWears(from: string, to: string) {
	return useQuery({ queryKey: keys.wears(from, to), queryFn: () => api<WearDay[]>(`/api/wears?from=${from}&to=${to}`) });
}

export function useTodayWear() {
	const today = localDate();
	const q = useWears(today, today);
	return { ...q, day: q.data?.[0] ?? null, today };
}

export function useSetWear() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ date, itemIds, outfitId }: { date: string; itemIds: string[]; outfitId?: string | null }) =>
			api<WearDay>(`/api/wears/${date}`, { method: "PUT", body: { itemIds, outfitId: outfitId ?? null } }),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["wears"] });
			void qc.invalidateQueries({ queryKey: keys.items });
			void qc.invalidateQueries({ queryKey: keys.stats });
		},
	});
}

export function useSettings() {
	return useQuery({ queryKey: keys.settings, queryFn: () => api<AppSettings>("/api/settings"), staleTime: 60_000 });
}

export interface AiProviderPatch extends Partial<Omit<AiProviderPublic, "hasKey" | "keyHint">> {
	id: string;
	apiKey?: string;
	clearKey?: boolean;
}

export type SettingsPatch = Partial<Omit<AppSettings, "ai">> & {
	ai?: {
		providers?: AiProviderPatch[];
		routes?: Partial<Record<AiArea, Partial<AiRoutePublic>>>;
		studio?: Partial<Pick<AppSettings["ai"]["studio"], "auto" | "freeOnly" | "steps" | "budget">>;
	};
};

export function useSaveSettings() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: SettingsPatch) => api<AppSettings>("/api/settings", { method: "PATCH", body: patch }),
		onSuccess: (s) => qc.setQueryData(keys.settings, s),
	});
}

export function useStats() {
	return useQuery({ queryKey: keys.stats, queryFn: () => api<Stats>(`/api/stats?today=${localDate()}`) });
}

export function useTrips() {
	return useQuery({ queryKey: keys.trips, queryFn: () => api<Trip[]>("/api/trips") });
}

export function useSaveTrip() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, data }: { id?: string; data: Partial<Trip> }) =>
			id ? api<Trip>(`/api/trips/${id}`, { method: "PATCH", body: data }) : api<Trip>("/api/trips", { method: "POST", body: data }),
		onSuccess: (trip) => {
			qc.setQueryData<Trip[]>(keys.trips, (old) => {
				if (!old) return [trip];
				const idx = old.findIndex((t) => t.id === trip.id);
				if (idx < 0) return [trip, ...old];
				const copy = [...old];
				copy[idx] = trip;
				return copy;
			});
		},
	});
}

export function useTryons() {
	return useQuery({ queryKey: keys.tryons, queryFn: () => api<TryOn[]>("/api/tryons") });
}

export function useWeather() {
	const { data: settings } = useSettings();
	const loc = settings?.location;
	return useQuery({
		queryKey: ["weather", loc?.lat, loc?.lon, loc?.useGeolocation],
		enabled: !!loc,
		staleTime: 20 * 60_000,
		gcTime: 6 * 3600_000,
		retry: 1,
		queryFn: async (): Promise<WeatherNow> => {
			let coords = { lat: loc!.lat, lon: loc!.lon, name: loc!.name };
			if (loc!.useGeolocation) {
				const pos = await currentPosition();
				if (pos) coords = { ...pos, name: "Dein Standort" };
			}
			return fetchWeather(coords);
		},
	});
}

export interface SuggestResponse {
	suggestions: OutfitSuggestion[];
	source: "ai" | "rules";
	aiError?: string;
}

export function useSuggestions(occasion: string, useAi: boolean, seed: string, enabled = true) {
	const { data: weather } = useWeather();
	const { data: items } = useItems();
	const count = items?.length ?? 0;
	return useQuery({
		queryKey: ["suggest", occasion, useAi, seed, weather?.temp, count],
		enabled: enabled && count > 0,
		retry: useAi ? 0 : 1,
		staleTime: 3 * 3600_000,
		queryFn: () =>
			api<SuggestResponse>("/api/ai/suggest", {
				method: "POST",
				body: {
					weather: weather ?? { feelsLike: 15, description: "unbekannt" },
					occasion,
					useAi,
					seed,
					date: new Date().toLocaleString("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
				},
			}),
	});
}

export function useShoppingCheck() {
	return useMutation({
		mutationFn: (body: { image?: string; note?: string; category?: string; colors?: string[] }) =>
			api<ShoppingCheckResult>("/api/ai/shopping", { method: "POST", body }),
	});
}
