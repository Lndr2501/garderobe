import { Shirt } from "lucide-react";
import { imgUrl } from "../api.ts";
import type { Item } from "../../shared/types.ts";
import { frontKey } from "../lib/studio.ts";

export function ItemImage({
	item,
	size = "thumb",
	side = "front",
	className,
	onLoad,
	original,
}: {
	item: Item | undefined;
	size?: "thumb" | "full";
	side?: "front" | "back";
	className?: string;
	onLoad?: (img: HTMLImageElement) => void;
	/** Always the own photo, even if a studio picture exists. */
	original?: boolean;
}) {
	if (!item) return null;
	const key =
		side === "back"
			? size === "full"
				? (item.imageBack ?? item.thumbBack)
				: (item.thumbBack ?? item.imageBack)
			: frontKey(original ? { ...item, preferOriginal: true } : item, size);
	if (!key) {
		return (
			<div className="placeholder-piece">
				<Shirt size={28} />
			</div>
		);
	}
	return (
		<img
			className={className}
			src={imgUrl(key)}
			alt={item.name}
			loading="lazy"
			decoding="async"
			draggable={false}
			onLoad={onLoad ? (e) => onLoad(e.currentTarget) : undefined}
		/>
	);
}
