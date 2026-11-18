import type { ReactNode } from "react";
import { timeOfDay } from "../lib/date.ts";

const SKIES = {
	morning: ["#fbd3c4", "#cfe1fb", "#eef5ff"],
	day: ["#8fc0f5", "#bcd9fb", "#e6f1fe"],
	evening: ["#2f3f7d", "#6c6fb3", "#d79ab0"],
	night: ["#070d22", "#13224a", "#2a3b6e"],
} as const;

export function SkyBanner({ children }: { children: ReactNode }) {
	const tod = timeOfDay();
	const [a, b, c] = SKIES[tod];
	const dark = tod === "evening" || tod === "night";
	return (
		<header className={`sky ${tod}`}>
			<svg className="scene" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
				<defs>
					<linearGradient id="sky-g" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor={a} />
						<stop offset="0.6" stopColor={b} />
						<stop offset="1" stopColor={c} />
					</linearGradient>
					<radialGradient id="glow-g">
						<stop offset="0" stopColor={dark ? "#fff6d8" : "#fff7c2"} stopOpacity="0.9" />
						<stop offset="1" stopColor={dark ? "#fff6d8" : "#fff7c2"} stopOpacity="0" />
					</radialGradient>
				</defs>
				<rect width="1200" height="300" fill="url(#sky-g)" />
				{tod === "night" &&
					Array.from({ length: 60 }, (_, i) => (
						<circle key={i} cx={(i * 197) % 1200} cy={(i * 73) % 180} r={i % 7 === 0 ? 1.6 : 0.9} fill="#fff" opacity={0.4 + (i % 5) / 10} />
					))}
				<circle cx={dark ? 640 : 900} cy={dark ? 150 : 80} r="90" fill="url(#glow-g)" />
				<circle cx={dark ? 640 : 900} cy={dark ? 150 : 80} r={dark ? 34 : 40} fill={dark ? "#f6e7c8" : "#fff3b0"} opacity={dark ? 0.95 : 0.9} />
				{dark && (
					<>
						<circle cx="630" cy="142" r="6" fill="#e5d3ad" opacity="0.6" />
						<circle cx="652" cy="160" r="4" fill="#e5d3ad" opacity="0.5" />
					</>
				)}
				{!dark && (
					<g fill="#ffffff" opacity="0.85">
						<ellipse cx="220" cy="90" rx="70" ry="18" />
						<ellipse cx="260" cy="78" rx="44" ry="20" />
						<ellipse cx="1050" cy="130" rx="80" ry="16" />
						<ellipse cx="1010" cy="120" rx="40" ry="16" />
					</g>
				)}
				<path
					d="M0 250 Q80 220 160 236 T320 228 T480 240 T640 226 T800 238 T960 222 T1120 236 T1200 230 V300 H0 Z"
					fill={dark ? "#14203d" : "#9fc0a0"}
					opacity="0.9"
				/>
				<g fill={dark ? "#0b1429" : "#5f8a66"}>
					{Array.from({ length: 48 }, (_, i) => {
						const x = i * 26 + (i % 3) * 5;
						const h = 26 + ((i * 37) % 30);
						return <path key={i} d={`M${x} 300 L${x + 11} ${262 - h} L${x + 22} 300 Z`} />;
					})}
				</g>
			</svg>
			<div className="container">{children}</div>
		</header>
	);
}
