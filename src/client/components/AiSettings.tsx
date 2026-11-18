import { Bot, CheckCircle2, Cloud, ImageIcon, MessageSquare, Plus, ScanEye, Shirt, Sparkles, Trash2, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LOCAL_FLUX_PROVIDER, type AiArea, type AiProviderKind, type AiProviderPublic, type AiRoutePublic, type AppSettings } from "../../shared/types.ts";
import { api } from "../api.ts";
import { useSaveSettings } from "../queries.ts";
import { Segmented, Switch } from "./Inputs.tsx";
import { errorText, useToast } from "./Toast.tsx";

const FLUX = "@cf/black-forest-labs/flux-2-dev";
const CF_CHAT = "@cf/meta/llama-4-scout-17b-16e-instruct";

interface Preset {
	label: string;
	kind: AiProviderKind;
	baseUrl: string;
	models: Partial<Record<AiArea, string>>;
	mode: "edits" | "chat";
}

const PRESETS: Preset[] = [
	{ label: "Cloudflare", kind: "cloudflare", baseUrl: "", models: { studio: FLUX, tryon: FLUX, text: CF_CHAT, vision: CF_CHAT }, mode: "edits" },
	{
		label: "OpenAI",
		kind: "openai",
		baseUrl: "https://api.openai.com/v1",
		models: { text: "gpt-4.1-mini", vision: "gpt-4.1-mini", studio: "gpt-image-1", tryon: "gpt-image-1" },
		mode: "edits",
	},
	{
		label: "OpenRouter",
		kind: "openai",
		baseUrl: "https://openrouter.ai/api/v1",
		models: { text: "openai/gpt-4.1-mini", vision: "openai/gpt-4.1-mini", studio: "google/gemini-2.5-flash-image", tryon: "google/gemini-2.5-flash-image" },
		mode: "chat",
	},
	{ label: "Ollama", kind: "openai", baseUrl: "http://localhost:11434/v1", models: { text: "llama3.2-vision", vision: "llama3.2-vision" }, mode: "edits" },
	{ label: "LM Studio", kind: "openai", baseUrl: "http://localhost:1234/v1", models: {}, mode: "edits" },
	{ label: "Eigener", kind: "openai", baseUrl: "", models: {}, mode: "edits" },
];

const AREAS: { key: AiArea; label: string; hint: string; icon: ReactNode; image: boolean }[] = [
	{ key: "text", label: "Texte", hint: "Chat, Outfit-Ideen, Packlisten", icon: <MessageSquare size={16} />, image: false },
	{ key: "vision", label: "Erkennung", hint: "Fotos einsortieren, Kauf-Check", icon: <ScanEye size={16} />, image: false },
	{ key: "studio", label: "Studio-Bild", hint: "Schöne Produktbilder aus deinen Fotos", icon: <ImageIcon size={16} />, image: true },
	{ key: "tryon", label: "Anprobe", hint: "Dich in den Teilen zeigen", icon: <Shirt size={16} />, image: true },
];

/** Editable copy of a provider; the key is only sent when typed. */
interface ProviderDraft extends AiProviderPublic {
	apiKey: string;
	clearKey?: boolean;
}

interface TestResult {
	ok: boolean;
	models?: string[];
	reply?: string;
	error?: string;
	modelsError?: string;
	ms?: number;
}

function newId(): string {
	return `p${crypto.randomUUID().slice(0, 6)}`;
}

function draftsFrom(ai: AppSettings["ai"]): ProviderDraft[] {
	return ai.providers.map((p) => ({ ...p, apiKey: "" }));
}

/** Rough pictures per day within the free allowance (768×1024 output, ≤768 px reference). */
function perDay(steps: number, budget: number): number {
	const neurons = Math.ceil(((2 * 0.00021 + 3 * 0.00041) * steps) / 0.000011);
	return Math.floor(budget / neurons);
}

