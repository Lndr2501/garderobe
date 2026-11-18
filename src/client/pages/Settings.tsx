import { useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, LocateFixed, LogOut, MapPin, Sparkles, Trash2, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "../../shared/types.ts";
import { api } from "../api.ts";
import { AiSettings } from "../components/AiSettings.tsx";
import { Segmented, Switch } from "../components/Inputs.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { plural } from "../lib/format.ts";
import { itemsToOptimize, optimizeItem } from "../lib/optimize.ts";
import { searchPlaces, type Place } from "../lib/weather.ts";
import { useItems, useSaveSettings, useSettings, type SettingsPatch } from "../queries.ts";

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	return (
		<section className="card stack">
			<div className="row" style={{ gap: 8 }}>
				{icon}
				<h2 style={{ margin: 0 }}>{title}</h2>
			</div>
			{children}
		</section>
	);
}

export function SettingsPage() {
	const { data: settings } = useSettings();
	if (!settings) return <div className="container page"><span className="spinner" /></div>;
	return (
		<div className="container page" style={{ maxWidth: 820 }}>
			<PageHead title="Einstellungen" />
			<General settings={settings} />
			<AiSettings settings={settings} />
			<PasswordSection />
			<DataSection />
		</div>
	);
}

function General({ settings }: { settings: AppSettings }) {
	const save = useSaveSettings();
	const toast = useToast();
	const [name, setName] = useState(settings.name);
	const [q, setQ] = useState("");
	const [places, setPlaces] = useState<Place[]>([]);
	const patch = (p: SettingsPatch, msg = "Gespeichert") => save.mutate(p, { onSuccess: () => toast(msg, "ok"), onError: (e) => toast(errorText(e), "error") });

	useEffect(() => {
		if (q.trim().length < 2) return setPlaces([]);
		const t = setTimeout(() => void searchPlaces(q).then(setPlaces).catch(() => setPlaces([])), 300);
		return () => clearTimeout(t);
	}, [q]);

	return (
		<Section icon={<User size={20} />} title="Allgemein">
			<label className="field">
				<span>Dein Name</span>
				<div className="row">
					<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
					<button className="btn" disabled={name === settings.name} onClick={() => patch({ name: name.trim() })}>
						Sichern
					</button>
				</div>
			</label>

			<div className="field">
				<span>Standort fürs Wetter</span>
				<div className="row small">
					<MapPin size={15} /> <b>{settings.location.name}</b>
				</div>
				<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Anderen Ort suchen …" />
				{places.length > 0 && (
					<div className="card flat tight stack" style={{ gap: 0 }}>
						{places.map((p) => (
							<button
								key={`${p.lat},${p.lon}`}
								className="list-row"
								style={{ border: "none", background: "transparent", textAlign: "left" }}
								onClick={() => {
									patch({ location: { name: p.name, lat: p.lat, lon: p.lon, useGeolocation: settings.location.useGeolocation } }, `Standort: ${p.name}`);
									setQ("");
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
			</div>
			<div className="row between">
				<span className="row small" style={{ gap: 6 }}>
					<LocateFixed size={16} /> Aktuellen Standort (GPS) verwenden
				</span>
				<Switch
					label="GPS verwenden"
					on={settings.location.useGeolocation}
					onChange={(v) => patch({ location: { ...settings.location, useGeolocation: v } })}
				/>
			</div>

			<div className="row between">
				<span className="small">Währung</span>
				<Segmented
					options={[
						{ key: "EUR", label: "€" },
						{ key: "CHF", label: "CHF" },
						{ key: "USD", label: "$" },
						{ key: "GBP", label: "£" },
					]}
					value={settings.currency}
					onChange={(v) => patch({ currency: v })}
				/>
			</div>

			<div className="row between">
				<span className="small">
					Hintergrund automatisch entfernen
					<div className="tiny muted">Läuft direkt auf deinem Gerät, beim ersten Mal wird ein Modell (ca. 40–80 MB) geladen.</div>
				</span>
				<Switch label="Freistellen" on={settings.bgRemoval.enabled} onChange={(v) => patch({ bgRemoval: { ...settings.bgRemoval, enabled: v } })} />
			</div>
			{settings.bgRemoval.enabled && (
				<div className="row between">
					<span className="small">Qualität</span>
					<Segmented
						options={[
							{ key: "fast", label: "Schnell" },
							{ key: "best", label: "Beste" },
						]}
						value={settings.bgRemoval.quality}
						onChange={(v) => patch({ bgRemoval: { ...settings.bgRemoval, quality: v } })}
					/>
				</div>
			)}
		</Section>
	);
}

function PasswordSection() {
	const toast = useToast();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<Section icon={<KeyRound size={20} />} title="Passwort">
			<form
				className="stack"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					try {
						await api("/api/auth/password", { method: "POST", body: { current, next } });
						toast("Passwort geändert – andere Geräte sind jetzt abgemeldet", "ok");
						setCurrent("");
						setNext("");
					} catch (err) {
						toast(errorText(err), "error");
					} finally {
						setBusy(false);
					}
				}}
			>
				<input className="input" type="password" autoComplete="current-password" placeholder="Aktuelles Passwort" value={current} onChange={(e) => setCurrent(e.target.value)} />
				<input className="input" type="password" autoComplete="new-password" placeholder="Neues Passwort (min. 8 Zeichen)" value={next} onChange={(e) => setNext(e.target.value)} />
				<button className="btn" type="submit" disabled={busy || !current || next.length < 8} style={{ alignSelf: "flex-start" }}>
					Passwort ändern
				</button>
			</form>
		</Section>
	);
}

function OptimizeImages() {
	const { data: items } = useItems();
	const qc = useQueryClient();
	const toast = useToast();
	const [enhance, setEnhance] = useState(true);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const todo = itemsToOptimize(items ?? []);
	const run = async () => {
		const list = todo;
		setProgress({ done: 0, total: list.length });
		let failed = 0;
		for (let i = 0; i < list.length; i++) {
			try {
				await optimizeItem(list[i]!, enhance);
			} catch {
				failed++;
			}
			setProgress({ done: i + 1, total: list.length });
		}
		await qc.invalidateQueries({ queryKey: ["items"] });
		setProgress(null);
		toast(failed ? `${list.length - failed} optimiert, ${failed} fehlgeschlagen` : `${list.length} Teile optimiert`, failed ? "error" : "ok");
	};
	return (
		<div className="stack" style={{ gap: 8 }}>
			<div className="row between">
				<div>
					<b>Bilder optimieren</b>
					<div className="small muted">Schärfere Vorschaubilder, kleinere Dateien, saubere Ränder{enhance ? ", heller und kontrastreicher" : ""}.</div>
				</div>
				<Switch label="Beim Optimieren aufhellen" on={enhance} onChange={setEnhance} />
			</div>
			<button className="btn" disabled={!!progress || todo.length === 0} onClick={() => void run()}>
				<Sparkles size={16} />{" "}
				{progress ? `Optimiere ${progress.done} / ${progress.total} …` : todo.length ? `${plural(todo.length, "Teil", "Teile")} optimieren` : "Alles optimiert"}
			</button>
		</div>
	);
}

function DataSection() {
	const toast = useToast();
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	return (
		<Section icon={<Download size={20} />} title="Daten">
			<OptimizeImages />
			<div className="row wrap">
				<a className="btn" href="/api/export" download>
					<Download size={16} /> Export (JSON)
				</a>
				<button
					className="btn"
					disabled={busy}
					onClick={async () => {
						setBusy(true);
						try {
							const r = await api<{ total: number; deleted: number }>("/api/maintenance/cleanup", { method: "POST", body: {} });
							toast(r.deleted ? `${r.deleted} verwaiste Bilder gelöscht` : "Alles sauber", "ok");
						} catch (e) {
							toast(errorText(e), "error");
						} finally {
							setBusy(false);
						}
					}}
				>
					<Trash2 size={16} /> Speicher aufräumen
				</button>
				<button
					className="btn"
					onClick={async () => {
						await api("/api/auth/logout", { method: "POST" }).catch(() => {});
						try {
							localStorage.removeItem("garderobe-cache");
						} catch {
							/* ignore */
						}
						qc.clear();
						location.href = "/";
					}}
				>
					<LogOut size={16} /> Abmelden
				</button>
			</div>
			<div className="tiny muted">Garderobe · Bilder und Daten liegen auf deinem eigenen Server.</div>
		</Section>
	);
}
