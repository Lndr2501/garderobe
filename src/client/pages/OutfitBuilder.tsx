import { ArrowLeft, Check, Dices, Lock, LockOpen, Save, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { colorHarmony } from "../../shared/rules.ts";
import type { Item } from "../../shared/types.ts";
import { Holo } from "../components/Holo.tsx";
import { Segmented, Switch } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { PageHead } from "../components/Layout.tsx";
import { OutfitCollage } from "../components/OutfitCollage.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { localDate } from "../lib/date.ts";
import { useActiveItems, useDeleteOutfit, useOutfits, useSaveOutfit, useSetWear } from "../queries.ts";

export const SLOTS = [
	{ key: "outerwear", label: "Jacke", cats: ["outerwear"] },
	{ key: "top", label: "Oberteil / Kleid", cats: ["top", "dress"] },
	{ key: "bottom", label: "Hose / Rock", cats: ["bottom"] },
	{ key: "shoes", label: "Schuhe", cats: ["shoes"] },
	{ key: "bag", label: "Tasche", cats: ["bag"] },
	{ key: "accessory", label: "Accessoire", cats: ["accessory", "other"] },
] as const;

type SlotKey = (typeof SLOTS)[number]["key"];
type Selection = Partial<Record<SlotKey, string | null>>;

export function slotFor(item: Item): SlotKey {
	return (SLOTS.find((s) => (s.cats as readonly string[]).includes(item.category))?.key ?? "accessory") as SlotKey;
}

export function selectionFromIds(ids: string[], map: Map<string, Item>): Selection {
	const sel: Selection = {};
	for (const id of ids) {
		const it = map.get(id);
		if (it) sel[slotFor(it)] = id;
	}
	return sel;
}

export function SlotRows({
	items,
	sel,
	setSel,
	locks,
	setLocks,
}: {
	items: Item[];
	sel: Selection;
	setSel: (s: Selection) => void;
	locks?: Partial<Record<SlotKey, boolean>>;
	setLocks?: (l: Partial<Record<SlotKey, boolean>>) => void;
}) {
	const isDress = !!(sel.top && items.find((i) => i.id === sel.top)?.category === "dress");
	return (
		<div className="stack" style={{ gap: 14 }}>
			{SLOTS.map((slot) => {
				const list = items.filter((i) => (slot.cats as readonly string[]).includes(i.category));
				if (list.length === 0) return null;
				const disabled = slot.key === "bottom" && isDress;
				return (
					<div key={slot.key} style={{ opacity: disabled ? 0.45 : 1 }}>
						<div className="row between" style={{ marginBottom: 6 }}>
							<span className="label">{slot.label}</span>
							{locks && setLocks && (
								<button
									className="btn ghost small"
									onClick={() => setLocks({ ...locks, [slot.key]: !locks[slot.key] })}
									aria-label={locks[slot.key] ? "Entsperren" : "Sperren"}
									title="Beim Würfeln festhalten"
								>
									{locks[slot.key] ? <Lock size={15} /> : <LockOpen size={15} />}
								</button>
							)}
						</div>
						<div className="thumb-strip">
							<button
								className="thumb"
								style={{ borderColor: !sel[slot.key] ? "var(--accent)" : undefined, borderWidth: !sel[slot.key] ? 2 : 1 }}
								onClick={() => setSel({ ...sel, [slot.key]: null })}
								aria-label="Keins"
							>
								<span className="faint">–</span>
							</button>
							{list.map((i) => (
								<button
									key={i.id}
									className="thumb"
									title={i.name}
									style={{ borderColor: sel[slot.key] === i.id ? "var(--accent)" : undefined, borderWidth: sel[slot.key] === i.id ? 2 : 1 }}
									onClick={() => {
										const next = { ...sel, [slot.key]: i.id };
										if (slot.key === "top" && i.category === "dress") next.bottom = null;
										setSel(next);
									}}
								>
									<ItemImage item={i} />
								</button>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function OutfitBuilder() {
	const params = useParams<{ id?: string }>();
	const search = new URLSearchParams(useSearch());
	const items = useActiveItems();
	const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
	const { data: outfits } = useOutfits();
	const existing = params.id ? outfits?.find((o) => o.id === params.id) : undefined;
	const [sel, setSel] = useState<Selection>({});
	const [locks, setLocks] = useState<Partial<Record<SlotKey, boolean>>>({});
	const [view, setView] = useState<"collage" | "avatar">("collage");
	const [saveOpen, setSaveOpen] = useState(false);
	const [name, setName] = useState("");
	const [occasion, setOccasion] = useState("");
	const [favorite, setFavorite] = useState(false);
	const [init, setInit] = useState(false);
	const saveOutfit = useSaveOutfit();
	const delOutfit = useDeleteOutfit();
	const setWear = useSetWear();
	const toast = useToast();
	const [, navigate] = useLocation();

	useEffect(() => {
		if (init || items.length === 0) return;
		if (params.id && !outfits) return;
		if (existing) {
			setSel(selectionFromIds(existing.itemIds, map));
			setName(existing.name);
			setOccasion(existing.occasion);
			setFavorite(existing.favorite);
		} else {
			const ids = (search.get("ids") ?? search.get("mit") ?? "").split(",").filter(Boolean);
			setSel(selectionFromIds(ids, map));
		}
		setInit(true);
	}, [init, items, outfits, existing, params.id, map, search]);

	const chosen = SLOTS.map((s) => sel[s.key])
		.filter((x): x is string => !!x)
		.map((id) => map.get(id))
		.filter((x): x is Item => !!x);

	const shuffle = () => {
		const next: Selection = { ...sel };
		const pick = (cats: readonly string[], base: Item[]) => {
			const list = items.filter((i) => cats.includes(i.category));
			if (!list.length) return null;
			const scored = list.map((i) => ({ i, s: colorHarmony([...base, i]) + Math.random() * 1.2 }));
			scored.sort((a, b) => b.s - a.s);
			return scored[0]!.i;
		};
		const base: Item[] = [];
		const order: SlotKey[] = ["top", "bottom", "outerwear", "shoes", "bag", "accessory"];
		for (const key of order) {
			if (locks[key]) {
				const it = next[key] ? map.get(next[key]!) : undefined;
				if (it) base.push(it);
				continue;
			}
			if (key === "bottom" && base.some((b) => b.category === "dress")) {
				next.bottom = null;
				continue;
			}
			if ((key === "bag" || key === "accessory" || key === "outerwear") && Math.random() < 0.4) {
				next[key] = null;
				continue;
			}
			const slot = SLOTS.find((s) => s.key === key)!;
			const cats = key === "top" ? (Math.random() < 0.2 ? ["dress"] : ["top"]) : slot.cats;
			const it = pick(cats, base) ?? (key === "top" ? pick(["top", "dress"], base) : null);
			next[key] = it?.id ?? null;
			if (it) base.push(it);
		}
		setSel(next);
	};

	const doSave = () => {
		const itemIds = chosen.map((c) => c.id);
		if (!itemIds.length) return toast("Wähle mindestens ein Teil", "error");
		saveOutfit.mutate(
			{ id: existing?.id, data: { name: name.trim() || "Mein Outfit", occasion, favorite, itemIds } },
			{
				onSuccess: (o) => {
					toast("Outfit gespeichert", "ok");
					setSaveOpen(false);
					if (!existing) navigate(`/outfits/${o.id}`, { replace: true });
				},
				onError: (e) => toast(errorText(e), "error"),
			},
		);
	};

	return (
		<div className="container page">
			<PageHead
				title={existing ? existing.name || "Outfit" : "Outfit-Baukasten"}
				left={
					<button className="icon-btn" onClick={() => navigate("/outfits")} aria-label="Zurück">
						<ArrowLeft size={18} />
					</button>
				}
				right={
					<button className="btn primary" onClick={() => setSaveOpen(true)} disabled={!chosen.length}>
						<Save size={17} /> Speichern
					</button>
				}
			/>
			<div className="two-col">
				<div className="stack">
					<Segmented
						options={[
							{ key: "collage", label: "Collage" },
							{ key: "avatar", label: "Avatar" },
						]}
						value={view}
						onChange={setView}
					/>
					<div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>
						{view === "collage" ? <OutfitCollage items={chosen} className="card flat" /> : <Holo items={chosen} />}
					</div>
					<div className="row wrap" style={{ justifyContent: "center" }}>
						<button className="btn" onClick={shuffle} disabled={!items.length}>
							<Dices size={17} /> Zufall
						</button>
						<button
							className="btn"
							disabled={!chosen.length || setWear.isPending}
							onClick={() =>
								setWear.mutate(
									{ date: localDate(), itemIds: chosen.map((c) => c.id), outfitId: existing?.id },
									{ onSuccess: () => toast("Für heute eingetragen", "ok"), onError: (e) => toast(errorText(e), "error") },
								)
							}
						>
							<Check size={17} /> Heute anziehen
						</button>
						<Link href={`/anprobe?ids=${chosen.map((c) => c.id).join(",")}`} className="btn">
							<UserRound size={17} /> Anprobieren
						</Link>
					</div>
				</div>
				<div className="card">
					{items.length === 0 ? (
						<div className="empty">Noch keine Teile im Schrank.</div>
					) : (
						<SlotRows items={items} sel={sel} setSel={setSel} locks={locks} setLocks={setLocks} />
					)}
				</div>
			</div>
			{existing && (
				<button
					className="btn danger"
					style={{ alignSelf: "flex-start" }}
					onClick={() => {
						if (!confirm("Outfit löschen?")) return;
						delOutfit.mutate(existing.id, { onSuccess: () => navigate("/outfits", { replace: true }) });
					}}
				>
					<Trash2 size={16} /> Outfit löschen
				</button>
			)}
			{saveOpen && (
				<Sheet title="Outfit speichern" onClose={() => setSaveOpen(false)}>
					<div className="stack">
						<label className="field">
							<span>Name</span>
							<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Sonntagsspaziergang" autoFocus />
						</label>
						<label className="field">
							<span>Anlass</span>
							<input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="z.B. Büro, Date, Sport" />
						</label>
						<div className="row between">
							<span className="label">Favorit</span>
							<Switch label="Favorit" on={favorite} onChange={setFavorite} />
						</div>
						<button className="btn primary block" onClick={doSave} disabled={saveOutfit.isPending}>
							Speichern
						</button>
					</div>
				</Sheet>
			)}
		</div>
	);
}