export function AiSettings({ settings }: { settings: AppSettings }) {
	const ai = settings.ai;
	const save = useSaveSettings();
	const toast = useToast();
	const [providers, setProviders] = useState<ProviderDraft[]>(() => draftsFrom(ai));
	const [routes, setRoutes] = useState<Record<AiArea, AiRoutePublic>>(ai.routes);
	const [studio, setStudio] = useState({ auto: ai.studio.auto, freeOnly: ai.studio.freeOnly, steps: ai.studio.steps });
	const [adding, setAdding] = useState(ai.providers.length === 0);
	const [models, setModels] = useState<Record<string, string[]>>({});
	const [tests, setTests] = useState<Record<string, TestResult | "busy">>({});

	const saved = JSON.stringify([draftsFrom(ai), ai.routes, { auto: ai.studio.auto, freeOnly: ai.studio.freeOnly, steps: ai.studio.steps }]);
	const dirty = JSON.stringify([providers, routes, studio]) !== saved;

	const persist = async () => {
		const s = await save.mutateAsync({
			ai: {
				providers: providers.map(({ hasKey: _h, keyHint: _k, apiKey, ...p }) => ({ ...p, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })),
				routes,
				studio,
			},
		});
		setProviders(draftsFrom(s.ai));
		setRoutes(s.ai.routes);
		return s;
	};

	const saveNow = () =>
		void persist().then(
			() => toast("KI-Einstellungen gespeichert", "ok"),
			(e: unknown) => toast(errorText(e), "error"),
		);

	const add = (preset: Preset) => {
		const id = newId();
		const p: ProviderDraft = {
			id,
			name: preset.label === "Eigener" ? "" : preset.label,
			kind: preset.kind,
			baseUrl: preset.baseUrl,
			accountId: "",
			jsonMode: false,
			reasoning: false,
			hasKey: false,
			keyHint: "",
			apiKey: "",
		};
		setProviders((list) => [...list, p]);
		// Unused areas go to the new provider (with its usual models).
		setRoutes((r) => {
			const next = { ...r };
			for (const { key } of AREAS) {
				const model = preset.models[key];
				const free = !r[key].provider;
				if (free && (model || (preset.label === "Eigener" && (key === "text" || key === "vision")))) {
					next[key] = { provider: id, model: model ?? "", mode: preset.mode };
				}
			}
			return next;
		});
		setAdding(false);
	};

	const update = (id: string, patch: Partial<ProviderDraft>) => setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

	const remove = (id: string) => {
		setProviders((list) => list.filter((p) => p.id !== id));
		setRoutes((r) => {
			const next = { ...r };
			for (const { key } of AREAS) if (next[key].provider === id) next[key] = { provider: "", model: "", mode: "edits" };
			return next;
		});
	};

	const loadModels = async (id: string) => {
		if (models[id] || !ai.providers.some((p) => p.id === id)) return;
		setModels((m) => ({ ...m, [id]: [] }));
		try {
			const r = await api<{ models: string[] }>(`/api/ai/models?provider=${encodeURIComponent(id)}`);
			setModels((m) => ({ ...m, [id]: r.models }));
		} catch {
			/* the list is only a convenience */
		}
	};

	const runTest = async (id: string) => {
		setTests((t) => ({ ...t, [id]: "busy" }));
		try {
			if (dirty) await persist();
			const r = await api<TestResult>("/api/ai/test", { method: "POST", body: { provider: id } });
			setTests((t) => ({ ...t, [id]: r }));
			if (r.models?.length) setModels((m) => ({ ...m, [id]: r.models! }));
		} catch (e) {
			setTests((t) => ({ ...t, [id]: { ok: false, error: errorText(e) } }));
		}
	};

	const studioProvider = providers.find((p) => p.id === routes.studio.provider);
	const metered = studioProvider?.kind === "cloudflare";

	return (
		<section className="card stack">
			<div className="row" style={{ gap: 8 }}>
				<Bot size={20} />
				<h2 style={{ margin: 0 }}>KI</h2>
			</div>
			<p className="small muted" style={{ margin: 0 }}>
				Du kannst mehrere Anbieter eintragen und für jeden Bereich einen anderen nehmen – z.B. deinen Proxy für Texte und Cloudflare (gratis) für Bilder. Schlüssel bleiben auf dem Server.
			</p>

			<h3 className="ai-sub">Anbieter</h3>
			{providers.map((p) => (
				<ProviderCard
					key={p.id}
					p={p}
					test={tests[p.id]}
					onChange={(patch) => update(p.id, patch)}
					onRemove={() => remove(p.id)}
					onTest={() => void runTest(p.id)}
				/>
			))}
			{adding ? (
				<div className="stack" style={{ gap: 6 }}>
					<span className="small muted">Welcher Anbieter?</span>
					<div className="chips">
						{PRESETS.map((pr) => (
							<button key={pr.label} className="chip" type="button" onClick={() => add(pr)}>
								{pr.kind === "cloudflare" && <Cloud size={13} />} {pr.label}
							</button>
						))}
					</div>
				</div>
			) : (
				<button className="btn ghost" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
					<Plus size={16} /> Anbieter hinzufügen
				</button>
			)}

			<h3 className="ai-sub">Wer macht was?</h3>
			<div className="ai-areas">
				{AREAS.map((a) => {
					const r = routes[a.key];
					const prov = providers.find((p) => p.id === r.provider);
					const local = a.key === "studio" && r.provider === LOCAL_FLUX_PROVIDER;
					const listId = `models-${a.key}`;
					const placeholder =
						prov?.kind === "cloudflare" ? (a.image ? FLUX : CF_CHAT) : a.image ? "gpt-image-1" : a.key === "vision" ? "Modell mit Bildverständnis" : "gpt-4.1-mini";
					return (
						<div key={a.key} className="ai-area">
							<div className="ai-area-head">
								{a.icon}
								<div>
									<b>{a.label}</b>
									<div className="tiny muted">{a.hint}</div>
								</div>
								<span className={`dot ${ai.areas[a.key] && !dirty ? "ok" : ""}`} aria-hidden />
							</div>
							<div className="ai-area-fields">
								<select
									className="input"
									aria-label={`Anbieter für ${a.label}`}
									value={r.provider}
									onChange={(e) => {
										const id = e.target.value;
										const np = providers.find((p) => p.id === id);
										const keepModel = np && prov && np.kind === prov.kind ? r.model : "";
										const suggested = id === LOCAL_FLUX_PROVIDER ? "klein-4b" : np?.kind === "cloudflare" ? (a.image ? FLUX : CF_CHAT) : "";
										setRoutes({ ...routes, [a.key]: { ...r, provider: id, model: keepModel || suggested } });
									}}
								>
									<option value="">Aus</option>
									{a.key === "studio" && (
										<option value={LOCAL_FLUX_PROVIDER} disabled={!ai.studio.localFluxAvailable}>
											FLUX.2 Klein 4B (Mac per SSH){!ai.studio.localFluxAvailable && " – Server nicht eingerichtet"}
										</option>
									)}
									{providers.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name || p.baseUrl || "Neuer Anbieter"}
										</option>
									))}
								</select>
								{r.provider && !local && (
									<input
										className="input"
										aria-label={`Modell für ${a.label}`}
										list={listId}
										value={r.model}
										onFocus={() => void loadModels(r.provider)}
										onChange={(e) => setRoutes({ ...routes, [a.key]: { ...r, model: e.target.value } })}
										placeholder={placeholder}
										autoCapitalize="off"
										autoCorrect="off"
										spellCheck={false}
									/>
								)}
								<datalist id={listId}>
									{(models[r.provider] ?? []).map((m) => (
										<option key={m} value={m} />
									))}
								</datalist>
							</div>
							{local && <span className="tiny muted">Standard: Das Originalfoto wird auf deinem Mac freigestellt. Eine neu gezeichnete KI-3D-Variante kannst du am Teil separat starten.</span>}
							{a.image && prov?.kind === "openai" && (
								<div className="row between wrap">
									<span className="tiny muted">„Edits“ = /images/edits, „Chat“ = Chat-Modell mit Bildausgabe</span>
									<Segmented
										options={[
											{ key: "edits", label: "Edits" },
											{ key: "chat", label: "Chat" },
										]}
										value={r.mode}
										onChange={(mode) => setRoutes({ ...routes, [a.key]: { ...r, mode } })}
									/>
								</div>
							)}
							{a.key === "studio" && r.provider && (
								<div className="stack" style={{ gap: 10 }}>
									<div className="row between">
										<span className="small">
											Automatisch für alle Teile
											<div className="tiny muted">Neue und bisherige Teile bekommen nach und nach ein Studio-Bild.</div>
										</span>
										<Switch label="Studio-Bild automatisch" on={studio.auto} onChange={(auto) => setStudio({ ...studio, auto })} />
									</div>
									{metered && (
										<>
											<div className="row between wrap">
												<span className="small">Qualität</span>
												<Segmented
													options={[
														{ key: 20, label: "Schnell" },
														{ key: 28, label: "Gut" },
														{ key: 50, label: "Beste" },
													]}
													value={studio.steps}
													onChange={(steps) => setStudio({ ...studio, steps })}
												/>
											</div>
											<div className="row between">
												<span className="small">
													Nur Gratis-Kontingent
													<div className="tiny muted">
														{studio.freeOnly
															? `Etwa ${perDay(studio.steps, ai.studio.budget)} Bilder pro Tag gratis, der Rest wartet bis zum nächsten Tag.`
															: "Achtung: Bei einem bezahlten Workers-Plan kostet jedes Bild über dem Kontingent Geld."}
													</div>
												</span>
												<Switch label="Nur Gratis-Kontingent" on={studio.freeOnly} onChange={(freeOnly) => setStudio({ ...studio, freeOnly })} />
											</div>
											<div className="tiny muted">
												Heute: {ai.studio.imagesToday} {ai.studio.imagesToday === 1 ? "Bild" : "Bilder"} · ca.{" "}
												{ai.studio.usedToday.toLocaleString("de-DE")} von {ai.studio.budget.toLocaleString("de-DE")} Neuronen (zählt auch die Anprobe)
											</div>
										</>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			<div className="row wrap">
				<button className="btn primary" disabled={!dirty || save.isPending} onClick={saveNow}>
					Speichern
				</button>
				{dirty && <span className="tiny muted">Ungespeicherte Änderungen</span>}
			</div>
		</section>
	);
}

function ProviderCard({
	p,
	test,
	onChange,
	onRemove,
	onTest,
}: {
	p: ProviderDraft;
	test: TestResult | "busy" | undefined;
	onChange: (patch: Partial<ProviderDraft>) => void;
	onRemove: () => void;
	onTest: () => void;
}) {
	const cf = p.kind === "cloudflare";
	const keyLabel = cf ? "API-Token" : "API-Key";
	return (
		<div className="card flat tight stack ai-provider">
			<div className="row between" style={{ gap: 8 }}>
				<input
					className="input ai-name"
					value={p.name}
					onChange={(e) => onChange({ name: e.target.value })}
					placeholder="Name, z.B. Mein Proxy"
					aria-label="Name des Anbieters"
				/>
				<button className="btn ghost" type="button" aria-label="Anbieter entfernen" onClick={onRemove}>
					<Trash2 size={16} />
				</button>
			</div>
			<Segmented
				options={[
					{ key: "openai", label: "OpenAI-kompatibel" },
					{ key: "cloudflare", label: "Cloudflare" },
				]}
				value={p.kind}
				onChange={(kind) => onChange({ kind })}
			/>
			{cf ? (
				<label className="field">
					<span>Account-ID</span>
					<input
						className="input"
						value={p.accountId}
						onChange={(e) => onChange({ accountId: e.target.value.trim() })}
						placeholder="32 Zeichen, steht im Cloudflare-Dashboard rechts"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
					/>
				</label>
			) : (
				<label className="field">
					<span>Base-URL</span>
					<input
						className="input"
						value={p.baseUrl}
						onChange={(e) => onChange({ baseUrl: e.target.value })}
						placeholder="https://api.openai.com/v1"
						inputMode="url"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
					/>
				</label>
			)}
			<label className="field">
				<span>
					{keyLabel} {p.hasKey && !p.clearKey && <span className="badge ok">gespeichert {p.keyHint}</span>}
				</span>
				<div className="row">
					<input
						className="input"
						type="password"
						value={p.apiKey}
						onChange={(e) => onChange({ apiKey: e.target.value, clearKey: false })}
						placeholder={
							p.hasKey && !p.clearKey
								? `Neuen ${keyLabel} eingeben, um zu ersetzen`
								: cf
									? "Token mit Recht „Workers AI: Read“ und „Edit“"
									: "sk-…  (für lokale Server leer lassen)"
						}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
					/>
					{p.hasKey && !p.clearKey && (
						<button className="btn ghost" type="button" aria-label={`${keyLabel} löschen`} onClick={() => onChange({ clearKey: true, apiKey: "" })}>
							<Trash2 size={16} />
						</button>
					)}
				</div>
			</label>
			{cf ? (
				<div className="tiny muted">
					Workers AI: FLUX.2 für Studio-Bilder und Anprobe. Im Free-Plan gibt es 10 000 Neuronen pro Tag gratis, danach blockt Cloudflare bis 01:00 Uhr (Mitternacht UTC) – es kostet nichts.
				</div>
			) : (
				<>
					<div className="row between">
						<span className="small">
							JSON-Modus erzwingen
							<div className="tiny muted">Ausschalten, falls der Anbieter <code>response_format</code> nicht kennt.</div>
						</span>
						<Switch label="JSON-Modus" on={p.jsonMode} onChange={(jsonMode) => onChange({ jsonMode })} />
					</div>
					<div className="row between">
						<span className="small">
							KI darf „nachdenken“
							<div className="tiny muted">Aus = schnellere Antworten (Qwen3, DeepSeek R1 …).</div>
						</span>
						<Switch label="Nachdenken" on={p.reasoning} onChange={(reasoning) => onChange({ reasoning })} />
					</div>
				</>
			)}
			<div className="row wrap">
				<button className="btn" type="button" onClick={onTest} disabled={test === "busy"}>
					{test === "busy" ? <span className="spinner" /> : <Sparkles size={16} />} Testen
				</button>
			</div>
			{test && test !== "busy" && (
				<div className="stack" style={{ gap: 4 }}>
					<div className="row" style={{ gap: 6 }}>
						{test.ok ? <CheckCircle2 size={18} color="var(--ok)" /> : <XCircle size={18} color="var(--danger)" />}
						<b>{test.ok ? "Verbindung klappt" : "Verbindung fehlgeschlagen"}</b>
					</div>
					{test.reply && (
						<div className="small">
							Antwort: „{test.reply}“{test.ms !== undefined ? ` nach ${(test.ms / 1000).toFixed(1).replace(".", ",")} s` : ""}
							{test.ms !== undefined && test.ms > 15000 ? " – ziemlich langsam, die App wartet deshalb nirgends auf die KI." : ""}
						</div>
					)}
					{test.error && <div className="small" style={{ color: "var(--danger)" }}>{test.error}</div>}
					{test.models && <div className="tiny muted">{test.models.length} Modelle gefunden – sie werden jetzt in den Feldern vorgeschlagen.</div>}
					{test.modelsError && <div className="tiny muted">Modell-Liste nicht verfügbar: {test.modelsError}</div>}
				</div>
			)}
		</div>
	);
}

