/**
 * Detects whether a cut-out already shows a real hanger hook at the top
 * (a thin opaque stem far narrower than the garment). Results are cached per image URL.
 */
const cache = new Map<string, boolean>();

export function cachedHook(src: string | undefined): boolean | undefined {
	return src ? cache.get(src) : undefined;
}

export function detectHook(img: HTMLImageElement): boolean {
	const src = img.currentSrc || img.src;
	const hit = cache.get(src);
	if (hit !== undefined) return hit;
	let result = false;
	try {
		const w = 120;
		const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d", { willReadFrequently: true })!;
		ctx.drawImage(img, 0, 0, w, h);
		const d = ctx.getImageData(0, 0, w, h).data;
		const rows: number[] = [];
		let maxW = 0;
		let transparent = 0;
		for (let y = 0; y < h; y++) {
			let n = 0;
			for (let x = 0; x < w; x++) {
				const a = d[(y * w + x) * 4 + 3]!;
				if (a > 128) n++;
				else if (a < 20) transparent++;
			}
			rows.push(n);
			if (n > maxW) maxW = n;
		}
		// Only cut-outs (photos with background have no transparent area).
		if (maxW > 0 && transparent > w * h * 0.05) {
			const top = rows.findIndex((n) => n > 0);
			let run = 0;
			for (let y = top; y < h && rows[y]! <= Math.max(2, maxW * 0.12); y++) run++;
			result = run >= h * 0.035;
		}
	} catch {
		result = false;
	}
	cache.set(src, result);
	return result;
}
