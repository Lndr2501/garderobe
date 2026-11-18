import type { TripWeatherDay, WeatherNow } from "../../shared/types.ts";
import { localDate } from "./date.ts";

const WMO: Record<number, string> = {
	0: "Klar",
	1: "Überwiegend klar",
	2: "Teils bewölkt",
	3: "Bewölkt",
	45: "Nebel",
	48: "Raureifnebel",
	51: "Leichter Nieselregen",
	53: "Nieselregen",
	55: "Starker Nieselregen",
	56: "Gefrierender Niesel",
	57: "Gefrierender Niesel",
	61: "Leichter Regen",
	63: "Regen",
	65: "Starker Regen",
	66: "Gefrierender Regen",
	67: "Gefrierender Regen",
	71: "Leichter Schnee",
	73: "Schnee",
	75: "Starker Schnee",
	77: "Schneegriesel",
	80: "Regenschauer",
	81: "Regenschauer",
	82: "Heftige Schauer",
	85: "Schneeschauer",
	86: "Schneeschauer",
	95: "Gewitter",
	96: "Gewitter mit Hagel",
	99: "Gewitter mit Hagel",
};

export function describeWeather(code: number): string {
	return WMO[code] ?? "Wetter";
}

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export function weatherKind(code: number): WeatherKind {
	if (code <= 1) return "clear";
	if (code === 2) return "partly";
	if (code === 3) return "cloudy";
	if (code === 45 || code === 48) return "fog";
	if (code >= 51 && code <= 57) return "drizzle";
	if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
	return "storm";
}

interface Coords {
	lat: number;
	lon: number;
	name: string;
}

export async function fetchWeather(c: Coords): Promise<WeatherNow> {
	const url = new URL("https://api.open-meteo.com/v1/forecast");
	url.searchParams.set("latitude", String(c.lat));
	url.searchParams.set("longitude", String(c.lon));
	url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day");
	url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
	url.searchParams.set("timezone", "auto");
	url.searchParams.set("forecast_days", "5");
	const res = await fetch(url);
	if (!res.ok) throw new Error("Wetter nicht verfügbar");
	const j = (await res.json()) as {
		current: {
			temperature_2m: number;
			apparent_temperature: number;
			precipitation: number;
			weather_code: number;
			wind_speed_10m: number;
			is_day: number;
		};
		daily: {
			time: string[];
			temperature_2m_max: number[];
			temperature_2m_min: number[];
			precipitation_probability_max: (number | null)[];
			weather_code: number[];
		};
	};
	const daily = j.daily.time.map((date, i) => ({
		date,
		tMin: j.daily.temperature_2m_min[i] ?? 0,
		tMax: j.daily.temperature_2m_max[i] ?? 0,
		code: j.daily.weather_code[i] ?? 0,
		precipProb: j.daily.precipitation_probability_max[i] ?? 0,
	}));
	return {
		temp: j.current.temperature_2m,
		feelsLike: j.current.apparent_temperature,
		tMin: daily[0]?.tMin ?? j.current.temperature_2m,
		tMax: daily[0]?.tMax ?? j.current.temperature_2m,
		precipProb: daily[0]?.precipProb ?? 0,
		precip: j.current.precipitation,
		wind: j.current.wind_speed_10m,
		code: j.current.weather_code,
		description: describeWeather(j.current.weather_code),
		isDay: j.current.is_day === 1,
		place: c.name,
		daily,
	};
}

/** Daily forecast for a trip. Open-Meteo forecasts up to 16 days ahead. */
export async function fetchTripWeather(lat: number, lon: number, start: string, end: string): Promise<TripWeatherDay[] | null> {
	const today = localDate();
	const max = new Date();
	max.setDate(max.getDate() + 15);
	const maxStr = localDate(max);
	const from = start < today ? today : start;
	const to = end > maxStr ? maxStr : end;
	if (from > to) return null;
	const url = new URL("https://api.open-meteo.com/v1/forecast");
	url.searchParams.set("latitude", String(lat));
	url.searchParams.set("longitude", String(lon));
	url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code");
	url.searchParams.set("timezone", "auto");
	url.searchParams.set("start_date", from);
	url.searchParams.set("end_date", to);
	const res = await fetch(url);
	if (!res.ok) return null;
	const j = (await res.json()) as {
		daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; weather_code: number[] };
	};
	return j.daily.time.map((date, i) => ({
		date,
		tMin: j.daily.temperature_2m_min[i] ?? 0,
		tMax: j.daily.temperature_2m_max[i] ?? 0,
		precip: j.daily.precipitation_sum[i] ?? 0,
		code: j.daily.weather_code[i] ?? 0,
	}));
}

export interface Place {
	name: string;
	detail: string;
	lat: number;
	lon: number;
}

export async function searchPlaces(q: string): Promise<Place[]> {
	if (q.trim().length < 2) return [];
	const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
	url.searchParams.set("name", q.trim());
	url.searchParams.set("count", "6");
	url.searchParams.set("language", "de");
	const res = await fetch(url);
	if (!res.ok) return [];
	const j = (await res.json()) as {
		results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
	};
	return (j.results ?? []).map((r) => ({
		name: r.name,
		detail: [r.admin1, r.country].filter(Boolean).join(", "),
		lat: r.latitude,
		lon: r.longitude,
	}));
}

export function currentPosition(timeout = 6000): Promise<{ lat: number; lon: number } | null> {
	if (!("geolocation" in navigator)) return Promise.resolve(null);
	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			(p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
			() => resolve(null),
			{ timeout, maximumAge: 30 * 60_000 },
		);
	});
}
