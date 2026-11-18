import { Shirt } from "lucide-react";
import { imgUrl } from "../api.ts";
import type { Item } from "../../shared/types.ts";

export function ItemImage({ item, size = "thumb", side = "front", className }: { item: Item | undefined; size?: "thumb" | "full"; side?: "front" | "back"; className?: string }) {
	if (!item) return null;
	const key =
		side === "back"
			? size === "full"
				? (item.imageBack ?? item.thumbBack)
				: (item.thumbBack ?? item.imageBack)
			: size === "full"
				? (item.imageFront ?? item.thumbFront)
				: (item.thumbFront ?? item.imageFront);
	if (!key) {
		return (
			<div className="placeholder-piece">
				<Shirt size={28} />
			</div>
		);
	}
	return <img className={className} src={imgUrl(key)} alt={item.name} loading="lazy" decoding="async" draggable={false} />;
}
