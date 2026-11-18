import { ArrowLeft, Camera, ImagePlus, RotateCw, Settings2, Sparkles, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CATEGORIES, type CategoryKey } from "../../shared/taxonomy.ts";
import type { ItemPayload } from "../../shared/types.ts";
import { uploadImage } from "../api.ts";
import { Switch } from "../components/Inputs.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { aiJpeg, isImageFile, loadCanvas, nearestColorKey, processImage, rotateCanvas, rotateImage, type ProcessedImage, type Stage } from "../lib/image.ts";
import { useLocal } from "../lib/useLocal.ts";
import { useSaveItem, useSettings } from "../queries.ts";

type Status = "wait" | "processing" | "ready" | "saving" | "saved" | "error";

interface Entry {
	id: string;
	file: File;
	status: Status;
	stage?: Stage;
	pct: number;
	processed?: ProcessedImage;
	/** Clockwise turn the user asked for (applied when saving). */
	rotate: number;
	category: CategoryKey | "";
	error?: string;
}

const STAGE_LABEL: Record<Stage, string> = {
	laden: "Lädt …",
	modell: "Freistell-Modell lädt (einmalig) …",
	freistellen: "Hintergrund weg …",
	fertig: "Fertig",
};

export function AddItems() {
	const { data: settings } = useSettings();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [removeBg, setRemoveBg] = useState<boolean | null>(null);
	const [drag, setDrag] = useState(false);
	const [saving, setSaving] = useState(false);
	const [showOptions, setShowOptions] = useState(false);
	const busy = useRef(false);
	const cameraInput = useRef<HTMLInputElement>(null);
	const libraryInput = useRef<HTMLInputElement>(null);
	const save = useSaveItem();
	const toast = useToast();
	const [, navigate] = useLocation();
	const bg = removeBg ?? settings?.bgRemoval.enabled ?? true;
	const [enhance, setEnhance] = useLocal("gd-enhance", true);
	const aiOn = !!settings?.ai.areas.vision;

	const update = useCallback((id: string, patch: Partial<Entry>) => {
		setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
	}, []);

	const addFiles = useCallback((files: File[] | FileList | null | undefined) => {
		const list = [...(files ?? [])].filter(isImageFile);
		if (!list.length) return;
		setEntries((cur) => [...cur, ...list.map<Entry>((file) => ({ id: crypto.randomUUID(), file, status: "wait", pct: 0, rotate: 0, category: "" }))]);
	}, []);

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

	// Background removal runs one photo at a time (it is heavy on phones).
	useEffect(() => {
		if (busy.current || !settings) return;
		const next = entries.find((e) => e.status === "wait");
		if (!next) return;
		busy.current = true;
		void (async () => {
			try {
				update(next.id, { status: "processing", stage: "laden", pct: 0 });
				const processed = await processImage(next.file, {
					removeBg: bg,
					quality: settings.bgRemoval.quality ?? "best",
					enhance,
					onProgress: (stage, pct) => update(next.id, { stage, pct }),
				});
				update(next.id, { processed, status: "ready" });
			} catch (e) {
				update(next.id, { status: "error", error: errorText(e) });
			} finally {
				busy.current = false;
				setEntries((x) => [...x]);
			}
		})();
	}, [entries, bg, enhance, settings, update]);

	const ready = entries.filter((e) => e.status === "ready");
	const working = entries.some((e) => e.status === "wait" || e.status === "processing");

	const saveAll = async () => {
		if (!ready.length || saving) return;
		setSaving(true);
		let ok = 0;
		for (const e of ready) {
			const p = e.processed!;
			update(e.id, { status: "saving" });
			try {
				let { full, thumb } = p;
				let aiBlob = p.aiBlob;
				if (e.rotate) {
					({ full, thumb } = await rotateImage(full, e.rotate));
					aiBlob = await aiJpeg(rotateCanvas(await loadCanvas(p.aiBlob, 1024), e.rotate));
				}
				const [imageFront, thumbFront, aiImage] = await Promise.all([uploadImage(full), uploadImage(thumb), aiOn ? uploadImage(aiBlob) : Promise.resolve(undefined)]);
				const colorKey = nearestColorKey(p.colorHex);
				const lock = [...(e.category ? ["category"] : []), ...(e.rotate ? ["rotate"] : [])];
				const data: ItemPayload = {
					imageFront,
					thumbFront,
					colorHex: p.colorHex,
					colors: colorKey ? [colorKey] : [],
					category: e.category || "other",
					needsReview: !aiOn,
					lock,
					aiImage,
					colorHint: colorKey ?? undefined,
				};
				await save.mutateAsync({ data });
				update(e.id, { status: "saved" });
				ok++;
			} catch (err) {
				update(e.id, { status: "error", error: errorText(err) });
			}
		}
		setSaving(false);
		if (ok) {
			toast(aiOn ? `${ok} ${ok === 1 ? "Teil hängt" : "Teile hängen"} im Schrank – die KI sortiert gerade ein ✨` : `${ok} ${ok === 1 ? "Teil" : "Teile"} gespeichert`, "ok");
			navigate("/");
		}
	};

	return (
		<div className="container page add-page">
			<PageHead
				title="Neue Teile"
				left={
					<Link href="/" className="icon-btn" aria-label="Zurück">
						<ArrowLeft size={18} />
					</Link>
				}
				right={
					<button className={`icon-btn ${showOptions ? "active" : ""}`} onClick={() => setShowOptions((v) => !v)} aria-label="Optionen" title="Optionen">
						<Settings2 size={18} />
					</button>
				}
			/>

			{showOptions && (
				<div className="card stack" style={{ gap: 12 }}>
					<div className="row between">
						<div>
							<b className="small">Hintergrund entfernen</b>
							<div className="tiny muted">Läuft auf deinem Gerät.</div>
						</div>
						<Switch label="Hintergrund entfernen" on={bg} onChange={setRemoveBg} />
					</div>
					<div className="row between">
						<div>
							<b className="small">Foto verbessern</b>
							<div className="tiny muted">Heller, mehr Kontrast, Struktur sichtbar.</div>
						</div>
						<Switch label="Foto verbessern" on={enhance} onChange={setEnhance} />
					</div>
				</div>
			)}

			{entries.length === 0 && (
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
					<div className="hand" style={{ fontSize: "1.9rem" }}>
						Fotografiere deine Teile
					</div>
					<p className="small muted" style={{ margin: "4px 0 0" }}>
						Flach hinlegen, ganzes Teil im Bild, ruhiger Untergrund. Egal wie herum – {aiOn ? "die KI dreht es richtig und sortiert es ein" : "du kannst es danach drehen"}.
					</p>
					<div className="stack" style={{ marginTop: 16, gap: 10, alignItems: "stretch" }}>
						<button className="btn primary" onClick={() => cameraInput.current?.click()}>
							<Camera size={18} /> Foto aufnehmen
						</button>
						<button className="btn" onClick={() => libraryInput.current?.click()}>
							<ImagePlus size={18} /> Mehrere aus Fotos wählen
						</button>
					</div>
					{!aiOn && (
						<p className="tiny muted" style={{ marginTop: 14 }}>
							<Sparkles size={13} style={{ verticalAlign: "-2px" }} /> Mit einer KI werden Name, Kategorie, Farben und Material automatisch erkannt. <Link href="/einstellungen">KI einrichten</Link>
						</p>
					)}
				</div>
			)}

			<input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
			<input ref={libraryInput} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />

			{entries.length > 0 && (
				<>
					<div className="row between">
						<span className="small muted">
							{working ? `${entries.filter((e) => e.status !== "wait" && e.status !== "processing").length} von ${entries.length} freigestellt …` : `${ready.length} ${ready.length === 1 ? "Teil" : "Teile"} bereit`}
							{aiOn ? " · Kategorie & Name macht die KI" : ""}
						</span>
						<div className="row" style={{ gap: 6 }}>
							<button className="icon-btn" onClick={() => cameraInput.current?.click()} aria-label="Weiteres Foto aufnehmen" disabled={saving}>
								<Camera size={17} />
							</button>
							<button className="icon-btn" onClick={() => libraryInput.current?.click()} aria-label="Weitere Fotos wählen" disabled={saving}>
								<ImagePlus size={17} />
							</button>
						</div>
					</div>
					<div className="add-grid">
						{entries.map((e) => (
							<AddCard
								key={e.id}
								entry={e}
								aiOn={aiOn}
								disabled={saving}
								onRotate={() => update(e.id, { rotate: (e.rotate + 90) % 360 })}
								onRemove={() => setEntries((list) => list.filter((x) => x.id !== e.id))}
								onRetry={() => update(e.id, { status: "wait", error: undefined })}
								onCategory={(category) => update(e.id, { category })}
							/>
						))}
					</div>
					<div className="add-bar">
						<button className="btn primary block" onClick={() => void saveAll()} disabled={!ready.length || saving || working}>
							{saving ? <span className="spinner" /> : null}
							{working ? "Wird freigestellt …" : saving ? "Wird gespeichert …" : `${ready.length} ${ready.length === 1 ? "Teil" : "Teile"} in den Schrank`}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function AddCard({
	entry: e,
	aiOn,
	disabled,
	onRotate,
	onRemove,
	onRetry,
	onCategory,
}: {
	entry: Entry;
	aiOn: boolean;
	disabled: boolean;
	onRotate: () => void;
	onRemove: () => void;
	onRetry: () => void;
	onCategory: (c: CategoryKey | "") => void;
}) {
	const done = e.status === "ready" || e.status === "saving" || e.status === "saved";
	return (
		<div className={`add-card ${e.status}`}>
			<div className="add-preview checker">
				{done && e.processed ? (
					<img src={e.processed.preview} alt="" style={{ transform: e.rotate ? `rotate(${e.rotate}deg)` : undefined }} />
				) : e.status === "error" ? (
					<div className="stack" style={{ alignItems: "center", padding: 10, textAlign: "center", gap: 6 }}>
						<TriangleAlert size={20} color="var(--danger)" />
						<span className="tiny">{e.error}</span>
						<button className="btn small" onClick={onRetry}>
							Nochmal
						</button>
					</div>
				) : (
					<div className="stack" style={{ alignItems: "center", gap: 8, width: "80%" }}>
						<span className="spinner" />
						<span className="tiny muted" style={{ textAlign: "center" }}>
							{e.status === "processing" && e.stage ? STAGE_LABEL[e.stage] : "Wartet …"}
						</span>
						{e.status === "processing" && e.pct > 0 && e.pct < 1 && (
							<div className="progress" style={{ width: "100%" }}>
								<i style={{ width: `${Math.round(e.pct * 100)}%` }} />
							</div>
						)}
					</div>
				)}
				{e.status === "saving" && (
					<div className="add-overlay">
						<span className="spinner" />
					</div>
				)}
				<button className="add-x" onClick={onRemove} aria-label="Entfernen" disabled={disabled}>
					<X size={15} />
				</button>
				{done && (
					<button className="add-rotate" onClick={onRotate} aria-label="Drehen" disabled={disabled}>
						<RotateCw size={16} />
					</button>
				)}
			</div>
			<select className="add-cat" value={e.category} onChange={(ev) => onCategory(ev.target.value as CategoryKey | "")} disabled={disabled} aria-label="Kategorie">
				<option value="">{aiOn ? "Kategorie: KI erkennt" : "Kategorie wählen"}</option>
				{CATEGORIES.map((c) => (
					<option key={c.key} value={c.key}>
						{c.singular}
					</option>
				))}
			</select>
		</div>
	);
}
