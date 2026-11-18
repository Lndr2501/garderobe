import { Check, Grid3x3, Heart, Leaf, Plus, Rows3, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { CATEGORIES, COLORS, currentSeason, SEASONS } from "../../shared/taxonomy.ts";
import type { Item, WeatherNow } from "../../shared/types.ts";
import { swatchStyle } from "../components/Inputs.tsx";
import { ItemTile } from "../components/ItemTile.tsx";
import { TopNav } from "../components/Layout.tsx";
import { Mascot } from "../components/Mascot.tsx";
import { OutfitCollage } from "../components/OutfitCollage.tsx";
import { Rack } from "../components/Rack.tsx";
import { RecognitionStatus } from "../components/RecognitionStatus.tsx";
import { isRecognizing } from "../lib/recognize.ts";
import { SkyBanner } from "../components/SkyBanner.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { WeatherIcon } from "../components/WeatherIcon.tsx";
import { formatWeekday, greeting, localDate } from "../lib/date.ts";
import { plural } from "../lib/format.ts";
import { useLocal } from "../lib/useLocal.ts";
import { useItemMap, useItems, useSetWear, useSettings, useSuggestions, useTodayWear, useWeather } from "../queries.ts";

function Clock() {
	const [now, setNow] = useState(new Date());
	useEffect(() => {
		const t = setInterval(() => setNow(new Date()), 20_000);
		return () => clearInterval(t);
	}, []);
	return (
		<div className="glass clock-card">
			<div className="tiny" style={{ fontWeight: 700, opacity: 0.8 }}>
				{now.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}
			</div>
			<div className="clock">{now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</div>
		</div>
	);
}

function WeatherCard({ weather, failed }: { weather: WeatherNow | undefined; failed: boolean }) {
	if (!weather) {
		return (
			<div className="glass weather-card weather-mini" style={{ minWidth: 120, minHeight: 48 }}>
				{failed ? (
					<span className="tiny" style={{ opacity: 0.8 }}>
						Wetter gerade nicht erreichbar
					</span>
				) : (
					<>
						<span className="spinner" /> <span className="tiny" style={{ opacity: 0.8 }}>Wetter …</span>
					</>
				)}
			</div>
		);
	}
	return (
		<div className="glass weather-card">
			<div className="weather-mini">
				<WeatherIcon code={weather.code} isDay={weather.isDay} size={30} />
				<div>
					<div className="temp">{Math.round(weather.temp)}°</div>
					<div className="tiny" style={{ opacity: 0.8 }}>
						{weather.description}
					</div>
				</div>
			</div>
			<div className="forecast">
				{weather.daily?.slice(1, 5).map((d) => (
					<div key={d.date}>
						<div style={{ fontWeight: 800 }}>{formatWeekday(d.date)}</div>
						<WeatherIcon code={d.code} size={14} />
						<div>{Math.round(d.tMax)}°</div>
					</div>
				))}
			</div>
		</div>
	);
}

function bubbleText(name: string, weather: WeatherNow | undefined, items: Item[], suggestion: Item[]): string {
	if (items.length === 0) return "Fotografiere dein erstes Kleidungsstück – tippe unten rechts auf +.";
	const parts: string[] = [];
	if (weather) parts.push(`Draußen sind es ${Math.round(weather.temp)} °C, ${weather.description.toLowerCase()}.`);
	const outer = suggestion.find((i) => i.category === "outerwear");
	const top = suggestion.find((i) => i.category === "top" || i.category === "dress");
	if (outer) parts.push(`Nimm ${outer.name || "eine Jacke"} – hält dich warm.`);
	else if (top) parts.push(`${top.name || "Dein Oberteil"} passt heute super.`);
	if (weather && weather.precipProb >= 50) parts.push("Regenschirm nicht vergessen ☂︎");
	return parts.join(" ") || `Du hast ${plural(items.length, "Teil", "Teile")} im Schrank.`;
}

function TodayCard({ suggestionIds, reason, name }: { suggestionIds: string[]; reason: string; name: string }) {
	const map = useItemMap();
	const { day, today } = useTodayWear();
	const setWear = useSetWear();
	const toast = useToast();
	const [, navigate] = useLocation();
	const worn = day?.itemIds.map((id) => map.get(id)).filter((x): x is Item => !!x) ?? [];
	const sugg = suggestionIds.map((id) => map.get(id)).filter((x): x is Item => !!x);
	const showWorn = worn.length > 0;
	const list = showWorn ? worn : sugg;
	if (list.length === 0) return null;
	return (
		<div className="card" style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }}>
			<OutfitCollage items={list} />
			<div className="stack" style={{ gap: 8 }}>
				<span className="badge" style={{ alignSelf: "flex-start" }}>
					{showWorn ? "Heute getragen" : "Vorschlag für heute"}
				</span>
				<div className="hand" style={{ fontSize: "1.6rem", lineHeight: 1.1 }}>
					{showWorn ? list.map((i) => i.name).join(", ") : name}
				</div>
				{!showWorn && reason && <div className="small muted">{reason}</div>}
				<div className="row wrap">
					{!showWorn && (
						<button
							className="btn primary small"
							disabled={setWear.isPending}
							onClick={() =>
								setWear.mutate(
									{ date: today, itemIds: suggestionIds },
									{ onSuccess: () => toast("Eingetragen – viel Spaß heute!", "ok"), onError: (e) => toast(errorText(e), "error") },
								)
							}
						>
							<Check size={16} /> Anziehen
						</button>
					)}
					<button className="btn small" onClick={() => navigate("/outfits")}>
						{showWorn ? "Ändern" : "Mehr Ideen"}
					</button>
				</div>
			</div>
		</div>
	);
}

