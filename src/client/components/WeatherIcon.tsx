import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun } from "lucide-react";
import { weatherKind } from "../lib/weather.ts";

export function WeatherIcon({ code, isDay = true, size = 26 }: { code: number; isDay?: boolean; size?: number }) {
	const k = weatherKind(code);
	if (k === "clear") return isDay ? <Sun size={size} /> : <Moon size={size} />;
	if (k === "partly") return isDay ? <CloudSun size={size} /> : <CloudMoon size={size} />;
	if (k === "cloudy") return <Cloud size={size} />;
	if (k === "fog") return <CloudFog size={size} />;
	if (k === "drizzle") return <CloudDrizzle size={size} />;
	if (k === "rain") return <CloudRain size={size} />;
	if (k === "snow") return <CloudSnow size={size} />;
	return <CloudLightning size={size} />;
}
