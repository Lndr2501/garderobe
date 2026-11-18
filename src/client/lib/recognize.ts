// Client side of the server-side AI recognition: helper image upload, re-runs and
// applying the rotation the AI found (the worker cannot decode images itself).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Item } from "../../shared/types.ts";
import { api, imgUrl, uploadImage } from "../api.ts";
import { keys, useItems } from "../queries.ts";
import { aiJpeg, loadCanvas, rotateImage } from "./image.ts";

/** Pending for longer than this = the job got lost; offer a retry. */
const STUCK_MS = 12 * 60_000;

export function isRecognizing(item: Item): boolean {
	return item.aiState === "pending" && Date.now() - Date.parse(item.updatedAt) < STUCK_MS;
}

export function recognitionFailed(item: Item): boolean {
	return item.aiState === "failed" || (item.aiState === "pending" && !isRecognizing(item));
}

/** Never went through the server-side recognition (added earlier or while the AI was off). */
export function neverRecognized(item: Item): boolean {
	return item.aiState === "" && !!item.imageFront;
}

/** Starts the AI recognition again for a stored item. `unlock` lets the AI also change fields set by hand. */
export async function retagItem(item: Item, unlock = false): Promise<Item> {
	const key = item.imageFront ?? item.thumbFront;
	if (!key) throw new Error("Kein Foto vorhanden");
	const canvas = await loadCanvas(imgUrl(key)!, 1024);
	const aiImage = await uploadImage(await aiJpeg(canvas));
	return api<Item>(`/api/items/${item.id}/retag`, { method: "POST", body: { aiImage, unlock } });
}

const running = new Set<string>();

/** Turns photos the AI found lying sideways or upside down. Runs wherever the app is open. */
export function useRotationFixups(): void {
	const { data: items } = useItems();
	const qc = useQueryClient();
	useEffect(() => {
		const todo = (items ?? []).filter((i) => i.rotate && i.imageFront && !running.has(i.id));
		if (!todo.length) return;
		for (const i of todo) running.add(i.id);
		void (async () => {
			for (const item of todo) {
				try {
					const { full, thumb } = await rotateImage(imgUrl(item.imageFront)!, item.rotate);
					const [imageFront, thumbFront] = await Promise.all([uploadImage(full), uploadImage(thumb)]);
					const saved = await api<Item>(`/api/items/${item.id}`, { method: "PATCH", body: { imageFront, thumbFront, rotate: 0 } });
					qc.setQueryData<Item[]>(keys.items, (old) => old?.map((x) => (x.id === saved.id ? saved : x)));
				} catch (err) {
					console.warn("rotation fix-up failed", item.id, err);
				} finally {
					running.delete(item.id);
				}
			}
		})();
	}, [items, qc]);
}
