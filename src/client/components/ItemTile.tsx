import { Check, Heart } from "lucide-react";
import type { Item } from "../../shared/types.ts";
import { ItemImage } from "./ItemImage.tsx";

export function ItemTile({ item, onClick, selected, sub }: { item: Item; onClick?: () => void; selected?: boolean; sub?: string }) {
	return (
		<button type="button" className={`tile ${selected ? "selected" : ""}`} onClick={onClick}>
			<div className="img">
				<ItemImage item={item} />
			</div>
			<div className="t-name">{item.name || "Ohne Namen"}</div>
			{sub && <div className="tiny muted ellipsis">{sub}</div>}
			{selected && (
				<span className="check">
					<Check size={16} />
				</span>
			)}
			{!selected && item.favorite && (
				<span style={{ position: "absolute", top: 10, right: 10, color: "#e5486b" }}>
					<Heart size={16} fill="currentColor" />
				</span>
			)}
			{item.needsReview && !selected && (
				<span className="badge warn" style={{ position: "absolute", top: 10, left: 10 }}>
					prüfen
				</span>
			)}
		</button>
	);
}
