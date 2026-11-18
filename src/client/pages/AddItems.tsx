import { ArrowLeft, Camera, CheckCircle2, ImagePlus, Loader2, RotateCcw, TriangleAlert, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import type { ItemInput } from "../../shared/types.ts";
import { api, uploadImage } from "../api.ts";
import { Switch } from "../components/Inputs.tsx";
import { ItemForm } from "../components/ItemForm.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { currentSeason } from "../../shared/taxonomy.ts";
import { isImageFile, nearestColorKey, processImage, type ProcessedImage, type Stage } from "../lib/image.ts";
import { useSaveItem, useSettings } from "../queries.ts";

type Status = "wait" | "processing" | "uploading" | "tagging" | "ready" | "saving" | "saved" | "error";

interface Entry {
	id: string;
	file: File;
	status: Status;
	stage?: Stage;
	pct: number;
	processed?: ProcessedImage;
	keys?: { full: string; thumb: string };
	draft: ItemInput;
	aiNote?: string;
	error?: string;
	savedId?: string;
}

const STAGE_LABEL: Record<Stage, string> = {
	laden: "Bild wird geladen …",
	modell: "Freistell-Modell wird geladen (einmalig) …",
	freistellen: "Hintergrund wird entfernt …",
	fertig: "Fertig",
};

const STATUS_LABEL: Partial<Record<Status, string>> = {
	wait: "Wartet …",
	uploading: "Wird hochgeladen …",
	tagging: "KI erkennt das Teil …",
	saving: "Wird gespeichert …",
	saved: "Gespeichert",
};

export function AddItems() {
	const { data: settings } = useSettings();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [removeBg, setRemoveBg] = useState<boolean | null>(null);
	const [batch, setBatch] = useState(false);
	const [drag, setDrag] = useState(false);
	const busy = useRef(false);
	const cameraInput = useRef<HTMLInputElement>(null);
	const libraryInput = useRef<HTMLInputElement>(null);
	const save = useSaveItem();
	const toast = useToast();
	const [, navigate] = useLocation();
	const bg = removeBg ?? settings?.bgRemoval.enabled ?? true;
	const aiOn = !!settings?.ai.configured;

	const update = useCallback((id: string, patch: Partial<Entry>) => {
		setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
	}, []);

	const addFiles = useCallback(
		(files: File[] | FileList | null | undefined) => {
			const list = [...(files ?? [])].filter(isImageFile);
			if (!list.length) return;
			setEntries((cur) => {
				const next = [
					...cur,
					...list.map<Entry>((file) => ({
						id: crypto.randomUUID(),
						file,
						status: "wait",
						pct: 0,
						draft: { category: undefined, warmth: 3, formality: 2, seasons: [], colors: [], styleTags: [] },
					})),
				];
				if (next.length > 1) setBatch(true);
				return next;
			});
		},
		[],
	);

	// Paste support (e.g. "Motiv kopieren" on iPhone/Mac).
	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			const files = [...(e.clipboardData?.files ?? [])];
			if (files.length) {
				e.preventDefault();
				addFiles(files);
			}
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [addFiles]);

	const run = useCallback(
		async (entry: Entry) => {
			try {
				update(entry.id, { status: "processing", stage: "laden", pct: 0 });
				const processed = await processImage(entry.file, {
					removeBg: bg,
					quality: settings?.bgRemoval.quality ?? "best",
					onProgress: (stage, pct) => update(entry.id, { stage, pct }),
				});
				update(entry.id, { processed, status: "uploading" });
				const [full, thumb] = await Promise.all([uploadImage(processed.full), uploadImage(processed.thumb)]);
				const colorKey = nearestColorKey(processed.colorHex);
				let draft: ItemInput = {
					...entry.draft,
					colorHex: processed.colorHex,
					colors: colorKey ? [colorKey] : [],
					seasons: [],
					imageFront: full,
					thumbFront: thumb,
				};
				let aiNote: string | undefined;
				if (aiOn) {
					update(entry.id, { status: "tagging" });
					try {
						const tags = await api<ItemInput>("/api/ai/tag", { method: "POST", body: { image: processed.ai } });
						draft = { ...draft, ...tags };
					} catch (e) {
						aiNote = `KI-Erkennung fehlgeschlagen: ${errorText(e)}`;
					}
				}
				if (!draft.seasons?.length) draft.seasons = [currentSeason()];
				update(entry.id, { keys: { full, thumb }, draft, aiNote, status: "ready" });
				return { ...entry, keys: { full, thumb }, draft, processed };
			} catch (e) {
				update(entry.id, { status: "error", error: errorText(e) });
				return null;
			}
		},
		[bg, settings, aiOn, update],
	);

	// Sequential processing queue.
	useEffect(() => {
		if (busy.current || !settings) return;
		const pendingSave = batch ? entries.find((e) => e.status === "ready") : undefined;
		const next = pendingSave ?? entries.find((e) => e.status === "wait");
		if (!next) return;
		busy.current = true;
		void (async () => {
			const done = pendingSave ?? (await run(next));
			if (done && batch) {
				update(next.id, { status: "saving" });
				try {
					const item = await save.mutateAsync({
						data: { ...done.draft, category: done.draft.category ?? "other", needsReview: true },
					});
					update(next.id, { status: "saved", savedId: item.id });
				} catch (e) {
					update(next.id, { status: "error", error: errorText(e) });
				}
			}
			busy.current = false;
			setEntries((x) => [...x]);
		})();
	}, [entries, run, batch, save, update, settings]);

	const single = !batch && entries.length === 1 ? entries[0] : undefined;

	const saveSingle = () => {
		if (!single) return;
		if (!single.draft.category) return toast("Bitte eine Kategorie wählen", "error");
		update(single.id, { status: "saving" });
		save.mutate(
			{ data: { ...single.draft, needsReview: false } },
			{
				onSuccess: (item) => {
					toast("Hängt jetzt in deinem Schrank ✨", "ok");
					navigate(`/teil/${item.id}`, { replace: true });
				},
				onError: (e) => {
					update(single.id, { status: "ready" });
					toast(errorText(e), "error");
				},
			},
		);
	};

	const allDone = entries.length > 0 && entries.every((e) => e.status === "saved" || e.status === "error");

	return (
		<div className="container page">
			<PageHead
				title="Neue Teile"
				left={
					<Link href="/" className="icon-btn" aria-label="Zurück">
						<ArrowLeft size={18} />
					</Link>
				}
				right={
					single?.status === "ready" ? (
						<button className="btn primary" onClick={saveSingle} disabled={save.isPending}>
							Speichern
						</button>
					) : undefined
				}
			/>

			{entries.length === 0 && (
				<>
					<div
						className={`drop-zone ${drag ? "drag" : ""}`}
						onDragOver={(e) => {
							e.preventDefault();
							setDrag(true);
						}}
						onDragLeave={() => setDrag(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDrag(false);
							addFiles(e.dataTransfer.files);
						}}
					>
						<div className="hand" style={{ fontSize: "1.8rem" }}>
							Fotografiere ein Kleidungsstück
						</div>
						<p className="small muted" style={{ marginTop: 4 }}>
							Am besten flach hingelegt oder auf einem Bügel vor einer hellen Wand. Mehrere Fotos auf einmal gehen auch – die werden dann automatisch einsortiert.
						</p>
						<div className="row wrap" style={{ justifyContent: "center", marginTop: 12 }}>
							<button className="btn primary" onClick={() => cameraInput.current?.click()}>
								<Camera size={18} /> Foto aufnehmen
							</button>
							<button className="btn" onClick={() => libraryInput.current?.click()}>
								<ImagePlus size={18} /> Aus Fotos wählen
							</button>
						</div>
						<p className="tiny muted" style={{ marginTop: 12 }}>
							Tipp: Bilder hier hineinziehen oder einfügen (⌘V) – auch „Motiv kopieren“ aus der Fotos-App.
						</p>
					</div>
					<div className="card row between">
						<div>
							<b>Hintergrund automatisch entfernen</b>
							<div className="small muted">Läuft direkt auf deinem Gerät, keine Daten gehen raus.</div>
						</div>
						<Switch label="Hintergrund entfernen" on={bg} onChange={setRemoveBg} />
					</div>
					{!aiOn && (
						<div className="card small">
							<Wand2 size={16} style={{ verticalAlign: "-3px" }} /> Mit einer KI (OpenAI-kompatibel) werden Name, Kategorie, Farben und Material automatisch erkannt.{" "}
							<Link href="/einstellungen">KI einrichten</Link>
						</div>
					)}
				</>
			)}

			<input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
			<input ref={libraryInput} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />

			{single && (
				<div className="two-col">
					<div className="card stack">
						<div className="checker" style={{ aspectRatio: "4 / 5", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
							{single.processed ? (
								<img src={single.processed.preview} alt="Vorschau" style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
							) : (
								<Progress entry={single} />
							)}
						</div>
						{single.processed && <StatusLine entry={single} />}
						{single.status === "error" && (
							<button className="btn" onClick={() => update(single.id, { status: "wait", error: undefined })}>
								<RotateCcw size={16} /> Nochmal versuchen
							</button>
						)}
						{single.aiNote && <div className="badge warn" style={{ whiteSpace: "normal" }}>{single.aiNote}</div>}
					</div>
					<div className="card">
						{single.status === "ready" || single.status === "saving" ? (
							<ItemForm value={single.draft} onChange={(draft) => update(single.id, { draft })} currency={settings?.currency} />
						) : (
							<div className="stack muted small">
								<b style={{ color: "var(--text)" }}>Gleich geht's weiter …</b>
								<span>Sobald das Bild fertig ist, kannst du hier Name, Kategorie und Farben prüfen{aiOn ? " – die KI füllt alles vor" : ""}.</span>
							</div>
						)}
					</div>
				</div>
			)}

			{single?.status === "ready" && (
				<button className="btn primary block" onClick={saveSingle} disabled={save.isPending}>
					In den Schrank hängen
				</button>
			)}

			{batch && (
				<div className="stack">
					<div className="card row between">
						<div>
							<b>
								{entries.filter((e) => e.status === "saved").length} / {entries.length} einsortiert
							</b>
							<div className="small muted">Neue Teile sind mit „prüfen“ markiert – tippe sie später kurz an und korrigiere, falls nötig.</div>
						</div>
						<button className="btn small" onClick={() => libraryInput.current?.click()}>
							<ImagePlus size={15} /> Mehr
						</button>
					</div>
					<div className="progress">
						<i style={{ width: `${(entries.filter((e) => e.status === "saved" || e.status === "error").length / entries.length) * 100}%` }} />
					</div>
					<div className="grid grid-items">
						{entries.map((e) => (
							<div key={e.id} className="tile" onClick={() => e.savedId && navigate(`/teil/${e.savedId}`)} style={{ cursor: e.savedId ? "pointer" : "default" }}>
								<div className="img checker">
									{e.processed ? <img src={e.processed.preview} alt="" /> : <Loader2 className="spin" size={22} />}
								</div>
								<div className="t-name">{e.draft.name || e.file.name}</div>
								<StatusLine entry={e} />
							</div>
						))}
					</div>
					{allDone && (
						<Link href="/?pruefen=1" className="btn primary block">
							Fertig – zum Schrank
						</Link>
					)}
				</div>
			)}
		</div>
	);
}

function Progress({ entry }: { entry: Entry }) {
	if (entry.status === "error") {
		return (
			<div className="stack" style={{ alignItems: "center", padding: 20, textAlign: "center" }}>
				<TriangleAlert color="var(--danger)" />
				<span className="small">{entry.error}</span>
			</div>
		);
	}
	const label = entry.status === "processing" && entry.stage ? STAGE_LABEL[entry.stage] : (STATUS_LABEL[entry.status] ?? "");
	return (
		<div className="stack" style={{ alignItems: "center", width: "70%" }}>
			<div className="spinner" />
			<span className="small muted" style={{ textAlign: "center" }}>
				{label}
			</span>
			{entry.status === "processing" && entry.pct > 0 && entry.pct < 1 && (
				<div className="progress" style={{ width: "100%" }}>
					<i style={{ width: `${Math.round(entry.pct * 100)}%` }} />
				</div>
			)}
		</div>
	);
}

function StatusLine({ entry }: { entry: Entry }) {
	if (entry.status === "saved")
		return (
			<span className="badge ok">
				<CheckCircle2 size={12} /> gespeichert
			</span>
		);
	if (entry.status === "error") return <span className="badge danger" title={entry.error}>Fehler</span>;
	if (entry.status === "ready")
		return <span className="badge">{entry.processed?.bgRemoved ? "freigestellt ✓" : "bereit"}</span>;
	const label = entry.status === "processing" && entry.stage ? STAGE_LABEL[entry.stage] : (STATUS_LABEL[entry.status] ?? "");
	return <span className="tiny muted">{label}</span>;
}
