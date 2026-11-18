import { Bookmark, Check, Dices, Plus, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import type { Item, OutfitSuggestion } from "../../shared/types.ts";
import { AiWait } from "../components/AiWait.tsx";
import { PageHead } from "../components/Layout.tsx";
import { OutfitCollage } from "../components/OutfitCollage.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { WeatherIcon } from "../components/WeatherIcon.tsx";
import { localDate } from "../lib/date.ts";
import { useItemMap, useItems, useOutfits, useSaveOutfit, useSetWear, useSettings, useSuggestions, useWeather } from "../queries.ts";

const OCCASIONS = ["Alltag", "Schule/Uni", "Büro", "Date", "Party", "Sport", "Gemütlich"];

export function Outfits() {
	const { data: outfits } = useOutfits();
	const { data: items } = useItems();
	const { data: settings } = useSettings();
	const { data: weather } = useWeather();
	const map = useItemMap();
	const [occasion, setOccasion] = useState("Alltag");
	const [seed, setSeed] = useState(localDate());
	const [aiSeed, setAiSeed] = useState(localDate());
	const [useAi, setUseAi] = useState(true);
	const aiOn = !!settings?.ai.areas.text;
	const occ = occasion === "Alltag" ? "" : occasion;
	// Rule-based ideas are instant; AI ideas load in parallel and appear when ready.
	const rules = useSuggestions(occ, false, seed);
	const ai = useSuggestions(occ, true, aiSeed, aiOn && useAi);
	const aiSince = useFetchStart(ai.isFetching);
	const aiList = ai.data?.source === "ai" && !ai.isFetching ? ai.data.suggestions : [];
	const aiError = !ai.isFetching ? (ai.data?.aiError ?? (ai.error ? errorText(ai.error) : undefined)) : undefined;
	const toItems = (ids: string[]) => ids.map((id) => map.get(id)).filter((x): x is Item => !!x);

	return (
		<div className="container page">
			<PageHead
				title="Outfits"
				right={
					<Link href="/outfits/neu" className="btn primary">
						<Plus size={18} /> Neu
					</Link>
				}
			/>

			<section className="card stack">
				<div className="row between wrap">
					<div className="row">
						<Wand2 size={20} color="var(--accent)" />
						<h2>Vorschläge für heute</h2>
					</div>
					{weather && (
						<span className="row small muted" style={{ gap: 6 }}>
							<WeatherIcon code={weather.code} isDay={weather.isDay} size={18} />
							{Math.round(weather.temp)}° · gefühlt {Math.round(weather.feelsLike)}°
						</span>
					)}
				</div>
				<div className="chips">
					{OCCASIONS.map((o) => (
						<button key={o} className={`chip ${occasion === o ? "on" : ""}`} onClick={() => setOccasion(o)}>
							{o}
						</button>
					))}
				</div>
				<div className="row wrap">
					<button className="btn small" onClick={() => setSeed(String(Date.now()))} disabled={rules.isFetching}>
						<Dices size={15} /> Neu würfeln
					</button>
					{aiOn && (
						<button className={`chip ${useAi ? "on" : ""}`} onClick={() => setUseAi(!useAi)}>
							<Sparkles size={14} /> KI-Ideen
						</button>
					)}
					{aiOn && useAi && !ai.isFetching && (
						<button className="btn small soft" onClick={() => setAiSeed(String(Date.now()))}>
							<Sparkles size={15} /> KI nochmal fragen
						</button>
					)}
				</div>
				{(items?.length ?? 0) < 2 && <div className="small muted">Füge ein paar Teile hinzu, dann gibt's hier Vorschläge.</div>}
				{aiOn && useAi && ai.isFetching && <AiWait since={aiSince} label="KI stellt Outfits zusammen" />}
				{aiOn && useAi && aiError && <div className="tiny muted">KI gerade nicht verfügbar: {aiError}</div>}
				{(aiList.length > 0 || rules.data) && (
					<div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
						{aiList.map((s, i) => (
							<SuggestionCard key={`ai-${aiSeed}-${i}`} s={s} items={toItems(s.itemIds)} occasion={occasion} />
						))}
						{rules.data?.suggestions.map((s, i) => (
							<SuggestionCard key={`r-${seed}-${i}`} s={s} items={toItems(s.itemIds)} occasion={occasion} />
						))}
						{rules.data?.suggestions.length === 0 && aiList.length === 0 && (
							<div className="small muted">Keine passende Kombination gefunden – es fehlen vielleicht Oberteile, Hosen oder Schuhe.</div>
						)}
					</div>
				)}
				{!rules.data && rules.isFetching && (
					<div className="row muted small">
						<div className="spinner" /> Stelle Outfits zusammen …
					</div>
				)}
			</section>

			<section>
				<div className="section-title">
					<h2>Gespeicherte Outfits</h2>
					<span className="small faint">{outfits?.length ?? 0}</span>
				</div>
				{outfits && outfits.length === 0 && (
					<div className="card empty">
						<div className="hand">Noch keine Outfits</div>
						<p className="small">Speichere einen Vorschlag oder stelle eins im Baukasten zusammen.</p>
					</div>
				)}
				<div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
					{outfits?.map((o) => (
						<Link key={o.id} href={`/outfits/${o.id}`} className="tile">
							<OutfitCollage items={toItems(o.itemIds)} />
							<div className="t-name">
								{o.favorite ? "★ " : ""}
								{o.name || "Outfit"}
							</div>
							{o.occasion && <div className="tiny muted">{o.occasion}</div>}
						</Link>
					))}
				</div>
			</section>
		</div>
	);
}

function SuggestionCard({ s, items, occasion }: { s: OutfitSuggestion; items: Item[]; occasion: string }) {
	const saveOutfit = useSaveOutfit();
	const setWear = useSetWear();
	const toast = useToast();
	const [, navigate] = useLocation();
	const [saved, setSaved] = useState(false);
	return (
		<div className="card flat stack" style={{ padding: 12, gap: 10 }}>
			<OutfitCollage items={items} />
			<div className="hand" style={{ fontSize: "1.45rem", lineHeight: 1.1 }}>
				{s.name}
			</div>
			<span className={`badge ${s.source === "ai" ? "" : "soft"}`} style={{ alignSelf: "flex-start" }}>
				{s.source === "ai" ? "KI-Idee" : "nach Wetter"}
			</span>
			{s.reason && <div className="small muted">{s.reason}</div>}
			<div className="row wrap" style={{ gap: 6 }}>
				<button
					className="btn primary small"
					disabled={setWear.isPending}
					onClick={() =>
						setWear.mutate(
							{ date: localDate(), itemIds: s.itemIds },
							{ onSuccess: () => toast("Für heute eingetragen", "ok"), onError: (e) => toast(errorText(e), "error") },
						)
					}
				>
					<Check size={15} /> Anziehen
				</button>
				<button
					className="btn small"
					disabled={saved || saveOutfit.isPending}
					onClick={() =>
						saveOutfit.mutate(
							{ data: { name: s.name, itemIds: s.itemIds, occasion: occasion === "Alltag" ? "" : occasion } },
							{
								onSuccess: () => {
									setSaved(true);
									toast("Outfit gespeichert", "ok");
								},
								onError: (e) => toast(errorText(e), "error"),
							},
						)
					}
				>
					<Bookmark size={15} /> {saved ? "Gespeichert" : "Merken"}
				</button>
				<button className="btn small ghost" onClick={() => navigate(`/outfits/neu?ids=${s.itemIds.join(",")}`)}>
					Anpassen
				</button>
			</div>
		</div>
	);
}

/** Remembers when a fetch started (for the AI wait counter). */
function useFetchStart(fetching: boolean): number | null {
	const [since, setSince] = useState<number | null>(null);
	useEffect(() => setSince(fetching ? Date.now() : null), [fetching]);
	return since;
}
