import { Eraser, Hand, RotateCcw, Sparkles, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "../../shared/types.ts";
import { imgUrl, uploadImage } from "../api.ts";
import { autoEnhance, cloneCanvas, encodePair, hasTransparency, loadCanvas, refineAlpha, trimTransparent } from "../lib/image.ts";
import { useSaveItem } from "../queries.ts";
import { Switch } from "./Inputs.tsx";
import { Sheet } from "./Sheet.tsx";
import { errorText, useToast } from "./Toast.tsx";

interface Stroke {
	size: number;
	points: [number, number][];
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, from = 0) {
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.lineWidth = s.size;
	ctx.strokeStyle = "#000";
	ctx.fillStyle = "#000";
	const pts = s.points;
	if (pts.length === 1 || from >= pts.length - 1) {
		const [x, y] = pts[pts.length - 1]!;
		ctx.beginPath();
		ctx.arc(x, y, s.size / 2, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.beginPath();
		ctx.moveTo(...pts[Math.max(0, from)]!);
		for (let i = Math.max(1, from + 1); i < pts.length; i++) ctx.lineTo(...pts[i]!);
		ctx.stroke();
	}
	ctx.restore();
}

/** Eraser + auto-fix for a stored item photo. Saves a new image pair and replaces the old one. */
export function ImageEditor({ item, side, onClose }: { item: Item; side: "front" | "back"; onClose: () => void }) {
	const key = side === "back" ? (item.imageBack ?? item.thumbBack) : (item.imageFront ?? item.thumbFront);
	const view = useRef<HTMLCanvasElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const base = useRef<HTMLCanvasElement | null>(null);
	const work = useRef<HTMLCanvasElement | null>(null);
	const strokes = useRef<Stroke[]>([]);
	const drawing = useRef<Stroke | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const [alpha, setAlpha] = useState(true);
	const [brush, setBrush] = useState(28);
	const [zoom, setZoom] = useState(1);
	const [mode, setMode] = useState<"erase" | "move">("erase");
	const [enhance, setEnhance] = useState(false);
	const [smooth, setSmooth] = useState(false);
	const [count, setCount] = useState(0);
	const [fitW, setFitW] = useState(0);
	const [saving, setSaving] = useState(false);
	const save = useSaveItem();
	const toast = useToast();

	const render = useCallback(() => {
		const w = work.current;
		const v = view.current;
		if (!w || !v) return;
		let out = w;
		if (smooth || enhance) {
			out = cloneCanvas(w);
			if (smooth && alpha) refineAlpha(out);
			if (enhance) autoEnhance(out, alpha);
		}
		v.width = out.width;
		v.height = out.height;
		const ctx = v.getContext("2d")!;
		ctx.clearRect(0, 0, v.width, v.height);
		ctx.drawImage(out, 0, 0);
	}, [smooth, enhance, alpha]);

	useEffect(() => {
		if (!key) return;
		let alive = true;
		loadCanvas(imgUrl(key)!, 1600)
			.then((c) => {
				if (!alive) return;
				base.current = c;
				work.current = cloneCanvas(c);
				setAlpha(hasTransparency(c));
				setReady(true);
			})
			.catch((e) => alive && setError(errorText(e)));
		return () => {
			alive = false;
		};
	}, [key]);

	useEffect(() => {
		if (ready) render();
	}, [ready, render]);

	// Fit the image into the stage (width and half the screen height); zoom multiplies that.
	useEffect(() => {
		if (!ready) return;
		const fit = () => {
			const st = scroller.current;
			const w = work.current;
			if (!st || !w) return;
			const maxH = window.innerHeight * 0.5;
			setFitW(Math.floor(Math.min(st.clientWidth, (maxH * w.width) / w.height)));
		};
		fit();
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, [ready]);

	const rebuild = () => {
		if (!base.current) return;
		const w = cloneCanvas(base.current);
		const ctx = w.getContext("2d")!;
		for (const s of strokes.current) drawStroke(ctx, s);
		work.current = w;
		setCount(strokes.current.length);
		render();
	};

	const toCanvasXY = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
		const v = view.current!;
		const r = v.getBoundingClientRect();
		return [((e.clientX - r.left) / r.width) * v.width, ((e.clientY - r.top) / r.height) * v.height];
	};

	const scaleFactor = () => {
		const v = view.current;
		if (!v) return 1;
		return v.width / v.getBoundingClientRect().width;
	};

	const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (mode !== "erase" || !ready) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const stroke: Stroke = { size: brush * scaleFactor(), points: [toCanvasXY(e)] };
		drawing.current = stroke;
		// Draw on the visible canvas right away; the clean version is rebuilt on release.
		drawStroke(view.current!.getContext("2d")!, stroke);
		drawStroke(work.current!.getContext("2d")!, stroke);
	};

	const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const s = drawing.current;
		if (!s) return;
		e.preventDefault();
		const events = "getCoalescedEvents" in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
		const from = s.points.length - 1;
		if (events.length) {
			const v = view.current!;
			const r = v.getBoundingClientRect();
			for (const ev of events) s.points.push([((ev.clientX - r.left) / r.width) * v.width, ((ev.clientY - r.top) / r.height) * v.height]);
		} else s.points.push(toCanvasXY(e));
		drawStroke(view.current!.getContext("2d")!, s, from);
		drawStroke(work.current!.getContext("2d")!, s, from);
	};

	const onUp = () => {
		const s = drawing.current;
		if (!s) return;
		drawing.current = null;
		strokes.current.push(s);
		setCount(strokes.current.length);
		if (smooth || enhance) render();
	};

	const undo = () => {
		strokes.current.pop();
		rebuild();
	};

	const reset = () => {
		strokes.current = [];
		setEnhance(false);
		setSmooth(false);
		rebuild();
	};

	const changed = count > 0 || enhance || smooth;

	const submit = async () => {
		if (!work.current || !changed) return;
		setSaving(true);
		try {
			let out = cloneCanvas(work.current);
			if (smooth && alpha) refineAlpha(out);
			if (enhance) autoEnhance(out, alpha);
			const hasAlphaNow = alpha || count > 0;
			if (hasAlphaNow) out = trimTransparent(out, 0.03);
			const pair = await encodePair(out, hasAlphaNow);
			const [full, thumb] = await Promise.all([uploadImage(pair.full), uploadImage(pair.thumb)]);
			await save.mutateAsync({
				id: item.id,
				data: side === "back" ? { imageBack: full, thumbBack: thumb } : { imageFront: full, thumbFront: thumb },
			});
			toast("Bild gespeichert", "ok");
			onClose();
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Sheet title={side === "back" ? "Rückseite bearbeiten" : "Bild bearbeiten"} onClose={onClose}>
			<div className="stack" style={{ gap: 12 }}>
				<div className="row wrap" style={{ gap: 6 }}>
					<div className="segmented" role="radiogroup" aria-label="Werkzeug">
						<button role="radio" aria-checked={mode === "erase"} className={mode === "erase" ? "on" : ""} onClick={() => setMode("erase")}>
							<Eraser size={15} /> Radieren
						</button>
						<button role="radio" aria-checked={mode === "move"} className={mode === "move" ? "on" : ""} onClick={() => setMode("move")}>
							<Hand size={15} /> Verschieben
						</button>
					</div>
					<div className="row" style={{ gap: 4, marginLeft: "auto" }}>
						<button className="icon-btn" onClick={() => setZoom((z) => Math.max(1, z - 1))} disabled={zoom <= 1} aria-label="Verkleinern">
							<ZoomOut size={17} />
						</button>
						<span className="small" style={{ minWidth: 28, textAlign: "center" }}>
							{zoom}×
						</span>
						<button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 1))} disabled={zoom >= 4} aria-label="Vergrößern">
							<ZoomIn size={17} />
						</button>
					</div>
				</div>

				<div ref={scroller} className="editor-stage">
					{!ready && !error && (
						<div className="editor-wait">
							<span className="spinner" />
						</div>
					)}
					{error && <div className="editor-wait small">{error}</div>}
					<canvas
						ref={view}
						className={`editor-canvas ${mode}`}
						style={{ width: fitW ? fitW * zoom : undefined, display: ready ? "block" : "none", touchAction: mode === "erase" ? "none" : "auto" }}
						onPointerDown={onDown}
						onPointerMove={onMove}
						onPointerUp={onUp}
						onPointerCancel={onUp}
					/>
				</div>

				<div className="row" style={{ gap: 8 }}>
					<button className="btn small" onClick={undo} disabled={!count || saving}>
						<Undo2 size={15} /> Rückgängig
					</button>
					<button className="icon-btn" onClick={reset} disabled={!changed || saving} aria-label="Zurücksetzen" title="Zurücksetzen">
						<RotateCcw size={16} />
					</button>
					<button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => void submit()} disabled={!changed || saving || !ready}>
						{saving ? <span className="spinner" /> : null} Speichern
					</button>
				</div>
				{mode === "erase" && (
					<label className="row" style={{ gap: 10 }}>
						<span className="small" style={{ minWidth: 70 }}>
							Pinsel
						</span>
						<input type="range" min={6} max={70} value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ flex: 1 }} aria-label="Pinselgröße" />
						<span className="brush-dot" style={{ width: Math.max(6, brush / 2), height: Math.max(6, brush / 2) }} />
					</label>
				)}

				<div className="card row between" style={{ padding: "10px 14px" }}>
					<div>
						<b className="small">
							<Sparkles size={14} style={{ verticalAlign: "-2px" }} /> Foto verbessern
						</b>
						<div className="tiny muted">Heller, mehr Kontrast, schärfer</div>
					</div>
					<Switch label="Foto verbessern" on={enhance} onChange={setEnhance} />
				</div>
				{alpha && (
					<div className="card row between" style={{ padding: "10px 14px" }}>
						<div>
							<b className="small">Ränder glätten</b>
							<div className="tiny muted">Entfernt Krümel und dunkle Säume</div>
						</div>
						<Switch label="Ränder glätten" on={smooth} onChange={setSmooth} />
					</div>
				)}

				<p className="tiny faint" style={{ margin: 0 }}>
					Tipp: Mit „Radieren“ wischst du Bügel, Hände oder Reste vom Hintergrund weg. Zum genauen Arbeiten vergrößern und mit „Verschieben“ an die Stelle gehen.
				</p>
			</div>
		</Sheet>
	);
}
