import { useRef, useState } from "react";
import type { Item } from "../../shared/types.ts";
import { imgUrl } from "../api.ts";
import { frontKey } from "../lib/studio.ts";

type Box = { left: number; top: number; width: number; height: number; z: number };

const ANCHORS: Record<string, Box> = {
	bottom: { left: 29, top: 46, width: 42, height: 45, z: 2 },
	shoes: { left: 30, top: 89, width: 40, height: 10, z: 3 },
	top: { left: 24, top: 19.5, width: 52, height: 32, z: 4 },
	dress: { left: 23, top: 19.5, width: 54, height: 56, z: 4 },
	outerwear: { left: 19, top: 18.5, width: 62, height: 38, z: 5 },
	accessory: { left: 38, top: 14, width: 24, height: 12, z: 6 },
	bag: { left: 66, top: 42, width: 26, height: 20, z: 7 },
	other: { left: 70, top: 70, width: 22, height: 16, z: 7 },
};

/** Stylized hologram mannequin with outfit pieces layered on top (2D "paper doll"). */
export function Holo({ items }: { items: Item[] }) {
	const [rot, setRot] = useState(0);
	const start = useRef<{ x: number; r: number } | null>(null);
	return (
		<div
			className="holo"
			onPointerDown={(e) => {
				start.current = { x: e.clientX, r: rot };
				(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (!start.current) return;
				setRot(Math.max(-35, Math.min(35, start.current.r + (e.clientX - start.current.x) / 4)));
			}}
			onPointerUp={() => {
				start.current = null;
				setRot(0);
			}}
			onPointerCancel={() => {
				start.current = null;
				setRot(0);
			}}
		>
			<div className="figure" style={{ transform: `rotateY(${rot}deg)` }}>
				<svg className="body" viewBox="0 0 200 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
					<defs>
						<linearGradient id="holo-g" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stopColor="#4fb3ff" stopOpacity="0.85" />
							<stop offset="1" stopColor="#1f6fff" stopOpacity="0.55" />
						</linearGradient>
						<pattern id="holo-lines" width="4" height="4" patternUnits="userSpaceOnUse">
							<rect width="4" height="2" fill="#9fd4ff" opacity="0.35" />
						</pattern>
					</defs>
					<g stroke="#8fd0ff" strokeWidth="1.2">
						<ellipse cx="100" cy="40" rx="17" ry="22" fill="url(#holo-g)" />
						<path
							d="M92 60 L108 60 L109 72 Q130 74 140 82 Q147 88 148 100 L152 160 Q154 190 156 212 L149 214 Q144 190 140 165 L134 112 L132 150 Q130 170 128 184 Q134 200 133 214 L128 300 Q127 340 124 378 L128 388 L108 388 L109 376 Q106 330 104 300 L101 224 L99 224 L96 300 Q94 330 91 376 L92 388 L72 388 L76 378 Q73 340 72 300 L67 214 Q66 200 72 184 Q70 170 68 150 L66 112 L60 165 Q56 190 51 214 L44 212 Q46 190 48 160 L52 100 Q53 88 60 82 Q70 74 91 72 Z"
							fill="url(#holo-g)"
						/>
					</g>
					<g fill="url(#holo-lines)">
						<ellipse cx="100" cy="40" rx="17" ry="22" />
					</g>
				</svg>
				{items.map((item) => {
					const a = ANCHORS[item.category] ?? ANCHORS.other!;
					const key = frontKey(item, "full");
					if (!key) return null;
					return (
						<img
							key={item.id}
							className="layer"
							src={imgUrl(key)}
							alt={item.name}
							style={{ left: `${a.left}%`, top: `${a.top}%`, width: `${a.width}%`, height: `${a.height}%`, zIndex: a.z }}
						/>
					);
				})}
			</div>
			<div className="floor" />
		</div>
	);
}
