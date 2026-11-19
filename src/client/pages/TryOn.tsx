import { Camera, Download, Plus, Sparkles, Trash2, UserRound, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { LOCAL_FLUX_PROVIDER, type Item, type TryOn } from "../../shared/types.ts";
import { api, imgUrl, uploadImage } from "../api.ts";
import { Holo } from "../components/Holo.tsx";
import { Segmented } from "../components/Inputs.tsx";
import { ItemImage } from "../components/ItemImage.tsx";
import { ItemPicker } from "../components/ItemPicker.tsx";
import { PageHead } from "../components/Layout.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { errorText, useToast } from "../components/Toast.tsx";
import { prepareImage } from "../lib/image.ts";
import { useLocal } from "../lib/useLocal.ts";
import { keys, useActiveItems, useItemMap, useSaveSettings, useSettings, useTryons } from "../queries.ts";
import { SLOTS, SlotRows, selectionFromIds } from "./OutfitBuilder.tsx";
import { useQueryClient } from "@tanstack/react-query";

type Selection = ReturnType<typeof selectionFromIds>;

export function TryOnPage() {
	const search = new URLSearchParams(useSearch());
	const initialIds = useMemo(() => (search.get("ids") ?? "").split(",").filter(Boolean), [search.toString()]);
	const [tab, setTab] = useLocal<"avatar" | "ai">("gd-tryon-tab", "avatar");
	return (
		<div className="container page">
			<PageHead title="Anprobe" />
			<Segmented
				options={[
					{ key: "avatar", label: "Avatar" },
					{ key: "ai", label: "KI-Anprobe" },
				]}
				value={tab}
				onChange={setTab}
			/>
			{tab === "avatar" ? <AvatarTab initialIds={initialIds} /> : <AiTab initialIds={initialIds} />}
		</div>
	);
}

function AvatarTab({ initialIds }: { initialIds: string[] }) {
	const items = useActiveItems();
	const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
	const [sel, setSel] = useState<Selection>({});
	const [init, setInit] = useState(false);
	useEffect(() => {
		if (init || !items.length) return;
		setSel(selectionFromIds(initialIds, map));
		setInit(true);
	}, [init, items, initialIds, map]);
	const chosen = SLOTS.map((s) => sel[s.key])
		.filter((x): x is string => !!x)
		.map((id) => map.get(id))
		.filter((x): x is Item => !!x);
	return (
		<div className="two-col">
			<div className="stack">
				<div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>
					<Holo items={chosen} />
				</div>
				<div className="tiny muted" style={{ textAlign: "center" }}>
					Zum Drehen ziehen. Am besten wirken freigestellte Fotos.
				</div>
				{chosen.length > 0 && (
					<Link href={`/outfits/neu?ids=${chosen.map((c) => c.id).join(",")}`} className="btn" style={{ alignSelf: "center" }}>
						<Plus size={16} /> Als Outfit speichern
					</Link>
				)}
			</div>
			<div className="card">{items.length ? <SlotRows items={items} sel={sel} setSel={setSel} /> : <div className="empty">Noch keine Teile im Schrank.</div>}</div>
		</div>
	);
}

function AiTab({ initialIds }: { initialIds: string[] }) {
	const { data: settings } = useSettings();
	const saveSettings = useSaveSettings();
	const { data: tryons } = useTryons();
	const map = useItemMap();
	const qc = useQueryClient();
	const toast = useToast();
	const fileRef = useRef<HTMLInputElement>(null);
	const [ids, setIds] = useState<string[]>(initialIds.slice(0, 5));
	const [picker, setPicker] = useState(false);
	const [busy, setBusy] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [view, setView] = useState<TryOn | null>(null);
	const aiOn = !!settings?.ai.areas.tryon;
	const local = settings?.ai.routes.tryon.provider === LOCAL_FLUX_PROVIDER;
	const maxItems = local ? 2 : 5;
	const selected = ids.slice(0, maxItems);
	const chosen = selected.map((id) => map.get(id)).filter((x): x is Item => !!x);

	const uploadPerson = async (f: File | undefined) => {
		if (!f) return;
		setUploading(true);
		try {
			const { blob } = await prepareImage(f, 1536);
			const key = await uploadImage(blob);
			await saveSettings.mutateAsync({ personPhoto: key });
			toast("Foto gespeichert", "ok");
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setUploading(false);
		}
	};

	const run = async () => {
		setBusy(true);
		try {
			const t = await api<TryOn>("/api/ai/tryon", { method: "POST", body: { itemIds: selected } });
			await qc.invalidateQueries({ queryKey: keys.tryons });
			setView(t);
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (t: TryOn) => {
		await api(`/api/tryons/${t.id}`, { method: "DELETE" });
		await qc.invalidateQueries({ queryKey: keys.tryons });
		setView(null);
	};

	if (settings && !aiOn) {
		return (
			<div className="card stack">
				<Wand2 size={26} />
				<b>KI-Anprobe braucht ein Bildmodell</b>
				<span className="small muted">
					Wähle in den Einstellungen unter „KI“ für „Anprobe“ einen Anbieter mit Bildmodell – z.B. FLUX.2 Klein 9B lokal auf deinem Mac, Cloudflare mit FLUX.2 (Gratis-Kontingent), <code>gpt-image-1</code> über <code>/images/edits</code> oder ein Chat-Modell mit Bildausgabe im Modus „Chat“.
				</span>
				<Link href="/einstellungen" className="btn primary" style={{ alignSelf: "flex-start" }}>
					Einstellungen öffnen
				</Link>
			</div>
		);
	}

	return (
		<div className="stack">
			<div className="two-col">
				<div className="card stack">
					<div className="section-title">
						<h2>1 · Dein Foto</h2>
					</div>
					{settings?.personPhoto ? (
						<div className="row" style={{ alignItems: "flex-start" }}>
							<img src={imgUrl(settings.personPhoto)} alt="Dein Foto" style={{ width: 110, height: 160, objectFit: "cover", borderRadius: 14 }} />
							<div className="stack" style={{ gap: 8 }}>
								<button className="btn small" onClick={() => fileRef.current?.click()} disabled={uploading}>
									<Camera size={15} /> Ersetzen
								</button>
								<button className="btn small ghost" onClick={() => saveSettings.mutate({ personPhoto: null })}>
									<Trash2 size={15} /> Löschen
								</button>
							</div>
						</div>
					) : (
						<div className="drop-zone stack" style={{ alignItems: "center" }}>
							<UserRound size={28} />
							<span className="small">Ganzkörperfoto, frontal, gutes Licht, enge Kleidung.</span>
							<button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
								{uploading ? <span className="spinner" /> : <Camera size={16} />} Foto hochladen
							</button>
						</div>
					)}
					<input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void uploadPerson(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
					<span className="tiny muted">{local ? "Lokale Anprobe: Dein Foto und die Teile werden nur auf deinem Mac verarbeitet." : "Für diese Anprobe wird dein Foto an den eingestellten KI-Anbieter geschickt."}</span>
				</div>
				<div className="card stack">
					<div className="section-title">
						<h2>2 · Teile (max. {maxItems})</h2>
					</div>
					{chosen.length > 0 ? (
						<div className="thumb-strip">
							{chosen.map((i) => (
								<span key={i.id} className="thumb" style={{ width: 72, height: 72 }}>
									<ItemImage item={i} />
								</span>
							))}
						</div>
					) : (
						<div className="small muted">Noch nichts gewählt.</div>
					)}
					<button className="btn" onClick={() => setPicker(true)}>
						<Plus size={16} /> Teile wählen
					</button>
					<button className="btn primary block" onClick={() => void run()} disabled={busy || !chosen.length || !settings?.personPhoto}>
						{busy ? <span className="spinner" /> : <Sparkles size={17} />} {busy ? "Wird anprobiert …" : "Anprobieren"}
					</button>
				</div>
			</div>

			{tryons && tryons.length > 0 && (
				<section>
					<div className="section-title">
						<h2>Bisherige Anproben</h2>
					</div>
					<div className="grid grid-items">
						{tryons.map((t) => (
							<button key={t.id} className="tile" onClick={() => setView(t)}>
								<div className="img" style={{ aspectRatio: "3 / 4" }}>
									<img src={imgUrl(t.image)} alt="Anprobe" loading="lazy" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
								</div>
								<div className="t-name">
									{t.itemIds
										.map((id) => map.get(id)?.name)
										.filter(Boolean)
										.join(", ") || "Anprobe"}
								</div>
							</button>
						))}
					</div>
				</section>
			)}

			{picker && (
				<ItemPicker
					title="Teile anprobieren"
					initial={selected}
					max={maxItems}
					onClose={() => setPicker(false)}
					onDone={(sel) => {
						setIds(sel.slice(0, maxItems));
						setPicker(false);
					}}
				/>
			)}
			{view && (
				<Sheet title="Anprobe" onClose={() => setView(null)}>
					<div className="stack">
						<img src={imgUrl(view.image)} alt="Anprobe" style={{ width: "100%", borderRadius: 16 }} />
						<div className="row wrap">
							<a className="btn" href={imgUrl(view.image)} download={`anprobe-${view.id.slice(0, 8)}.png`}>
								<Download size={16} /> Sichern
							</a>
							<button className="btn danger" onClick={() => void remove(view)}>
								<Trash2 size={16} /> Löschen
							</button>
						</div>
					</div>
				</Sheet>
			)}
		</div>
	);
}
