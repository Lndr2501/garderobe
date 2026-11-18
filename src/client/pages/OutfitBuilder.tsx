import { ArrowLeft, ChevronDown, ChevronUp, Check, Dices, Layers3, Lock, LockOpen, Save, Thermometer, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
	addLayer,
	emptyLayers,
	idsFromLayers,
	layersFromIds,
	moveLayer,
	removeLayer,
	torsoWarmth,
	zoneOf,
	ZONES,
	type Layers,
	type Zone,
} from "../../shared/layers.ts";
import { colorHarmony, targetWarmth } from "../../shared/rules.ts";
import type { Item } from "../../shared/types.ts";
import { Holo } from "../components/Holo.tsx";
import { Segmented, Switch } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { PageHead } from "../components/Layout.tsx";
import { OutfitCollage } from "../components/OutfitCollage.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { localDate } from "../lib/date.ts";
import { useActiveItems, useDeleteOutfit, useOutfits, useSaveOutfit, useSetWear, useWeather } from "../queries.ts";

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

export function slotFor(item: Item): SlotKey | null {
	return (SLOTS.find((s) => (s.cats as readonly string[]).includes(item.category))?.key ?? null) as SlotKey | null;
}

/** One piece per slot (try-on). Layered outfits list inner layers first, so the outermost wins. */
export function selectionFromIds(ids: string[], map: Map<string, Item>): Selection {
	const sel: Selection = {};
	for (const id of ids) {
		const it = map.get(id);
		const slot = it && slotFor(it);
		if (slot) sel[slot] = id;
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

/** Pieces of one body zone, outermost first, with buttons to move a layer in or out. */
function ZoneRows({
	items,
	map,
	layers,
	setLayers,
	locks,
	setLocks,
}: {
	items: Item[];
	map: Map<string, Item>;
	layers: Layers;
	setLayers: (l: Layers) => void;
	locks: Partial<Record<Zone, boolean>>;
	setLocks: (l: Partial<Record<Zone, boolean>>) => void;
}) {
	return (
		<div className="stack" style={{ gap: 12 }}>
			{ZONES.map((zone) => {
				const chosen = layers[zone.key];
				const candidates = items.filter((i) => zoneOf(i) === zone.key && !chosen.includes(i.id));
				if (!chosen.length && !candidates.length) return null;
				const outerFirst = [...chosen].reverse();
				return (
					<div key={zone.key} className="zone-block">
						<div className="row between">
							<span className="label">
								{zone.label}
								{chosen.length > 1 ? ` · ${chosen.length} Lagen` : ""}
							</span>
							<button
								className="btn ghost small"
								onClick={() => setLocks({ ...locks, [zone.key]: !locks[zone.key] })}
								aria-label={locks[zone.key] ? `${zone.label} entsperren` : `${zone.label} sperren`}
								title="Beim Würfeln festhalten"
							>
								{locks[zone.key] ? <Lock size={15} /> : <LockOpen size={15} />}
							</button>
						</div>
						{outerFirst.map((id, i) => {
							const it = map.get(id);
							if (!it) return null;
							const depth = chosen.length === 1 ? "" : i === 0 ? "außen" : i === outerFirst.length - 1 ? "innen" : `Lage ${outerFirst.length - i}`;
							return (
								<div key={id} className="layer-row">
									<div className="thumb">
										<ItemImage item={it} />
									</div>
									<div style={{ minWidth: 0 }}>
										<div className="name">{it.name || it.subcategory || "Teil"}</div>
										{depth && <div className="depth">{depth}</div>}
									</div>
									<div className="actions">
										{chosen.length > 1 && (
											<>
												<button className="icon-btn" aria-label={`${it.name} weiter nach außen`} disabled={i === 0} onClick={() => setLayers(moveLayer(layers, id, 1))}>
													<ChevronUp size={16} />
												</button>
												<button
													className="icon-btn"
													aria-label={`${it.name} weiter nach innen`}
													disabled={i === outerFirst.length - 1}
													onClick={() => setLayers(moveLayer(layers, id, -1))}
												>
													<ChevronDown size={16} />
												</button>
											</>
										)}
										<button className="icon-btn" aria-label={`${it.name} ausziehen`} onClick={() => setLayers(removeLayer(layers, id))}>
											<X size={16} />
										</button>
									</div>
								</div>
							);
						})}
						{candidates.length > 0 && chosen.length < zone.max && (
							<div className="thumb-strip">
								{candidates.map((i) => (
									<button key={i.id} className="thumb" title={i.name} aria-label={`${i.name || "Teil"} anziehen`} onClick={() => setLayers(addLayer(layers, i, map))}>
										<ItemImage item={i} />
									</button>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** Random outfit that respects locked zones and dresses in layers when it's cold. */
function shuffleLayers(items: Item[], map: Map<string, Item>, current: Layers, locks: Partial<Record<Zone, boolean>>, warmth: number | null): Layers {
	const next: Layers = { ...emptyLayers() };
	const base: Item[] = [];
	for (const z of ZONES) {
		if (locks[z.key]) {
			next[z.key] = current[z.key];
			for (const id of current[z.key]) if (map.get(id)) base.push(map.get(id)!);
		}
	}
	const pick = (filter: (i: Item) => boolean) => {
		const list = items.filter((i) => filter(i) && !base.includes(i));
		if (!list.length) return null;
		const scored = list.map((i) => ({ i, s: colorHarmony([...base, i]) + Math.random() * 1.2 }));
		scored.sort((a, b) => b.s - a.s);
		return scored[0]!.i;
	};
	const wear = (zone: Zone, item: Item | null) => {
		if (!item) return;
		base.push(item);
		next[zone] = addLayer(next, item, map)[zone];
	};
	const cold = warmth ?? 3;
	if (!locks.torso) {
		const dress = Math.random() < 0.2 ? pick((i) => i.category === "dress") : null;
		wear("torso", dress ?? pick((i) => i.category === "top"));
		if (cold >= 4) wear("torso", pick((i) => i.category === "top" && /pullover|pulli|hoodie|sweat|strick|cardigan|fleece/i.test(`${i.subcategory} ${i.name}`)));
		if (cold >= 5) wear("torso", pick((i) => i.category === "base" && zoneOf(i) === "torso"));
		if (cold >= 3 || Math.random() < 0.35) wear("torso", pick((i) => i.category === "outerwear"));
	}
	const hasDress = [...next.torso].some((id) => map.get(id)?.category === "dress");
	if (!locks.legs) {
		if (!hasDress) wear("legs", pick((i) => i.category === "bottom"));
		if (cold >= 5) wear("legs", pick((i) => i.category === "base" && zoneOf(i) === "legs"));
	}
	if (!locks.feet) {
		wear("feet", pick((i) => i.category === "shoes"));
		if (Math.random() < 0.8) wear("feet", pick((i) => i.category === "socks"));
	}
	if (!locks.extras && Math.random() < 0.45) wear("extras", pick((i) => zoneOf(i) === "extras"));
	return next;
}

export function OutfitBuilder() {
	const params = useParams<{ id?: string }>();
	const search = new URLSearchParams(useSearch());
	const items = useActiveItems();
	const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
	const { data: outfits } = useOutfits();
	const { data: weather } = useWeather();
	const existing = params.id ? outfits?.find((o) => o.id === params.id) : undefined;
	const [layers, setLayers] = useState<Layers>(emptyLayers);
	const [locks, setLocks] = useState<Partial<Record<Zone, boolean>>>({});
	const [view, setView] = useState<"collage" | "avatar">("avatar");
	const [exploded, setExploded] = useState(false);
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
			setLayers(layersFromIds(existing.itemIds, map));
			setName(existing.name);
			setOccasion(existing.occasion);
			setFavorite(existing.favorite);
		} else {
			const ids = (search.get("ids") ?? search.get("mit") ?? "").split(",").filter(Boolean);
			setLayers(layersFromIds(ids, map));
		}
		setInit(true);
	}, [init, items, outfits, existing, params.id, map, search]);

	const chosen = idsFromLayers(layers)
		.map((id) => map.get(id))
		.filter((x): x is Item => !!x);
	const target = weather ? targetWarmth(weather.feelsLike) : null;
	const warmth = torsoWarmth(layers, map);

	const shuffle = () => setLayers(shuffleLayers(items, map, layers, locks, target));

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
					<div className="row between wrap">
						<Segmented
							options={[
								{ key: "avatar", label: "Avatar" },
								{ key: "collage", label: "Collage" },
							]}
							value={view}
							onChange={setView}
						/>
						{view === "avatar" && (
							<button className={`btn small ${exploded ? "primary" : "soft"}`} onClick={() => setExploded((x) => !x)} aria-pressed={exploded}>
								<Layers3 size={15} /> Lagen auffächern
							</button>
						)}
					</div>
					<div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>
						{view === "collage" ? <OutfitCollage items={chosen} className="card flat" /> : <Holo items={chosen} exploded={exploded} />}
					</div>
					{target !== null && layers.torso.length > 0 && (
						<div className="warmth-hint">
							<Thermometer size={15} />
							<span>
								Oberkörper-Wärme {Math.round(warmth * 10) / 10} von 5 · heute passend: {target}
								{warmth + 0.5 < target ? " – eine Lage mehr?" : warmth - 1.5 > target ? " – eher zu warm" : " ✓"}
							</span>
						</div>
					)}
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
						<ZoneRows items={items} map={map} layers={layers} setLayers={setLayers} locks={locks} setLocks={setLocks} />
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
