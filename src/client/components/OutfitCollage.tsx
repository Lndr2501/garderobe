import type { Item } from "../../shared/types.ts";
import { imgUrl } from "../api.ts";
import { frontKey } from "../lib/studio.ts";

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

const UPPER = new Set(["outerwear", "top", "dress"]);
const LOWER = new Set(["bottom", "shoes"]);

/** Few pieces get big boxes; full outfits use the category layout. */
function boxesFor(items: Item[]): Box[] {
	if (items.length === 1) return [{ left: 6, top: 4, width: 88, height: 92, z: 1 }];
	if (items.length === 2) {
		const [a, b] = items as [Item, Item];
		if (UPPER.has(a.category) && LOWER.has(b.category))
			return [
				{ left: 14, top: 2, width: 72, height: 54, z: 2 },
				{ left: 22, top: 46, width: 56, height: 52, z: 1 },
			];
		if (LOWER.has(a.category) && UPPER.has(b.category))
			return [
				{ left: 22, top: 46, width: 56, height: 52, z: 1 },
				{ left: 14, top: 2, width: 72, height: 54, z: 2 },
			];
		return [
			{ left: 0, top: 4, width: 62, height: 78, z: 1 },
			{ left: 38, top: 18, width: 62, height: 78, z: 2 },
		];
	}
	const used = new Map<string, number>();
	return items.map((item) => {
		const base = LAYOUT[item.category] ?? LAYOUT.other!;
		const n = used.get(item.category) ?? 0;
		used.set(item.category, n + 1);
		return { left: base.left + n * 6, top: base.top + n * 5, width: base.width, height: base.height, z: base.z + n };
	});
}

export function OutfitCollage({ items, className = "" }: { items: Item[]; className?: string }) {
	const boxes = boxesFor(items);
	return (
		<div className={`collage ${className}`}>
			{items.map((item, i) => {
				const box = boxes[i]!;
				const key = frontKey(item);
				if (!key) return null;
				return (
					<img
						key={item.id}
						src={imgUrl(key)}
						alt={item.name}
						loading="lazy"
						style={{
							left: `${box.left}%`,
							top: `${box.top}%`,
							width: `${box.width}%`,
							height: `${box.height}%`,
							zIndex: box.z,
						}}
					/>
				);
			})}
		</div>
	);
}
