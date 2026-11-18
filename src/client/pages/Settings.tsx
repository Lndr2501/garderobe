import { useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Download, KeyRound, LocateFixed, LogOut, MapPin, Sparkles, Trash2, User, Wand2, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Segmented, Switch } from "../components/Inputs.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { searchPlaces, type Place } from "../lib/weather.ts";
import { useSaveSettings, useSettings, type SettingsPatch } from "../queries.ts";

const PRESETS = [
	{ label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", imageModel: "gpt-image-1", tryonMode: "edits" as const },
	{ label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini", imageModel: "google/gemini-2.5-flash-image", tryonMode: "chat" as const },
	{ label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2-vision", imageModel: "", tryonMode: "edits" as const },
	{ label: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "", imageModel: "", tryonMode: "edits" as const },
];

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
			<AiSection settings={settings} />
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

interface TestResult {
	ok: boolean;
	models?: string[];
	reply?: string;
	error?: string;
	modelsError?: string;
}

function AiSection({ settings }: { settings: AppSettings }) {
	const ai = settings.ai;
	const save = useSaveSettings();
	const toast = useToast();
	const [baseUrl, setBaseUrl] = useState(ai.baseUrl);
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState(ai.model);
	const [visionModel, setVisionModel] = useState(ai.visionModel);
	const [imageModel, setImageModel] = useState(ai.imageModel);
	const [tryonMode, setTryonMode] = useState(ai.tryonMode);
	const [jsonMode, setJsonMode] = useState(ai.jsonMode);
	const [models, setModels] = useState<string[]>([]);
	const [test, setTest] = useState<TestResult | null>(null);
	const [testing, setTesting] = useState(false);

	const dirty =
		baseUrl !== ai.baseUrl || !!apiKey || model !== ai.model || visionModel !== ai.visionModel || imageModel !== ai.imageModel || tryonMode !== ai.tryonMode || jsonMode !== ai.jsonMode;

	const persist = async () => {
		const s = await save.mutateAsync({ ai: { baseUrl, model, visionModel, imageModel, tryonMode, jsonMode, ...(apiKey ? { apiKey } : {}) } });
		setApiKey("");
		setBaseUrl(s.ai.baseUrl);
		return s;
	};

	const runTest = async () => {
		setTesting(true);
		setTest(null);
		try {
			if (dirty) await persist();
			const r = await api<TestResult>("/api/ai/test", { method: "POST", body: {} });
			setTest(r);
			if (r.models?.length) setModels(r.models);
		} catch (e) {
			setTest({ ok: false, error: errorText(e) });
		} finally {
			setTesting(false);
		}
	};

	return (
		<Section icon={<Bot size={20} />} title="KI-Schnittstelle">
			<p className="small muted" style={{ margin: 0 }}>
				Jede OpenAI-kompatible API funktioniert: OpenAI, OpenRouter, Groq, Mistral, Ollama, LM Studio, LiteLLM, vLLM … Der Schlüssel bleibt auf dem Server und wird nie wieder angezeigt.
			</p>
			<div className="chips">
				{PRESETS.map((p) => (
					<button
						key={p.label}
						className="chip"
						type="button"
						onClick={() => {
							setBaseUrl(p.baseUrl);
							if (p.model) setModel(p.model);
							setImageModel(p.imageModel);
							setTryonMode(p.tryonMode);
						}}
					>
						{p.label}
					</button>
				))}
			</div>
			<label className="field">
				<span>Base-URL</span>
				<input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
			</label>
			<label className="field">
				<span>
					API-Key {ai.hasKey && <span className="badge ok">gespeichert {ai.keyHint}</span>}
				</span>
				<div className="row">
					<input
						className="input"
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder={ai.hasKey ? "Neuen Key eingeben, um zu ersetzen" : "sk-…  (für lokale Server leer lassen)"}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
					/>
					{ai.hasKey && (
						<button
							className="btn ghost"
							type="button"
							aria-label="Key löschen"
							onClick={() => save.mutate({ ai: { clearKey: true } }, { onSuccess: () => toast("Key gelöscht", "ok") })}
						>
							<Trash2 size={16} />
						</button>
					)}
				</div>
			</label>
			<datalist id="ai-models">
				{models.map((m) => (
					<option key={m} value={m} />
				))}
			</datalist>
			<div className="grid grid-2">
				<label className="field">
					<span>Text-Modell</span>
					<input className="input" list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1-mini" autoCapitalize="off" spellCheck={false} />
				</label>
				<label className="field">
					<span>Vision-Modell (optional)</span>
					<input className="input" list="ai-models" value={visionModel} onChange={(e) => setVisionModel(e.target.value)} placeholder="= Text-Modell" autoCapitalize="off" spellCheck={false} />
				</label>
			</div>
			<label className="field">
				<span>
					<Wand2 size={13} /> Bildmodell für KI-Anprobe (optional)
				</span>
				<input className="input" list="ai-models" value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="gpt-image-1" autoCapitalize="off" spellCheck={false} />
			</label>
			<div className="row between wrap">
				<span className="small">
					Anprobe-Modus
					<div className="tiny muted">„Edits“ = /images/edits, „Chat“ = Chat-Modell mit Bildausgabe</div>
				</span>
				<Segmented
					options={[
						{ key: "edits", label: "Edits" },
						{ key: "chat", label: "Chat" },
					]}
					value={tryonMode}
					onChange={setTryonMode}
				/>
			</div>
			<div className="row between">
				<span className="small">
					JSON-Modus erzwingen
					<div className="tiny muted">Ausschalten, falls dein Anbieter <code>response_format</code> nicht kennt.</div>
				</span>
				<Switch label="JSON-Modus" on={jsonMode} onChange={setJsonMode} />
			</div>
			<div className="row wrap">
				<button
					className="btn primary"
					disabled={!dirty || save.isPending}
					onClick={() =>
						void persist().then(
							() => toast("KI-Einstellungen gespeichert", "ok"),
							(e: unknown) => toast(errorText(e), "error"),
						)
					}
				>
					Speichern
				</button>
				<button className="btn" onClick={() => void runTest()} disabled={testing || (!baseUrl && !ai.baseUrl)}>
					{testing ? <span className="spinner" /> : <Sparkles size={16} />} Verbindung testen
				</button>
			</div>
			{test && (
				<div className="card flat tight stack" style={{ gap: 6 }}>
					<div className="row" style={{ gap: 6 }}>
						{test.ok ? <CheckCircle2 size={18} color="var(--ok)" /> : <XCircle size={18} color="var(--danger)" />}
						<b>{test.ok ? "Verbindung klappt" : "Verbindung fehlgeschlagen"}</b>
					</div>
					{test.reply && <div className="small">Antwort: „{test.reply}“</div>}
					{test.error && <div className="small" style={{ color: "var(--danger)" }}>{test.error}</div>}
					{test.models && <div className="tiny muted">{test.models.length} Modelle gefunden – sie werden jetzt in den Feldern vorgeschlagen.</div>}
					{test.modelsError && <div className="tiny muted">Modell-Liste nicht verfügbar: {test.modelsError}</div>}
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

function DataSection() {
	const toast = useToast();
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	return (
		<Section icon={<Download size={20} />} title="Daten">
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
			<div className="tiny muted">Garderobe · Bilder und Daten liegen in deinem eigenen Cloudflare-Konto.</div>
		</Section>
	);
}
