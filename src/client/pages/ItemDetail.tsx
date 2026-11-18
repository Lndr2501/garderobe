import { Archive, ArchiveRestore, ArrowLeft, Camera, Check, Heart, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { pairingItems } from "../../shared/rules.ts";
import { categoryDef, colorDef, FORMALITY_LABELS, SEASONS, WARMTH_LABELS } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { uploadImage } from "../api.ts";
import { Meter, swatchStyle } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { daysBetween, localDate, relativeDays } from "../lib/date.ts";
import { money } from "../lib/format.ts";
import { processImage } from "../lib/image.ts";
import { useDeleteItem, useItems, useOutfits, useSaveItem, useSetWear, useSettings, useTodayWear } from "../queries.ts";
import { OutfitCollage } from "../components/OutfitCollage.tsx";

export function ItemDetail() {
	const { id } = useParams<{ id: string }>();
	const { data: items } = useItems();
	const { data: settings } = useSettings();
	const { data: outfits } = useOutfits();
	const item = items?.find((i) => i.id === id);
	const [, navigate] = useLocation();
	const save = useSaveItem();
	const del = useDeleteItem();
	const setWear = useSetWear();
	const { day, today } = useTodayWear();
	const toast = useToast();
	const [flipped, setFlipped] = useState(false);
	const [wiggle, setWiggle] = useState(false);
	const [busy, setBusy] = useState("");
	const backInput = useRef<HTMLInputElement>(null);

	const pairs = useMemo(() => (item && items ? pairingItems(items, item.category, item.colors, item.pattern).slice(0, 12) : []), [item, items]);
	const inOutfits = (outfits ?? []).filter((o) => item && o.itemIds.includes(item.id));
	const map = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

	if (!items) return <div className="container page"><div className="spinner" /></div>;
	if (!item) {
		return (
			<div className="container page">
				<div className="empty">
					<div className="hand">Teil nicht gefunden</div>
					<Link href="/">Zurück zum Schrank</Link>
				</div>
			</div>
		);
	}

	const wornToday = !!day?.itemIds.includes(item.id);
	const cpw = item.price && item.wearCount ? item.price / item.wearCount : null;
	const age = daysBetween(item.createdAt.slice(0, 10), localDate());

	const toggleToday = () => {
		const ids = new Set(day?.itemIds ?? []);
		if (wornToday) ids.delete(item.id);
		else ids.add(item.id);
		setWear.mutate(
			{ date: today, itemIds: [...ids], outfitId: day?.outfitId },
			{
				onSuccess: () => toast(wornToday ? "Aus heute entfernt" : "Als heute getragen eingetragen", "ok"),
				onError: (e) => toast(errorText(e), "error"),
			},
		);
	};

	const tapImage = () => {
		if (item.imageBack) setFlipped((f) => !f);
		else {
			setWiggle(true);
			setTimeout(() => setWiggle(false), 650);
		}
	};

	const addBack = async (file: File | undefined) => {
		if (!file) return;
		setBusy("Rückseite wird freigestellt …");
		try {
			const p = await processImage(file, { removeBg: settings?.bgRemoval.enabled ?? true, quality: settings?.bgRemoval.quality ?? "best" });
			const [full, thumb] = await Promise.all([uploadImage(p.full), uploadImage(p.thumb)]);
			await save.mutateAsync({ id: item.id, data: { imageBack: full, thumbBack: thumb } });
			toast("Rückseite gespeichert – tippe aufs Bild zum Umdrehen", "ok");
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setBusy("");
		}
	};

	const cat = categoryDef(item.category);

	return (
		<div className="container page">
			<PageHead
				title={<span className="hand" style={{ fontSize: "2rem", fontWeight: 600 }}>{item.name || "Ohne Namen"}</span>}
				left={
					<button className="icon-btn" onClick={() => (history.length > 1 ? history.back() : navigate("/"))} aria-label="Zurück">
						<ArrowLeft size={18} />
					</button>
				}
				right={
					<>
						<button
							className={`icon-btn ${item.favorite ? "active" : ""}`}
							style={item.favorite ? { color: "#e5486b", background: "rgba(229,72,107,0.12)" } : undefined}
							aria-label="Favorit"
							onClick={() => save.mutate({ id: item.id, data: { favorite: !item.favorite } })}
						>
							<Heart size={18} fill={item.favorite ? "currentColor" : "none"} />
						</button>
						<Link href={`/teil/${item.id}/bearbeiten`} className="icon-btn" aria-label="Bearbeiten">
							<Pencil size={18} />
						</Link>
					</>
				}
			/>
			<div className="two-col">
				<div className="card" style={{ padding: 10 }}>
					<button className={`flip ${flipped ? "flipped" : ""} ${wiggle ? "wiggle" : ""}`} onClick={tapImage} aria-label={item.imageBack ? "Umdrehen" : "Bild"}>
						<div className="flip-inner">
							<div className="flip-face">
								<ItemImage item={item} size="full" />
							</div>
							{item.imageBack && (
								<div className="flip-face back">
									<ItemImage item={item} size="full" side="back" />
								</div>
							)}
						</div>
					</button>
					<div className="row" style={{ justifyContent: "center", marginTop: 6 }}>
						{item.imageBack ? (
							<span className="small faint">Tippen zum Umdrehen ({flipped ? "Rückseite" : "Vorderseite"})</span>
						) : (
							<button className="btn soft small" onClick={() => backInput.current?.click()} disabled={!!busy}>
								<Camera size={15} /> {busy || "Rückseite hinzufügen"}
							</button>
						)}
						<input ref={backInput} type="file" accept="image/*" hidden onChange={(e) => void addBack(e.target.files?.[0])} />
					</div>
				</div>

				<div className="stack">
					<div className="stat-row">
						<div className="stat">
							<b>{item.wearCount}×</b>
							<span>getragen</span>
						</div>
						<div className="stat">
							<b style={{ fontSize: "1rem", lineHeight: "1.95rem" }}>{relativeDays(item.lastWorn)}</b>
							<span>zuletzt</span>
						</div>
						<div className="stat">
							<b style={{ fontSize: cpw ? "1.05rem" : undefined, lineHeight: "1.95rem" }}>{cpw ? money(cpw, settings?.currency) : "–"}</b>
							<span>pro Tragen</span>
						</div>
					</div>

					<div className="row wrap">
						<button className={`btn ${wornToday ? "soft" : "primary"}`} onClick={toggleToday} disabled={setWear.isPending}>
							<Check size={17} /> {wornToday ? "Heute getragen ✓" : "Heute getragen"}
						</button>
						<Link href={`/outfits/neu?mit=${item.id}`} className="btn">
							<Sparkles size={17} /> Outfit bauen
						</Link>
					</div>

					<div className="card">
						<dl className="kv">
							<dt>Kategorie</dt>
							<dd>
								{cat.singular}
								{item.subcategory ? ` · ${item.subcategory}` : ""}
							</dd>
							{item.colors.length > 0 && (
								<>
									<dt>Farben</dt>
									<dd className="row wrap" style={{ gap: 8 }}>
										{item.colors.map((c) => (
											<span key={c} className="row" style={{ gap: 5 }}>
												<span className="dot" style={swatchStyle(colorDef(c)?.hex ?? "#ccc")} />
												{colorDef(c)?.label ?? c}
											</span>
										))}
									</dd>
								</>
							)}
							{item.material && (
								<>
									<dt>Material</dt>
									<dd>{item.material}</dd>
								</>
							)}
							{item.pattern && (
								<>
									<dt>Muster</dt>
									<dd style={{ textTransform: "capitalize" }}>{item.pattern}</dd>
								</>
							)}
							{item.fit && (
								<>
									<dt>Passform</dt>
									<dd>{item.fit}</dd>
								</>
							)}
							<dt>Wärme</dt>
							<dd className="row">
								<Meter value={item.warmth} /> <span className="small muted">{WARMTH_LABELS[item.warmth]}</span>
							</dd>
							<dt>Stil</dt>
							<dd className="row">
								<Meter value={item.formality} /> <span className="small muted">{FORMALITY_LABELS[item.formality]}</span>
							</dd>
							{item.seasons.length > 0 && (
								<>
									<dt>Saison</dt>
									<dd>{item.seasons.map((s) => SEASONS.find((x) => x.key === s)?.label ?? s).join(", ")}</dd>
								</>
							)}
							{item.styleTags.length > 0 && (
								<>
									<dt>Tags</dt>
									<dd className="chips" style={{ gap: 6 }}>
										{item.styleTags.map((t) => (
											<span key={t} className="badge">
												{t}
											</span>
										))}
										{item.waterproof && <span className="badge ok">wasserdicht</span>}
									</dd>
								</>
							)}
							{item.brand && (
								<>
									<dt>Marke</dt>
									<dd>{item.brand}</dd>
								</>
							)}
							{item.size && (
								<>
									<dt>Größe</dt>
									<dd>{item.size}</dd>
								</>
							)}
							{item.price !== null && (
								<>
									<dt>Preis</dt>
									<dd>{money(item.price, settings?.currency)}</dd>
								</>
							)}
							<dt>Im Schrank</dt>
							<dd>{age <= 0 ? "seit heute" : `seit ${age} Tagen`}</dd>
						</dl>
						{item.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{item.notes}</p>}
					</div>
				</div>
			</div>

			{pairs.length > 0 && (
				<section>
					<div className="section-title">
						<h2>Passt gut zu</h2>
					</div>
					<div className="thumb-strip">
						{pairs.map((p: Item) => (
							<Link key={p.id} href={`/teil/${p.id}`} className="thumb" title={p.name}>
								<ItemImage item={p} />
							</Link>
						))}
					</div>
				</section>
			)}

			{inOutfits.length > 0 && (
				<section>
					<div className="section-title">
						<h2>In deinen Outfits</h2>
					</div>
					<div className="grid grid-items">
						{inOutfits.map((o) => (
							<Link key={o.id} href={`/outfits/${o.id}`} className="tile">
								<OutfitCollage items={o.itemIds.map((x) => map.get(x)).filter((x): x is Item => !!x)} />
								<div className="t-name">{o.name || "Outfit"}</div>
							</Link>
						))}
					</div>
				</section>
			)}

			<div className="row wrap" style={{ marginTop: 8 }}>
				<button
					className="btn"
					onClick={() =>
						save.mutate(
							{ id: item.id, data: { status: item.status === "archived" ? "active" : "archived" } },
							{ onSuccess: () => toast(item.status === "archived" ? "Zurück im Schrank" : "Archiviert", "ok") },
						)
					}
				>
					{item.status === "archived" ? <ArchiveRestore size={17} /> : <Archive size={17} />}
					{item.status === "archived" ? "Wiederherstellen" : "Archivieren"}
				</button>
				<button
					className="btn danger"
					onClick={() => {
						if (!confirm(`„${item.name || "Teil"}“ endgültig löschen?`)) return;
						del.mutate(item.id, {
							onSuccess: () => {
								toast("Gelöscht", "ok");
								navigate("/");
							},
							onError: (e) => toast(errorText(e), "error"),
						});
					}}
				>
					<Trash2 size={17} /> Löschen
				</button>
			</div>
		</div>
	);
}
