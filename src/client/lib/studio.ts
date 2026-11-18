// Client side of the AI studio pictures: which picture to show, starting a picture, and the
// finishing step (background removal runs in the browser, the server can't decode images).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { LOCAL_FLUX_PROVIDER, type Item, type StudioMode } from "../../shared/types.ts";
import { api, imgUrl, uploadImage } from "../api.ts";
import { keys, useItems, useSettings } from "../queries.ts";
import { aiJpeg, loadCanvas, processImage } from "./image.ts";

/** Front picture to show: the studio picture unless the user prefers the own photo. */
export function frontKey(item: Item, size: "thumb" | "full" = "thumb"): string | null {
	if (!item.preferOriginal && hasStudio(item)) {
		return size === "full" ? (item.imageStudio ?? item.thumbStudio) : (item.thumbStudio ?? item.imageStudio);
	}
	return size === "full" ? (item.imageFront ?? item.thumbFront) : (item.thumbFront ?? item.imageFront);
}

export function hasStudio(item: Item): boolean {
	// A local PNG without its thumbnail predates the cutout step. Keep showing
	// the original while the old render is upgraded rather than flashing its rectangle.
	return !!item.thumbStudio;
}

/** Being made right now (or waiting for the daily allowance / the finishing step). */
export function studioBusy(item: Item): boolean {
	return item.studioState === "queued" || item.studioState === "waiting" || item.studioState === "running" || item.studioState === "raw";
}

export function studioStatusText(item: Item): string {
	switch (item.studioState) {
		case "queued":
			return "Studio-Bild ist in der Warteschlange";
		case "running":
			return "Studio-Bild wird erstellt …";
		case "waiting":
			return "Studio-Bild wartet aufs Gratis-Kontingent von morgen";
		case "raw":
			return "Studio-Bild wird freigestellt …";
		case "failed":
			return `Studio-Bild fehlgeschlagen${item.studioError ? `: ${item.studioError}` : ""}`;
		default:
			return "";
	}
}

/** Original mode uses the exact stored photo. Only the optional redraw needs a helper upload. */
export async function startStudio(item: Item, mode: StudioMode): Promise<Item> {
	const key = item.imageFront ?? item.thumbFront;
	if (!key) throw new Error("Kein Foto vorhanden");
	const path = `/api/items/${item.id}/studio`;
	if (mode === "original") return api<Item>(path, { method: "POST", body: { mode } });
	const canvas = await loadCanvas(imgUrl(key)!, 1600);
	// ≤768 px keeps the reference at two 512² tiles (cheaper) and is plenty for the model.
	const image = await uploadImage(await aiJpeg(canvas, 768));
	return api<Item>(path, { method: "POST", body: { image, mode } });
}

const finishing = new Set<string>();
const starting = new Set<string>();

/**
 * Runs wherever the app is open:
 * - removes the background of freshly generated studio pictures and stores them,
 * - in auto mode queues a studio picture for pieces that don't have one yet.
 */
export function useStudioWork(): void {
	const { data: items } = useItems();
	const { data: settings } = useSettings();
	const qc = useQueryClient();
	const put = (saved: Item) => qc.setQueryData<Item[]>(keys.items, (old) => old?.map((x) => (x.id === saved.id ? saved : x)));
	const quality = settings?.bgRemoval.quality ?? "best";
	const auto = !!settings?.ai.studio.auto && !!settings?.ai.areas.studio;
	const mode = settings?.ai.routes.studio.provider === LOCAL_FLUX_PROVIDER ? "original" : "render";

	useEffect(() => {
		const todo = (items ?? []).filter((i) => i.studioState === "raw" && i.studioRaw && !finishing.has(i.id));
		if (!todo.length) return;
		for (const i of todo) finishing.add(i.id);
		void (async () => {
			for (const item of todo) {
				try {
					const raw = item.studioRaw!;
					const response = await fetch(imgUrl(raw)!, { credentials: "same-origin" });
					if (!response.ok) throw new Error("Studio-Bild konnte nicht geladen werden.");
					const p = await processImage(await response.blob(), { removeBg: true, quality, enhance: false });
					URL.revokeObjectURL(p.preview);
					if (!p.alpha) throw new Error("Das Studio-Bild konnte nicht freigestellt werden.");
					const [imageStudio, thumbStudio] = await Promise.all([uploadImage(p.full), uploadImage(p.thumb)]);
					put(await api<Item>(`/api/items/${item.id}/studio/done`, { method: "POST", body: { imageStudio, thumbStudio, raw } }));
				} catch (err) {
					console.warn("studio finishing failed", item.id, err);
				} finally {
					finishing.delete(item.id);
				}
			}
		})();
	}, [items, quality]);

	useEffect(() => {
		if (!auto) return;
		const todo = (items ?? []).filter(
			(i) =>
				i.status === "active" &&
				i.studioState === "" &&
				(i.imageFront || i.thumbFront) &&
				i.aiState !== "pending" &&
				!i.rotate &&
				!starting.has(i.id),
		);
		if (!todo.length) return;
		for (const i of todo) starting.add(i.id);
		void (async () => {
			for (const item of todo) {
				try {
					put(await startStudio(item, mode));
				} catch (err) {
					console.warn("studio start failed", item.id, err);
				}
			}
		})();
	}, [items, auto, mode]);
}
