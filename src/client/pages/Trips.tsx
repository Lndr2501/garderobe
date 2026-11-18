import { ArrowLeft, Check, Luggage, MapPin, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { CATEGORIES } from "../../shared/taxonomy.ts";
import type { Item, Trip, TripEntry } from "../../shared/types.ts";
import { api } from "../api.ts";
import { ChipSelect } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { ItemPicker } from "../components/ItemPicker.tsx";
import { PageHead } from "../components/Layout.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { WeatherIcon } from "../components/WeatherIcon.tsx";
import { addDays, daysBetween, formatShort, formatWeekday, localDate } from "../lib/date.ts";
import { fetchTripWeather, searchPlaces, type Place } from "../lib/weather.ts";
import { keys, useItemMap, useSaveTrip, useSettings, useTrips } from "../queries.ts";
import { useQueryClient } from "@tanstack/react-query";

const ACTIVITIES = [
	{ key: "sightseeing", label: "Sightseeing" },
	{ key: "strand", label: "Strand" },
	{ key: "wandern", label: "Wandern" },
	{ key: "sport", label: "Sport" },
	{ key: "business", label: "Business" },
	{ key: "party", label: "Party" },
	{ key: "schnee", label: "Schnee" },
	{ key: "familie", label: "Familie" },
];

export function Trips() {
	const { data: trips } = useTrips();
	const [open, setOpen] = useState(false);
	return (
		<div className="container page">
			<PageHead
				title="Packlisten"
				right={
					<button className="btn primary" onClick={() => setOpen(true)}>
						<Plus size={18} /> Reise
					</button>
				}
			/>
			{trips && trips.length === 0 && (
				<div className="card empty">
					<Luggage size={28} />
					<div className="hand">Wohin geht's?</div>
					<p className="small">Trag eine Reise ein – mit Wettervorhersage und Aktivitäten stellt die App eine Packliste aus deinem Schrank zusammen.</p>
				</div>
			)}
			<div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
				{trips?.map((t) => {
					const clothes = t.entries.length;
					const done = t.entries.filter((e) => e.checked).length;
					return (
						<Link key={t.id} href={`/reisen/${t.id}`} className="card" style={{ color: "var(--text)" }}>
							<div className="row between">
								<b>{t.name}</b>
								<span className="badge">{clothes ? `${done}/${clothes}` : "leer"}</span>
							</div>
							<div className="small muted" style={{ marginTop: 4 }}>
								<MapPin size={13} style={{ verticalAlign: "-2px" }} /> {t.destination || "–"}
								{t.startDate && ` · ${formatShort(t.startDate)}${t.endDate ? ` – ${formatShort(t.endDate)}` : ""}`}
							</div>
							{clothes > 0 && (
								<div className="progress" style={{ marginTop: 10 }}>
									<i style={{ width: `${(done / clothes) * 100}%` }} />
								</div>
							)}
						</Link>
					);
				})}
			</div>
			{open && <NewTrip onClose={() => setOpen(false)} />}
		</div>
	);
}

function NewTrip({ onClose }: { onClose: () => void }) {
	const [q, setQ] = useState("");
	const [places, setPlaces] = useState<Place[]>([]);
	const [place, setPlace] = useState<Place | null>(null);
	const [start, setStart] = useState(addDays(localDate(), 7));
	const [end, setEnd] = useState(addDays(localDate(), 10));
	const [activities, setActivities] = useState<string[]>(["sightseeing"]);
	const [busy, setBusy] = useState(false);
	const save = useSaveTrip();
	const qc = useQueryClient();
	const toast = useToast();
	const [, navigate] = useLocation();

	useEffect(() => {
		if (place && q === place.name) return;
		const t = setTimeout(() => void searchPlaces(q).then(setPlaces).catch(() => setPlaces([])), 300);
		return () => clearTimeout(t);
	}, [q, place]);

	const create = async () => {
		if (!place && !q.trim()) return toast("Bitte ein Ziel eingeben", "error");
		setBusy(true);
		try {
			const weather = place ? await fetchTripWeather(place.lat, place.lon, start, end).catch(() => null) : null;
			const trip = await save.mutateAsync({
				data: {
					name: place?.name ?? q.trim(),
					destination: place ? `${place.name}${place.detail ? `, ${place.detail}` : ""}` : q.trim(),
					lat: place?.lat ?? null,
					lon: place?.lon ?? null,
					startDate: start,
					endDate: end < start ? start : end,
					activities,
					weather,
				},
			});
			await api(`/api/trips/${trip.id}/generate`, { method: "POST", body: {} });
			await qc.invalidateQueries({ queryKey: keys.trips });
			navigate(`/reisen/${trip.id}`);
		} catch (e) {
			toast(errorText(e), "error");
			setBusy(false);
		}
	};

	return (
		<Sheet title="Neue Reise" onClose={onClose}>
			<div className="stack">
				<label className="field">
					<span>Ziel</span>
					<input
						className="input"
						value={q}
						placeholder="Stadt, z.B. Barcelona"
						onChange={(e) => {
							setQ(e.target.value);
							setPlace(null);
						}}
						autoFocus
					/>
				</label>
				{!place && places.length > 0 && (
					<div className="card flat tight stack" style={{ gap: 0 }}>
						{places.map((p) => (
							<button
								key={`${p.lat},${p.lon}`}
								className="list-row"
								style={{ border: "none", background: "transparent", textAlign: "left" }}
								onClick={() => {
									setPlace(p);
									setQ(p.name);
									setPlaces([]);
								}}
							>
								<MapPin size={16} />
								<span className="grow">
									<b>{p.name}</b> <span className="small muted">{p.detail}</span>
								</span>
							</button>
						))}
					</div>
				)}
				<div className="grid grid-2">
					<label className="field">
						<span>Von</span>
						<input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
					</label>
					<label className="field">
						<span>Bis</span>
						<input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
					</label>
				</div>
				<div className="field">
					<span>Aktivitäten</span>
					<ChipSelect multi options={ACTIVITIES} value={activities} onChange={setActivities} />
				</div>
				<button className="btn primary block" onClick={() => void create()} disabled={busy}>
					{busy ? <span className="spinner" /> : <Sparkles size={17} />} {busy ? "Packliste wird erstellt …" : "Packliste erstellen"}
				</button>
			</div>
		</Sheet>
	);
}

export function TripDetail() {
	const { id } = useParams<{ id: string }>();
	const { data: trips } = useTrips();
	const trip = trips?.find((t) => t.id === id);
	const map = useItemMap();
	const save = useSaveTrip();
	const qc = useQueryClient();
	const toast = useToast();
	const { data: settings } = useSettings();
	const [, navigate] = useLocation();
	const [picker, setPicker] = useState(false);
	const [text, setText] = useState("");
	const [regen, setRegen] = useState(false);

	const groups = useMemo(() => {
		if (!trip) return [];
		const res: { label: string; entries: { e: TripEntry; idx: number; item?: Item }[] }[] = [];
		for (const cat of CATEGORIES) {
			const list = trip.entries
				.map((e, idx) => ({ e, idx, item: e.itemId ? map.get(e.itemId) : undefined }))
				.filter((x) => x.item && x.item.category === cat.key);
			if (list.length) res.push({ label: cat.label, entries: list });
		}
		const extras = trip.entries.map((e, idx) => ({ e, idx })).filter((x) => !x.e.itemId);
		if (extras.length) res.push({ label: "Sonstiges", entries: extras });
		return res;
	}, [trip, map]);

	if (!trip) return <div className="container page">{trips ? <div className="empty">Reise nicht gefunden.</div> : <div className="spinner" />}</div>;

	const update = (entries: TripEntry[]) => save.mutate({ id: trip.id, data: { entries } }, { onError: (e) => toast(errorText(e), "error") });
	const toggle = (idx: number) => update(trip.entries.map((e, i) => (i === idx ? { ...e, checked: !e.checked } : e)));
	const remove = (idx: number) => update(trip.entries.filter((_, i) => i !== idx));
	const done = trip.entries.filter((e) => e.checked).length;
	const days = trip.startDate && trip.endDate ? daysBetween(trip.startDate, trip.endDate) + 1 : null;

	const regenerate = async () => {
		setRegen(true);
		try {
			let weather = trip.weather;
			if (trip.lat !== null && trip.lon !== null && trip.startDate && trip.endDate) {
				weather = (await fetchTripWeather(trip.lat, trip.lon, trip.startDate, trip.endDate).catch(() => null)) ?? weather;
				if (weather) await api(`/api/trips/${trip.id}`, { method: "PATCH", body: { weather } });
			}
			const r = await api<{ trip: Trip; source: string; aiError?: string }>(`/api/trips/${trip.id}/generate`, { method: "POST", body: {} });
			await qc.invalidateQueries({ queryKey: keys.trips });
			toast(r.aiError ? `Regelbasiert erstellt (KI: ${r.aiError})` : "Neue Packliste erstellt", r.aiError ? "info" : "ok");
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setRegen(false);
		}
	};

	return (
		<div className="container page">
			<PageHead
				title={trip.name}
				left={
					<Link href="/reisen" className="icon-btn" aria-label="Zurück">
						<ArrowLeft size={18} />
					</Link>
				}
				right={
					<button className="btn small" onClick={() => void regenerate()} disabled={regen}>
						<RefreshCw size={15} className={regen ? "spin" : ""} /> Neu
					</button>
				}
			/>
			<div className="card stack">
				<div className="small muted">
					<MapPin size={13} style={{ verticalAlign: "-2px" }} /> {trip.destination}
					{trip.startDate && ` · ${formatShort(trip.startDate)} – ${formatShort(trip.endDate ?? trip.startDate)}`}
					{days ? ` · ${days} Tage` : ""}
				</div>
				{trip.weather && trip.weather.length > 0 ? (
					<div className="thumb-strip" style={{ gap: 12 }}>
						{trip.weather.map((d) => (
							<div key={d.date} style={{ textAlign: "center", minWidth: 46, fontSize: "0.78rem" }}>
								<b>{formatWeekday(d.date)}</b>
								<div>
									<WeatherIcon code={d.code} size={18} />
								</div>
								<div>
									{Math.round(d.tMax)}°/{Math.round(d.tMin)}°
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="tiny muted">Wettervorhersage gibt's ab ca. 16 Tage vor der Reise – dann einfach auf „Neu“ tippen.</div>
				)}
				{trip.notes && <div className="small">💡 {trip.notes}</div>}
				<div className="row between">
					<b>
						{done} / {trip.entries.length} gepackt
					</b>
					{done === trip.entries.length && trip.entries.length > 0 && <span className="badge ok">Koffer fertig!</span>}
				</div>
				<div className="progress">
					<i style={{ width: `${trip.entries.length ? (done / trip.entries.length) * 100 : 0}%` }} />
				</div>
			</div>

			{groups.map((g) => (
				<section key={g.label} className="card">
					<div className="section-title">
						<h2>{g.label}</h2>
					</div>
					{g.entries.map(({ e, idx, item }) => (
						<div key={idx} className="list-row">
							<button
								className="icon-btn"
								style={{ width: 34, height: 34, ...(e.checked ? { background: "var(--ok)", color: "#fff", borderColor: "transparent" } : {}) }}
								onClick={() => toggle(idx)}
								aria-label={e.checked ? "Nicht gepackt" : "Gepackt"}
							>
								{e.checked && <Check size={16} />}
							</button>
							{item && (
								<span className="thumb" style={{ width: 44, height: 44 }}>
									<ItemImage item={item} />
								</span>
							)}
							<span className="grow" style={{ textDecoration: e.checked ? "line-through" : undefined, opacity: e.checked ? 0.6 : 1 }}>
								<b>{item ? item.name : e.text}</b>
								{e.qty && e.qty > 1 ? ` × ${e.qty}` : ""}
								{e.reason && <div className="tiny muted">{e.reason}</div>}
							</span>
							<button className="btn ghost small" onClick={() => remove(idx)} aria-label="Entfernen">
								<X size={15} />
							</button>
						</div>
					))}
				</section>
			))}

			<div className="card stack">
				<div className="row">
					<input className="input" placeholder="Eigener Eintrag, z.B. Sonnenbrille" value={text} onChange={(e) => setText(e.target.value)} />
					<button
						className="btn"
						disabled={!text.trim()}
						onClick={() => {
							update([...trip.entries, { text: text.trim(), checked: false }]);
							setText("");
						}}
					>
						<Plus size={16} />
					</button>
				</div>
				<button className="btn" onClick={() => setPicker(true)}>
					<Plus size={16} /> Teile aus dem Schrank
				</button>
			</div>

			<button
				className="btn danger"
				style={{ alignSelf: "flex-start" }}
				onClick={async () => {
					if (!confirm("Reise löschen?")) return;
					await api(`/api/trips/${trip.id}`, { method: "DELETE" });
					await qc.invalidateQueries({ queryKey: keys.trips });
					navigate("/reisen", { replace: true });
				}}
			>
				<Trash2 size={16} /> Reise löschen
			</button>
			{picker && (
				<ItemPicker
					title="Zur Packliste hinzufügen"
					initial={[]}
					max={30}
					onClose={() => setPicker(false)}
					onDone={(ids) => {
						const existing = new Set(trip.entries.map((e) => e.itemId));
						update([...trip.entries, ...ids.filter((x) => !existing.has(x)).map((itemId) => ({ itemId, checked: false }))]);
						setPicker(false);
					}}
				/>
			)}
			{settings && !settings.ai.configured && <div className="tiny muted">Tipp: Mit eingerichteter KI werden Packlisten noch schlauer.</div>}
		</div>
	);
}