export function Wardrobe() {
	const { data: allItems, isPending } = useItems();
	const { data: settings } = useSettings();
	const { data: weather, isError: weatherFailed } = useWeather();
	const [, navigate] = useLocation();
	const [view, setView] = useLocal<"rack" | "grid">("gd-view", "rack");
	const [q, setQ] = useState("");
	const [season, setSeason] = useState(false);
	const [fav, setFav] = useState(false);
	const search = useSearch();
	const [review, setReview] = useState(search.includes("pruefen"));
	const [color, setColor] = useState<string | null>(null);
	const items = useMemo(() => (allItems ?? []).filter((i) => i.status === "active"), [allItems]);
	// Pieces the AI is still looking at wait in the status strip instead of "Sonstiges".
	const shown = useMemo(() => items.filter((i) => !isRecognizing(i)), [items]);
	const suggest = useSuggestions("", false, localDate());
	const first = suggest.data?.suggestions[0];
	const map = useItemMap();
	const suggestionItems = (first?.itemIds ?? []).map((id) => map.get(id)).filter((x): x is Item => !!x);
	const nowSeason = currentSeason();

	const filtered = useMemo(() => {
		const query = q.trim().toLowerCase();
		return shown.filter(
			(i) =>
				(!query || `${i.name} ${i.subcategory} ${i.brand} ${i.material} ${i.colors.join(" ")} ${i.styleTags.join(" ")}`.toLowerCase().includes(query)) &&
				(!season || i.seasons.length === 0 || i.seasons.includes(nowSeason)) &&
				(!fav || i.favorite) &&
				(!review || i.needsReview) &&
				(!color || i.colors.includes(color)),
		);
	}, [shown, q, season, fav, color, review, nowSeason]);

	const usedColors = COLORS.filter((c) => items.some((i) => i.colors[0] === c.key));
	const reviewCount = items.filter((i) => i.needsReview).length;
	const name = settings?.name;

	return (
		<>
			<SkyBanner>
				<div className="sky-inner">
					<div className="greet">
						<Mascot />
						<div className="bubble">
							<b>
								{greeting()}
								{name ? `, ${name}` : ""}!
							</b>
							{bubbleText(name ?? "", weather, items, suggestionItems)}
						</div>
					</div>
					<div className="sky-cards">
						<Clock />
						<WeatherCard weather={weather} failed={weatherFailed} />
					</div>
				</div>
			</SkyBanner>
			<TopNav />
			<div className="container page">
				<div className="stack" style={{ gap: 10 }}>
					<div className="row">
						<div style={{ position: "relative", flex: 1 }}>
							<Search size={18} style={{ position: "absolute", left: 14, top: 14, color: "var(--faint)" }} />
							<input className="input" style={{ paddingLeft: 40 }} placeholder="Schrank durchsuchen …" value={q} onChange={(e) => setQ(e.target.value)} />
						</div>
						<button className={`icon-btn ${view === "rack" ? "active" : ""}`} onClick={() => setView("rack")} aria-label="Kleiderstange" title="Kleiderstange">
							<Rows3 size={18} />
						</button>
						<button className={`icon-btn ${view === "grid" ? "active" : ""}`} onClick={() => setView("grid")} aria-label="Raster" title="Raster">
							<Grid3x3 size={18} />
						</button>
					</div>
					<div className="chips" style={{ alignItems: "center" }}>
						<button className={`chip ${season ? "on" : ""}`} onClick={() => setSeason(!season)}>
							<Leaf size={14} /> {SEASONS.find((s) => s.key === nowSeason)?.label}
						</button>
						<button className={`chip ${fav ? "on" : ""}`} onClick={() => setFav(!fav)}>
							<Heart size={14} /> Favoriten
						</button>
						{reviewCount > 0 && (
							<button className={`chip ${review ? "on" : ""}`} onClick={() => setReview(!review)}>
								<Sparkles size={14} /> {reviewCount} prüfen
							</button>
						)}
						{usedColors.map((c) => (
							<button
								key={c.key}
								className={`swatch ${color === c.key ? "on" : ""}`}
								style={{ ...swatchStyle(c.hex), width: 26, height: 26 }}
								title={c.label}
								aria-label={`Farbe ${c.label}`}
								onClick={() => setColor(color === c.key ? null : c.key)}
							/>
						))}
					</div>
				</div>

				<RecognitionStatus items={items} />

				{isPending && !allItems && (
					<div className="row" style={{ justifyContent: "center", padding: 40 }}>
						<div className="spinner" />
					</div>
				)}

				{allItems && items.length === 0 && (
					<div className="card empty">
						<div className="hand">Dein Schrank ist noch leer</div>
						<p>Fotografiere deine Kleidung – der Hintergrund wird automatisch entfernt und das Teil hängt danach an deiner virtuellen Stange.</p>
						<Link href="/neu" className="btn primary">
							<Plus size={18} /> Erstes Teil hinzufügen
						</Link>
					</div>
				)}

				{shown.length > 0 && filtered.length === 0 && <div className="empty">Nichts gefunden.</div>}

				{view === "rack" &&
					CATEGORIES.map((cat) => {
						const list = filtered.filter((i) => i.category === cat.key);
						if (list.length === 0) return null;
						return (
							<section key={cat.key} className="closet">
								<div className="section-title">
									<h2>{cat.label}</h2>
									<span className="small faint">{list.length}</span>
								</div>
								<Rack items={list} display={cat.display} onOpen={(i) => navigate(`/teil/${i.id}`)} label={cat.label} />
							</section>
						);
					})}

				{first && <TodayCard suggestionIds={first.itemIds} reason={first.reason} name={first.name} />}

				{view === "grid" &&
					CATEGORIES.map((cat) => {
						const list = filtered.filter((i) => i.category === cat.key);
						if (list.length === 0) return null;
						return (
							<section key={cat.key}>
								<div className="section-title">
									<h2>{cat.label}</h2>
									<span className="small faint">{list.length}</span>
								</div>
								<div className="grid grid-items">
									{list.map((i) => (
										<ItemTile key={i.id} item={i} onClick={() => navigate(`/teil/${i.id}`)} />
									))}
								</div>
							</section>
						);
					})}
			</div>
			<Link href="/neu" className="fab" aria-label="Teil hinzufügen">
				<Plus size={28} />
			</Link>
		</>
	);
}
