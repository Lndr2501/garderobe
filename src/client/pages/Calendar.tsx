import { ChevronLeft, ChevronRight, Flame, Plus, Shirt, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Item, WearDay } from "../../shared/types.ts";
import { imgUrl } from "../api.ts";
import { ItemImage } from "../components/ItemImage.tsx";
import { ItemPicker } from "../components/ItemPicker.tsx";
import { PageHead } from "../components/Layout.tsx";
import { OutfitCollage } from "../components/OutfitCollage.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { formatLong, formatMonth, localDate } from "../lib/date.ts";
import { useItemMap, useOutfits, useSetWear, useStats, useWears } from "../queries.ts";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function CalendarPage() {
	const [month, setMonth] = useState(() => {
		const d = new Date();
		return new Date(d.getFullYear(), d.getMonth(), 1);
	});
	const [openDay, setOpenDay] = useState<string | null>(null);
	const first = new Date(month);
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(first);
	start.setDate(1 - offset);
	const days = Array.from({ length: 42 }, (_, i) => {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		return d;
	});
	const from = localDate(days[0]!);
	const to = localDate(days[41]!);
	const { data: wears } = useWears(from, to);
	const { data: stats } = useStats();
	const map = useItemMap();
	const byDate = useMemo(() => new Map((wears ?? []).map((w) => [w.date, w])), [wears]);
	const today = localDate();
	const todayWear = byDate.get(today);
	const toItems = (w?: WearDay) => (w?.itemIds ?? []).map((id) => map.get(id)).filter((x): x is Item => !!x);
	const loggedThisMonth = (wears ?? []).filter((w) => w.date.slice(0, 7) === localDate(month).slice(0, 7)).length;

	return (
		<div className="container page">
			<PageHead title="Kalender" />
			<div className="two-col">
				<div className="stack">
					<div className="card" style={{ display: "grid", gridTemplateColumns: todayWear ? "110px 1fr" : "1fr", gap: 14, alignItems: "center" }}>
						{todayWear && <OutfitCollage items={toItems(todayWear)} />}
						<div className="stack" style={{ gap: 8 }}>
							<span className="badge">Heute · {formatLong(today)}</span>
							<div className="hand" style={{ fontSize: "1.5rem", lineHeight: 1.15 }}>
								{todayWear ? toItems(todayWear).map((i) => i.name).join(", ") : "Was trägst du heute?"}
							</div>
							<button className="btn small primary" style={{ alignSelf: "flex-start" }} onClick={() => setOpenDay(today)}>
								{todayWear ? "Ändern" : "Eintragen"}
							</button>
						</div>
					</div>
					<div className="stat-row">
						<div className="stat">
							<b>
								<Flame size={18} style={{ verticalAlign: "-2px" }} /> {stats?.streak ?? 0}
							</b>
							<span>Tage in Folge</span>
						</div>
						<div className="stat">
							<b>{loggedThisMonth}</b>
							<span>Tage im Monat</span>
						</div>
						<div className="stat">
							<b>{stats?.wornThisMonthPct ?? 0}%</b>
							<span>Schrank genutzt (30 T)</span>
						</div>
					</div>
				</div>

				<div className="card">
					<div className="row between" style={{ marginBottom: 10 }}>
						<button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Vorheriger Monat">
							<ChevronLeft size={18} />
						</button>
						<h2 style={{ textTransform: "capitalize" }}>{formatMonth(month)}</h2>
						<button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Nächster Monat">
							<ChevronRight size={18} />
						</button>
					</div>
					<div className="cal">
						{WD.map((w) => (
							<div key={w} className="wd">
								{w}
							</div>
						))}
						{days.map((d) => {
							const ds = localDate(d);
							const w = byDate.get(ds);
							const its = toItems(w).slice(0, 4);
							return (
								<button
									key={ds}
									className={`cal-day ${d.getMonth() !== month.getMonth() ? "out" : ""} ${ds === today ? "today" : ""}`}
									onClick={() => ds <= today && setOpenDay(ds)}
									disabled={ds > today}
									aria-label={`${formatLong(ds)}${its.length ? `, ${its.length} Teile` : ""}`}
								>
									<span>{d.getDate()}</span>
									{its.length > 0 && (
										<div className="mini">
											{its.map((i) => (
												<img key={i.id} src={imgUrl(i.thumbFront ?? i.imageFront)} alt="" loading="lazy" />
											))}
										</div>
									)}
								</button>
							);
						})}
					</div>
				</div>
			</div>
			{openDay && <DaySheet date={openDay} wear={byDate.get(openDay)} onClose={() => setOpenDay(null)} />}
		</div>
	);
}

function DaySheet({ date, wear, onClose }: { date: string; wear?: WearDay; onClose: () => void }) {
	const map = useItemMap();
	const { data: outfits } = useOutfits();
	const setWear = useSetWear();
	const toast = useToast();
	const [ids, setIds] = useState<string[]>(wear?.itemIds ?? []);
	const [outfitId, setOutfitId] = useState<string | null>(wear?.outfitId ?? null);
	const [picker, setPicker] = useState(false);
	const items = ids.map((id) => map.get(id)).filter((x): x is Item => !!x);

	const save = () =>
		setWear.mutate(
			{ date, itemIds: ids, outfitId },
			{
				onSuccess: () => {
					toast(ids.length ? "Gespeichert" : "Eintrag entfernt", "ok");
					onClose();
				},
				onError: (e) => toast(errorText(e), "error"),
			},
		);

	return (
		<Sheet title={formatLong(date)} onClose={onClose}>
			<div className="stack">
				{items.length > 0 ? (
					<div className="grid grid-items">
						{items.map((i) => (
							<div key={i.id} className="tile">
								<div className="img">
									<ItemImage item={i} />
								</div>
								<div className="t-name">{i.name}</div>
								<button
									className="icon-btn"
									style={{ position: "absolute", top: 6, right: 6, width: 30, height: 30 }}
									aria-label="Entfernen"
									onClick={() => setIds(ids.filter((x) => x !== i.id))}
								>
									<X size={14} />
								</button>
							</div>
						))}
					</div>
				) : (
					<div className="empty small">
						<Shirt size={22} />
						<div>Noch nichts eingetragen.</div>
					</div>
				)}
				<button className="btn" onClick={() => setPicker(true)}>
					<Plus size={16} /> Teile auswählen
				</button>
				{outfits && outfits.length > 0 && (
					<div className="field">
						<span>
							<Sparkles size={13} /> Oder ein gespeichertes Outfit
						</span>
						<div className="thumb-strip">
							{outfits.map((o) => (
								<button
									key={o.id}
									className="tile"
									style={{ width: 120, flex: "0 0 auto", outline: outfitId === o.id ? "3px solid var(--accent)" : undefined }}
									onClick={() => {
										setOutfitId(o.id);
										setIds(o.itemIds.filter((x) => map.has(x)));
									}}
								>
									<OutfitCollage items={o.itemIds.map((x) => map.get(x)).filter((x): x is Item => !!x)} />
									<div className="t-name">{o.name}</div>
								</button>
							))}
						</div>
					</div>
				)}
				<button className="btn primary block" onClick={save} disabled={setWear.isPending}>
					Speichern
				</button>
			</div>
			{picker && (
				<ItemPicker
					initial={ids}
					onClose={() => setPicker(false)}
					onDone={(sel) => {
						setIds(sel);
						setOutfitId(null);
						setPicker(false);
					}}
				/>
			)}
		</Sheet>
	);
}
