import { useMemo, useRef, useState } from "react";
import { layersFromIds, zoneOf, ZONES, type Zone } from "../../shared/layers.ts";
import type { Item } from "../../shared/types.ts";
import { imgUrl } from "../api.ts";
import { frontKey } from "../lib/studio.ts";

type Box = { left: number; top: number; width: number; height: number };

/** Where a piece sits on the figure (percent of the stage). */
function anchor(item: Item, zone: Zone): Box {
	switch (item.category) {
		case "outerwear":
			return { left: 19, top: 18.5, width: 62, height: 38 };
		case "top":
			return { left: 24, top: 19.5, width: 52, height: 32 };
		case "dress":
			return { left: 23, top: 19.5, width: 54, height: 56 };
		case "bottom":
			return { left: 29, top: 46, width: 42, height: 45 };
		case "base":
			return zone === "legs" ? { left: 31, top: 47, width: 38, height: 42 } : { left: 26, top: 20, width: 48, height: 31 };
		case "socks":
			return { left: 33, top: 84, width: 34, height: 11 };
		case "shoes":
			return { left: 30, top: 89, width: 40, height: 10 };
		case "accessory":
			return { left: 38, top: 14, width: 24, height: 12 };
		case "bag":
			return { left: 66, top: 42, width: 26, height: 20 };
		default:
			return { left: 70, top: 70, width: 22, height: 16 };
	}
}

/** Paint order of the zones: legs under the top, shoes over the trouser hem, extras on top. */
const ZONE_Z: Record<Zone, number> = { legs: 10, feet: 20, torso: 30, extras: 40 };

/**
 * Hologram mannequin wearing the outfit. Pieces of one body zone are layered inside → out and
 * really sit at different depths: drag to turn the figure, "explode" fans the layers apart in 3D.
 */
export function Holo({ items, exploded = false }: { items: Item[]; exploded?: boolean }) {
	const [rot, setRot] = useState(0);
	const start = useRef<{ x: number; r: number } | null>(null);
	const pieces = useMemo(() => {
		const map = new Map(items.map((i) => [i.id, i]));
		const layers = layersFromIds(
			items.map((i) => i.id),
			map,
		);
		return ZONES.flatMap((z) =>
			layers[z.key].map((id, i) => {
				const item = map.get(id)!;
				return { item, zone: z.key, index: i, count: layers[z.key].length };
			}),
		);
	}, [items]);
	const spread = exploded ? 34 : 0;
	const turn = exploded ? -30 + rot : rot;
	return (
		<div
			className={`holo ${exploded ? "exploded" : ""}`}
			onPointerDown={(e) => {
				start.current = { x: e.clientX, r: rot };
				(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (!start.current) return;
				setRot(Math.max(-40, Math.min(40, start.current.r + (e.clientX - start.current.x) / 4)));
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
			<div className="figure" style={{ transform: `rotateY(${turn}deg) rotateX(${exploded ? 6 : 0}deg)` }}>
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
				{pieces.map(({ item, zone, index }) => {
					const a = anchor(item, zone);
					const key = frontKey(item, "full");
					if (!key) return null;
					// Outer layers are a touch bigger so they cover what's underneath, like real clothes.
					const grow = zone === "extras" ? 1 : 1 + index * 0.035;
					const w = a.width * grow;
					const h = a.height * grow;
					return (
						<img
							key={item.id}
							className="layer"
							src={imgUrl(key)}
							alt={item.name}
							draggable={false}
							style={{
								left: `${a.left - (w - a.width) / 2}%`,
								top: `${a.top - (h - a.height) / 4}%`,
								width: `${w}%`,
								height: `${h}%`,
								zIndex: ZONE_Z[zone] + index,
								// Depth keeps the paint order (zones, then layers); exploded adds real distance per layer.
								transform: exploded
									? `translate3d(${-index * 16}%, ${-index * 1.5}%, ${(ZONE_Z[zone] + index) * 0.4 + index * spread}px)`
									: `translateZ(${(ZONE_Z[zone] + index) * 0.4}px)`,
							}}
						/>
					);
				})}
			</div>
			<div className="floor" />
		</div>
	);
}
