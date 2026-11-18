import type { Item } from "../../shared/types.ts";
import { imgUrl } from "../api.ts";

type Box = { left: number; top: number; width: number; height: number; z: number };

const LAYOUT: Record<string, Box> = {
	outerwear: { left: 2, top: 4, width: 52, height: 46, z: 1 },
	top: { left: 30, top: 6, width: 48, height: 40, z: 2 },
	dress: { left: 26, top: 4, width: 50, height: 62, z: 2 },
	bottom: { left: 30, top: 44, width: 42, height: 46, z: 3 },
	shoes: { left: 68, top: 76, width: 30, height: 20, z: 4 },
	bag: { left: 70, top: 44, width: 28, height: 26, z: 4 },
	accessory: { left: 4, top: 56, width: 26, height: 22, z: 4 },
	other: { left: 4, top: 78, width: 24, height: 18, z: 4 },
};

export function OutfitCollage({ items, className = "" }: { items: Item[]; className?: string }) {
	const used = new Map<string, number>();
	return (
		<div className={`collage ${className}`}>
			{items.map((item) => {
				const base = LAYOUT[item.category] ?? LAYOUT.other!;
				const n = used.get(item.category) ?? 0;
				used.set(item.category, n + 1);
				const key = item.thumbFront ?? item.imageFront;
				if (!key) return null;
				return (
					<img
						key={item.id}
						src={imgUrl(key)}
						alt={item.name}
						loading="lazy"
						style={{
							left: `${base.left + n * 6}%`,
							top: `${base.top + n * 5}%`,
							width: `${base.width}%`,
							height: `${base.height}%`,
							zIndex: base.z + n,
						}}
					/>
				);
			})}
		</div>
	);
}
