import { useMemo, useState } from "react";
import { CATEGORIES } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { useActiveItems } from "../queries.ts";
import { ItemTile } from "./ItemTile.tsx";
import { Sheet } from "./Sheet.tsx";

export function ItemPicker({
	title = "Teile auswählen",
	initial = [],
	max = 12,
	onDone,
	onClose,
	categories,
}: {
	title?: string;
	initial?: string[];
	max?: number;
	onDone: (ids: string[]) => void;
	onClose: () => void;
	categories?: string[];
}) {
	const items = useActiveItems();
	const [sel, setSel] = useState<string[]>(initial);
	const [cat, setCat] = useState<string>("all");
	const [q, setQ] = useState("");
	const visible = useMemo(() => {
		const query = q.trim().toLowerCase();
		return items.filter(
			(i: Item) =>
				(!categories || categories.includes(i.category)) &&
				(cat === "all" || i.category === cat) &&
				(!query || `${i.name} ${i.subcategory} ${i.brand} ${i.colors.join(" ")}`.toLowerCase().includes(query)),
		);
	}, [items, cat, q, categories]);
	const cats = CATEGORIES.filter((c) => items.some((i) => i.category === c.key) && (!categories || categories.includes(c.key)));
	return (
		<Sheet title={title} onClose={onClose}>
			<div className="stack">
				<input className="input" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
				<div className="chips">
					<button type="button" className={`chip ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
						Alle
					</button>
					{cats.map((c) => (
						<button type="button" key={c.key} className={`chip ${cat === c.key ? "on" : ""}`} onClick={() => setCat(c.key)}>
							{c.label}
						</button>
					))}
				</div>
				<div className="grid grid-items" style={{ maxHeight: "48dvh", overflowY: "auto", padding: 2 }}>
					{visible.map((i) => (
						<ItemTile
							key={i.id}
							item={i}
							selected={sel.includes(i.id)}
							onClick={() =>
								setSel((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : max === 1 ? [i.id] : s.length >= max ? s : [...s, i.id]))
							}
						/>
					))}
					{visible.length === 0 && <div className="empty">Keine Teile gefunden.</div>}
				</div>
				<button className="btn primary block" onClick={() => onDone(sel)}>
					Übernehmen ({sel.length})
				</button>
			</div>
		</Sheet>
	);
}
