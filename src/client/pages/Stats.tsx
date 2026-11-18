import { Archive, ArchiveRestore } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { categoryDef, colorDef } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { swatchStyle } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { PageHead } from "../components/Layout.tsx";
import { useToast } from "../components/Toast.tsx";
import { money } from "../lib/format.ts";
import { useItemMap, useItems, useSaveItem, useSettings, useStats } from "../queries.ts";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function ItemRow({ item, right }: { item: Item; right: ReactNode }) {
	return (
		<Link href={`/teil/${item.id}`} className="list-row" style={{ color: "var(--text)" }}>
			<span className="thumb" style={{ width: 48, height: 48 }}>
				<ItemImage item={item} />
			</span>
			<span className="grow ellipsis" style={{ fontWeight: 700 }}>
				{item.name || "Ohne Namen"}
			</span>
			{right}
		</Link>
	);
}

export function StatsPage() {
	const { data: stats } = useStats();
	const { data: items } = useItems();
	const { data: settings } = useSettings();
	const map = useItemMap();
	const save = useSaveItem();
	const toast = useToast();
	const archived = (items ?? []).filter((i) => i.status === "archived");
	if (!stats) return <div className="container page"><div className="spinner" /></div>;
	const maxCat = Math.max(1, ...stats.byCategory.map((c) => c.count));
	const maxWd = Math.max(1, ...stats.wearsByWeekday);
	const cur = settings?.currency ?? "EUR";

	return (
		<div className="container page">
			<PageHead title="Statistik" />
			<div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
				<div className="stat">
					<b>{stats.totalItems}</b>
					<span>Teile im Schrank</span>
				</div>
				<div className="stat">
					<b>{money(stats.totalValue, cur)}</b>
					<span>Gesamtwert</span>
				</div>
				<div className="stat">
					<b>{stats.wornThisMonthPct}%</b>
					<span>in 30 Tagen getragen</span>
				</div>
				<div className="stat">
					<b>{stats.totalWears}</b>
					<span>Trage-Einträge</span>
				</div>
			</div>

			<div className="two-col">
				<section className="card">
					<div className="section-title">
						<h2>Lieblinge</h2>
						<span className="small faint">am häufigsten getragen</span>
					</div>
					{stats.mostWorn.length === 0 && <div className="small muted">Tipp im Schrank bei „Heute“ auf „Anziehen“ oder bei einem Teil auf „Heute getragen“ – dann siehst du hier deine Lieblinge.</div>}
					{stats.mostWorn.map((m) => {
						const it = map.get(m.id);
						return it ? <ItemRow key={m.id} item={it} right={<span className="badge">{m.count}×</span>} /> : null;
					})}
				</section>

				<section className="card">
					<div className="section-title">
						<h2>Ladenhüter</h2>
						<span className="small faint">aussortieren?</span>
					</div>
					{stats.neglected.length === 0 && <div className="small muted">Alles im Einsatz – nichts liegt länger als 30 Tage herum. 👏</div>}
					{stats.neglected.map((n) => {
						const it = map.get(n.id);
						if (!it) return null;
						return (
							<ItemRow
								key={n.id}
								item={it}
								right={
									<span className="row" style={{ gap: 6 }}>
										<span className="tiny muted">{n.never ? `nie (seit ${n.days} T)` : `${n.days} T`}</span>
										<button
											className="icon-btn"
											style={{ width: 34, height: 34 }}
											aria-label="Archivieren"
											title="Archivieren"
											onClick={(e) => {
												e.preventDefault();
												save.mutate({ id: it.id, data: { status: "archived" } }, { onSuccess: () => toast("Archiviert", "ok") });
											}}
										>
											<Archive size={15} />
										</button>
									</span>
								}
							/>
						);
					})}
				</section>
			</div>

			<div className="two-col">
				<section className="card">
					<div className="section-title">
						<h2>Kategorien</h2>
					</div>
					<div className="bar-list">
						{stats.byCategory.map((c) => (
							<div key={c.key} className="bar-item">
								<span className="ellipsis">{categoryDef(c.key).label}</span>
								<span className="bar">
									<i style={{ width: `${(c.count / maxCat) * 100}%` }} />
								</span>
								<b>{c.count}</b>
							</div>
						))}
					</div>
				</section>
				<section className="card">
					<div className="section-title">
						<h2>Farben</h2>
					</div>
					<div className="chips">
						{stats.byColor.map((c) => (
							<span key={c.key} className="chip static">
								<span className="dot" style={swatchStyle(colorDef(c.key)?.hex ?? "#ccc")} />
								{colorDef(c.key)?.label ?? c.key} · {c.count}
							</span>
						))}
					</div>
					<div className="section-title" style={{ marginTop: 18 }}>
						<h2>Wochentage</h2>
					</div>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, alignItems: "end", height: 90 }}>
						{stats.wearsByWeekday.map((n, i) => (
							<div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
								<div style={{ width: "70%", height: `${(n / maxWd) * 70}%`, minHeight: 3, background: "var(--accent)", borderRadius: 6 }} title={`${n}`} />
								<span className="tiny muted">{WD[i]}</span>
							</div>
						))}
					</div>
				</section>
			</div>

			{stats.bestCostPerWear.length > 0 && (
				<section className="card">
					<div className="section-title">
						<h2>Beste Kosten pro Tragen</h2>
					</div>
					{stats.bestCostPerWear.map((c) => {
						const it = map.get(c.id);
						return it ? <ItemRow key={c.id} item={it} right={<span className="badge ok">{money(c.cpw, cur)}</span>} /> : null;
					})}
				</section>
			)}

			{archived.length > 0 && (
				<section className="card">
					<div className="section-title">
						<h2>Archiv</h2>
						<span className="small faint">{archived.length}</span>
					</div>
					{archived.map((it) => (
						<ItemRow
							key={it.id}
							item={it}
							right={
								<button
									className="icon-btn"
									style={{ width: 34, height: 34 }}
									aria-label="Wiederherstellen"
									onClick={(e) => {
										e.preventDefault();
										save.mutate({ id: it.id, data: { status: "active" } }, { onSuccess: () => toast("Zurück im Schrank", "ok") });
									}}
								>
									<ArchiveRestore size={15} />
								</button>
							}
						/>
					))}
				</section>
			)}
		</div>
	);
}
