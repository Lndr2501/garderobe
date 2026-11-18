import { ArrowLeft, Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import type { ItemInput } from "../../shared/types.ts";
import { api, imgUrl, uploadImage } from "../api.ts";
import { ItemForm } from "../components/ItemForm.tsx";
import { PageHead } from "../components/Layout.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { processImage } from "../lib/image.ts";
import { useItems, useSaveItem, useSettings } from "../queries.ts";

export function ItemEdit() {
	const { id } = useParams<{ id: string }>();
	const { data: items } = useItems();
	const { data: settings } = useSettings();
	const item = items?.find((i) => i.id === id);
	const [draft, setDraft] = useState<ItemInput | null>(null);
	const [aiBusy, setAiBusy] = useState(false);
	const [photoBusy, setPhotoBusy] = useState("");
	const save = useSaveItem();
	const toast = useToast();
	const [, navigate] = useLocation();
	const frontInput = useRef<HTMLInputElement>(null);
	const backInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (item && !draft) {
			const { id: _id, createdAt: _c, updatedAt: _u, wearCount: _w, lastWorn: _l, ...rest } = item;
			setDraft(rest);
		}
	}, [item, draft]);

	if (!item || !draft) return <div className="container page"><div className="spinner" /></div>;

	const aiFill = async () => {
		const key = draft.thumbFront ?? draft.imageFront;
		if (!key) return toast("Kein Foto vorhanden", "error");
		setAiBusy(true);
		try {
			const blob = await (await fetch(imgUrl(key)!)).blob();
			const p = await processImage(blob, { removeBg: false, quality: "fast" });
			const tags = await api<ItemInput>("/api/ai/tag", { method: "POST", body: { image: p.ai } });
			setDraft((d) => ({ ...d, ...tags, name: tags.name || d?.name }));
			toast("KI-Vorschläge übernommen – kurz prüfen", "ok");
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setAiBusy(false);
		}
	};

	const replacePhoto = async (file: File | undefined, side: "front" | "back") => {
		if (!file) return;
		setPhotoBusy(side);
		try {
			const p = await processImage(file, { removeBg: settings?.bgRemoval.enabled ?? true, quality: settings?.bgRemoval.quality ?? "best" });
			const [full, thumb] = await Promise.all([uploadImage(p.full), uploadImage(p.thumb)]);
			setDraft((d) => (side === "front" ? { ...d, imageFront: full, thumbFront: thumb, colorHex: p.colorHex } : { ...d, imageBack: full, thumbBack: thumb }));
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setPhotoBusy("");
		}
	};

	const submit = () =>
		save.mutate(
			{ id: item.id, data: { ...draft, needsReview: false } },
			{
				onSuccess: () => {
					toast("Gespeichert", "ok");
					navigate(`/teil/${item.id}`, { replace: true });
				},
				onError: (e) => toast(errorText(e), "error"),
			},
		);

	return (
		<div className="container page">
			<PageHead
				title="Bearbeiten"
				left={
					<button className="icon-btn" onClick={() => history.back()} aria-label="Zurück">
						<ArrowLeft size={18} />
					</button>
				}
				right={
					<button className="btn primary" onClick={submit} disabled={save.isPending}>
						Speichern
					</button>
				}
			/>
			<div className="two-col">
				<div className="card stack">
					<div className="grid grid-2">
						{(["front", "back"] as const).map((side) => {
							const key = side === "front" ? (draft.thumbFront ?? draft.imageFront) : (draft.thumbBack ?? draft.imageBack);
							return (
								<div key={side} className="stack" style={{ gap: 6 }}>
									<div className="checker" style={{ aspectRatio: "1", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
										{photoBusy === side ? <div className="spinner" /> : key ? <img src={imgUrl(key)} alt="" style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }} /> : <span className="small faint">keins</span>}
									</div>
									<button className="btn small" disabled={!!photoBusy} onClick={() => (side === "front" ? frontInput : backInput).current?.click()}>
										<Camera size={14} /> {side === "front" ? "Vorderseite" : "Rückseite"}
									</button>
								</div>
							);
						})}
					</div>
					<input ref={frontInput} type="file" accept="image/*" hidden onChange={(e) => void replacePhoto(e.target.files?.[0], "front")} />
					<input ref={backInput} type="file" accept="image/*" hidden onChange={(e) => void replacePhoto(e.target.files?.[0], "back")} />
				</div>
				<div className="card">
					<ItemForm value={draft} onChange={setDraft} onAiFill={settings?.ai.configured ? aiFill : undefined} aiBusy={aiBusy} currency={settings?.currency} />
				</div>
			</div>
			<button className="btn primary block" onClick={submit} disabled={save.isPending}>
				Speichern
			</button>
		</div>
	);
}
