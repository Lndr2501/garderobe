import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { Item } from "../../shared/types.ts";
import { isRecognizing, neverRecognized, recognitionFailed, retagItem } from "../lib/recognize.ts";
import { useLocal } from "../lib/useLocal.ts";
import { keys, useSettings } from "../queries.ts";
import { ItemImage } from "./ItemImage.tsx";
import { errorText, useToast } from "./Toast.tsx";

function Thumbs({ items, pulse }: { items: Item[]; pulse?: boolean }) {
	return (
		<div className={`thumbs ${pulse ? "pulse" : ""}`}>
			{items.slice(0, 4).map((i) => (
				<span key={i.id}>
					<ItemImage item={i} />
				</span>
			))}
		</div>
	);
}

/** Status of the server-side AI recognition above the racks. */
export function RecognitionStatus({ items }: { items: Item[] }) {
	const { data: settings } = useSettings();
	const qc = useQueryClient();
	const toast = useToast();
	const [busy, setBusy] = useState(false);
	const [hideNever, setHideNever] = useLocal("gd-hide-recognize", false);
	const running = items.filter(isRecognizing);
	const failed = items.filter(recognitionFailed);
	const never = settings?.ai.configured && !hideNever ? items.filter(neverRecognized) : [];

	const retry = async (list: Item[]) => {
		setBusy(true);
		let ok = 0;
		for (const i of list) {
			try {
				await retagItem(i);
				ok++;
			} catch (e) {
				toast(errorText(e), "error");
				break;
			}
		}
		await qc.invalidateQueries({ queryKey: keys.items });
		setBusy(false);
		if (ok) toast(`KI schaut sich ${ok} ${ok === 1 ? "Teil" : "Teile"} an`, "ok");
	};

	return (
		<>
			{running.length > 0 && (
				<div className="card ai-strip" role="status">
					<Thumbs items={running} pulse />
					<div style={{ flex: 1, minWidth: 0 }}>
						<b className="small">
							KI sortiert {running.length} {running.length === 1 ? "Teil" : "Teile"} ein …
						</b>
						<div className="tiny muted">Dauert je nach Anbieter 20 s bis 2 Min. Du kannst die App schliessen.</div>
					</div>
					<span className="spinner" style={{ width: 18, height: 18 }} />
				</div>
			)}
			{failed.length > 0 && (
				<div className="card ai-strip">
					<Thumbs items={failed} />
					<div style={{ flex: 1, minWidth: 0 }}>
						<b className="small">
							<TriangleAlert size={14} style={{ verticalAlign: "-2px", color: "var(--warn)" }} /> {failed.length} {failed.length === 1 ? "Teil" : "Teile"} nicht erkannt
						</b>
						<div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{failed[0]?.aiError || "Die KI hat nicht geantwortet."}
						</div>
					</div>
					<button className="btn small" onClick={() => void retry(failed)} disabled={busy}>
						<RefreshCw size={14} /> Nochmal
					</button>
				</div>
			)}
			{never.length > 0 && (
				<div className="card ai-strip">
					<Thumbs items={never} />
					<div style={{ flex: 1, minWidth: 0 }}>
						<b className="small">
							{never.length} {never.length === 1 ? "Teil" : "Teile"} neu erkennen?
						</b>
						<div className="tiny muted">Neue KI: richtige Kategorie, Name, Farben – und quer liegende Fotos werden gedreht.</div>
					</div>
					<button className="btn small primary" onClick={() => void retry(never)} disabled={busy}>
						<Sparkles size={14} /> Los
					</button>
					<button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setHideNever(true)} aria-label="Ausblenden">
						<X size={14} />
					</button>
				</div>
			)}
		</>
	);
}
