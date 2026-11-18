import { Camera, ImagePlus, RotateCcw, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, Scale } from "lucide-react";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { CATEGORIES, categoryDef, colorDef } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { ChipSelect, ColorSelect } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { AiWait } from "../components/AiWait.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { nearestColorKey, prepareImage } from "../lib/image.ts";
import { useItemMap, useSettings, useShoppingCheck } from "../queries.ts";

const VERDICT = {
	kaufen: { label: "Kaufen!", icon: ThumbsUp, bg: "var(--ok)", fg: "#fff" },
	überlegen: { label: "Überleg's dir", icon: Scale, bg: "var(--warn)", fg: "#1b1b1b" },
	lassen: { label: "Lieber lassen", icon: ThumbsDown, bg: "var(--danger)", fg: "#fff" },
} as const;

async function averageColor(dataUrl: string): Promise<string | null> {
	try {
		const img = new Image();
		img.src = dataUrl;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = 48;
		c.height = 48;
		const ctx = c.getContext("2d")!;
		// center crop – the product is usually in the middle of the photo
		const s = Math.min(img.naturalWidth, img.naturalHeight) * 0.5;
		ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 48, 48);
		const d = ctx.getImageData(0, 0, 48, 48).data;
		let r = 0;
		let g = 0;
		let b = 0;
		const n = d.length / 4;
		for (let i = 0; i < d.length; i += 4) {
			r += d[i]!;
			g += d[i + 1]!;
			b += d[i + 2]!;
		}
		const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
		return nearestColorKey(`#${hex(r)}${hex(g)}${hex(b)}`);
	} catch {
		return null;
	}
}

function Thumbs({ ids, map, empty }: { ids: string[]; map: Map<string, Item>; empty: string }) {
	const [, navigate] = useLocation();
	const list = ids.map((id) => map.get(id)).filter((x): x is Item => !!x);
	if (!list.length) return <div className="small muted">{empty}</div>;
	return (
		<div className="thumb-strip">
			{list.map((i) => (
				<button key={i.id} className="tile" style={{ width: 104, flex: "0 0 auto" }} onClick={() => navigate(`/teil/${i.id}`)}>
					<div className="img">
						<ItemImage item={i} />
					</div>
					<div className="t-name">{i.name}</div>
				</button>
			))}
		</div>
	);
}

export function Shopping() {
	const { data: settings } = useSettings();
	const aiOn = !!settings?.ai.areas.vision;
	const map = useItemMap();
	const check = useShoppingCheck();
	const toast = useToast();
	const camRef = useRef<HTMLInputElement>(null);
	const libRef = useRef<HTMLInputElement>(null);
	const [image, setImage] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [category, setCategory] = useState<string[]>([]);
	const [colors, setColors] = useState<string[]>([]);
	const result = check.data;

	const onFile = async (f: File | undefined) => {
		if (!f) return;
		try {
			const { dataUrl } = await prepareImage(f, 1024);
			setImage(dataUrl);
			check.reset();
			if (!colors.length) {
				const c = await averageColor(dataUrl);
				if (c) setColors([c]);
			}
		} catch (e) {
			toast(errorText(e), "error");
		}
	};

	const run = () => {
		if (aiOn && !image) return toast("Mach zuerst ein Foto vom Teil", "error");
		if (!aiOn && !category.length) return toast("Wähle eine Kategorie", "error");
		check.mutate(
			aiOn ? { image: image ?? undefined, note } : { category: category[0], colors },
			{ onError: (e) => toast(errorText(e), "error") },
		);
	};

	const v = result ? VERDICT[result.verdict] : null;

	return (
		<div className="container page" style={{ maxWidth: 820 }}>
			<PageHead title="Shopping-Check" />
			<div className="row" style={{ alignItems: "flex-start" }}>
				<ShoppingBag size={22} style={{ flex: "0 0 auto", marginTop: 2 }} />
				<p className="small muted" style={{ margin: 0 }}>
					Im Laden unsicher? Foto machen – die App vergleicht mit deinem Schrank: Hast du so etwas schon, und womit könntest du es kombinieren?
				</p>
			</div>

			<div className="card stack">
				{image ? (
					<div className="row" style={{ alignItems: "flex-start" }}>
						<img src={image} alt="Kandidat" style={{ width: 120, height: 150, objectFit: "cover", borderRadius: 14 }} />
						<div className="stack grow" style={{ gap: 8 }}>
							<button className="btn small" onClick={() => camRef.current?.click()}>
								<Camera size={15} /> Neues Foto
							</button>
							<button
								className="btn small ghost"
								onClick={() => {
									setImage(null);
									check.reset();
								}}
							>
								<RotateCcw size={15} /> Entfernen
							</button>
						</div>
					</div>
				) : (
					<div className="drop-zone stack" style={{ alignItems: "center" }}>
						<Camera size={28} />
						<b>Foto vom Teil</b>
						<div className="row wrap" style={{ justifyContent: "center" }}>
							<button className="btn primary" onClick={() => camRef.current?.click()}>
								<Camera size={16} /> Kamera
							</button>
							<button className="btn" onClick={() => libRef.current?.click()}>
								<ImagePlus size={16} /> Mediathek
							</button>
						</div>
						{!aiOn && <span className="tiny muted">Ohne KI optional – dann nur zur Farberkennung.</span>}
					</div>
				)}
				<input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
				<input ref={libRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />

				{aiOn ? (
					<label className="field">
						<span>Notiz (optional)</span>
						<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="z.B. 89 €, Wolle, für den Winter" />
					</label>
				) : (
					<>
						<div className="field">
							<span>Kategorie</span>
							<ChipSelect options={CATEGORIES.map((c) => ({ key: c.key as string, label: c.label }))} value={category} onChange={setCategory} />
						</div>
						<div className="field">
							<span>Farbe</span>
							<ColorSelect value={colors} onChange={setColors} />
						</div>
					</>
				)}
				<button className="btn primary block" onClick={run} disabled={check.isPending}>
					{check.isPending ? <span className="spinner" /> : <Sparkles size={17} />} {check.isPending ? "Vergleiche mit deinem Schrank …" : "Prüfen"}
				</button>
				{check.isPending && <AiWait since={check.submittedAt || null} label="KI vergleicht" />}
			</div>

			{result && v && (
				<div className="card stack">
					<div className="row between wrap">
						<span className="verdict" style={{ background: v.bg, color: v.fg }}>
							<v.icon size={20} /> {v.label}
						</span>
						<span className="badge">{result.source === "ai" ? "KI" : "Regeln"}</span>
					</div>
					<div>
						<b>{result.name}</b>
						<div className="small muted">
							{categoryDef(result.category)?.label ?? result.category}
							{result.colors.length > 0 && ` · ${result.colors.map((c) => colorDef(c)?.label ?? c).join(", ")}`}
						</div>
					</div>
					{result.reasoning && <p style={{ margin: 0 }}>{result.reasoning}</p>}
					<div className="section-title">
						<h2>Hast du schon ähnlich</h2>
					</div>
					<Thumbs ids={result.similarIds} map={map} empty="Nichts Vergleichbares – das wäre neu in deinem Schrank." />
					<div className="section-title">
						<h2>Passt gut zu</h2>
					</div>
					<Thumbs ids={result.pairsWithIds} map={map} empty="Keine passenden Kombi-Partner gefunden." />
				</div>
			)}
		</div>
	);
}
