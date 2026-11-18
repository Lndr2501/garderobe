/**
 * Pixel-level clean-up for wardrobe cut-outs: edge refinement, stray-island removal,
 * automatic exposure/contrast and a light sharpen. All functions work in place on a canvas.
 */

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
	return c.getContext("2d", { willReadFrequently: true })!;
}

/**
 * Cleans the alpha channel of a cut-out:
 * 1. drops faint noise, 2. removes small detached islands (scraps of background),
 * 3. erodes the edge by ~1px and smooths it, 4. replaces fringe colors with interior colors (no halos).
 */
export function refineAlpha(c: HTMLCanvasElement): void {
	const ctx = ctx2d(c);
	const w = c.width;
	const h = c.height;
	if (w < 8 || h < 8) return;
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	const n = w * h;

	// 1. faint noise
	for (let i = 3; i < d.length; i += 4) if (d[i]! < 24) d[i] = 0;

	// 2. connected components on a coarse grid
	const scale = Math.min(1, 300 / Math.max(w, h));
	const gw = Math.max(1, Math.round(w * scale));
	const gh = Math.max(1, Math.round(h * scale));
	const cellOf = (x: number, y: number) => Math.min(gh - 1, Math.floor(y * scale)) * gw + Math.min(gw - 1, Math.floor(x * scale));
	const solid = new Uint8Array(gw * gh);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]! > 128) solid[cellOf(x, y)] = 1;
	}
	const label = new Int32Array(gw * gh);
	const areas: number[] = [0];
	const stack: number[] = [];
	for (let s = 0; s < solid.length; s++) {
		if (!solid[s] || label[s]) continue;
		const id = areas.length;
		let area = 0;
		label[s] = id;
		stack.push(s);
		while (stack.length) {
			const p = stack.pop()!;
			area++;
			const px = p % gw;
			const py = (p - px) / gw;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = px + dx;
					const ny = py + dy;
					if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
					const q = ny * gw + nx;
					if (solid[q] && !label[q]) {
						label[q] = id;
						stack.push(q);
					}
				}
			}
		}
		areas.push(area);
	}
	const largest = Math.max(0, ...areas);
	if (largest > 0) {
		const keep = areas.map((a, i) => i > 0 && a >= Math.max(4, largest * 0.04));
		const keptNear = (cx: number, cy: number) => {
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = cx + dx;
					const ny = cy + dy;
					if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
					if (keep[label[ny * gw + nx]!]) return true;
				}
			}
			return false;
		};
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4 + 3;
				if (!d[i]) continue;
				const cell = cellOf(x, y);
				const l = label[cell]!;
				if (l ? !keep[l] : !keptNear(cell % gw, (cell - (cell % gw)) / gw)) d[i] = 0;
			}
		}
	}

	// 3. erode by one pixel (cross), then soften the edge
	const a = new Uint8ClampedArray(n);
	for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3]!;
	const e = new Uint8ClampedArray(n);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const v = a[i]!;
			if (!v || x === 0 || y === 0 || x === w - 1 || y === h - 1) {
				e[i] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 0 : v;
				continue;
			}
			e[i] = Math.min(v, a[i - 1]!, a[i + 1]!, a[i - w]!, a[i + w]!);
		}
	}
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			const v = e[i]!;
			const l = e[i - 1]!;
			const r = e[i + 1]!;
			const t = e[i - w]!;
			const b = e[i + w]!;
			if (v === l && v === r && v === t && v === b) {
				d[i * 4 + 3] = v;
				continue;
			}
			d[i * 4 + 3] = (v * 4 + l + r + t + b) >> 3;
		}
	}

	// 4. de-fringe: edge pixels take the average color of nearby opaque pixels
	for (let y = 2; y < h - 2; y++) {
		for (let x = 2; x < w - 2; x++) {
			const i = (y * w + x) * 4;
			const al = d[i + 3]!;
			if (al === 0 || al >= 235) continue;
			let r = 0;
			let g = 0;
			let b = 0;
			let k = 0;
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					const j = ((y + dy) * w + (x + dx)) * 4;
					if (d[j + 3]! >= 235) {
						r += d[j]!;
						g += d[j + 1]!;
						b += d[j + 2]!;
						k++;
					}
				}
			}
			if (k) {
				d[i] = r / k;
				d[i + 1] = g / k;
				d[i + 2] = b / k;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
}

/**
 * Gentle automatic "product photo" look: levels stretch on the garment's own pixels,
 * lifts dark photos, a touch more saturation and a light unsharp mask.
 * Returns false when nothing was changed (e.g. very flat images).
 */
export function autoEnhance(c: HTMLCanvasElement, hasAlpha: boolean): boolean {
	const ctx = ctx2d(c);
	const w = c.width;
	const h = c.height;
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	const hist = new Uint32Array(256);
	let total = 0;
	let sum = 0;
	for (let i = 0; i < d.length; i += 16) {
		if (hasAlpha && d[i + 3]! < 200) continue;
		const l = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
		hist[l | 0]!++;
		total++;
		sum += l;
	}
	if (total < 100) return false;
	const pct = (p: number) => {
		const target = total * p;
		let acc = 0;
		for (let v = 0; v < 256; v++) {
			acc += hist[v]!;
			if (acc >= target) return v;
		}
		return 255;
	};
	const lo = pct(0.005);
	const hi = pct(0.995);
	if (hi - lo < 24) return false;
	const black = Math.min(lo, 40) * 0.85;
	const white = Math.max(hi, 205);
	const mean = (sum / total - black) / (white - black);
	const gamma = mean < 0.38 ? Math.min(1.3, Math.max(1, Math.log(0.38) / Math.log(Math.max(mean, 0.01)))) : 1;
	const exp = 1 / gamma;
	const lut = new Uint8ClampedArray(256);
	for (let v = 0; v < 256; v++) lut[v] = 255 * Math.min(1, Math.max(0, (v - black) / (white - black))) ** exp;

	const sat = 1.08;
	for (let i = 0; i < d.length; i += 4) {
		if (hasAlpha && d[i + 3] === 0) continue;
		const r = lut[d[i]!]!;
		const g = lut[d[i + 1]!]!;
		const b = lut[d[i + 2]!]!;
		const l = r * 0.299 + g * 0.587 + b * 0.114;
		d[i] = l + (r - l) * sat;
		d[i + 1] = l + (g - l) * sat;
		d[i + 2] = l + (b - l) * sat;
	}

	// "Clarity": boost mid-scale local contrast so knit, ribs and seams of dark fabric become visible.
	const brightness = sum / total / 255;
	clarity(img, hasAlpha, brightness < 0.3 ? 0.9 : brightness < 0.5 ? 0.6 : 0.35);

	// unsharp mask (3x3 box), only on visible pixels
	const src = new Uint8ClampedArray(d);
	const amount = brightness < 0.3 ? 0.5 : 0.35;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = (y * w + x) * 4;
			if (hasAlpha && src[i + 3]! < 200) continue;
			for (let ch = 0; ch < 3; ch++) {
				const o = i + ch;
				const blur =
					(src[o - 4 - w * 4]! + src[o - w * 4]! + src[o + 4 - w * 4]! + src[o - 4]! + src[o]! + src[o + 4]! + src[o - 4 + w * 4]! + src[o + w * 4]! + src[o + 4 + w * 4]!) / 9;
				d[o] = src[o]! + (src[o]! - blur) * amount;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
	return true;
}

function blank(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const ctx = c.getContext("2d", { willReadFrequently: true })!;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	return [c, ctx];
}

/**
 * Large-radius blur via repeated halving on the GPU-backed canvas (cheap, alpha-aware:
 * transparent background does not bleed into the garment colors).
 */
function blurredCopy(img: ImageData, radiusFraction: number): Uint8ClampedArray {
	const { width: w, height: h } = img;
	const [src, sctx] = blank(w, h);
	sctx.putImageData(img, 0, 0);
	const target = Math.max(8, Math.round(1 / radiusFraction));
	let cur = src;
	let cw = w;
	let ch = h;
	while (Math.max(cw, ch) / 2 >= target) {
		cw = Math.max(1, Math.ceil(cw / 2));
		ch = Math.max(1, Math.ceil(ch / 2));
		const [next, nctx] = blank(cw, ch);
		nctx.drawImage(cur, 0, 0, cw, ch);
		cur = next;
	}
	// Upscale in two steps so the result is smooth instead of blocky.
	const [mid, mctx] = blank(Math.min(w, cw * 4), Math.min(h, ch * 4));
	mctx.drawImage(cur, 0, 0, mid.width, mid.height);
	const [out, octx] = blank(w, h);
	octx.drawImage(mid, 0, 0, w, h);
	return octx.getImageData(0, 0, w, h).data;
}

/** Local contrast on luminance (like Lightroom's clarity); strongest in shadows and midtones. */
export function clarity(img: ImageData, hasAlpha: boolean, amount: number): void {
	if (amount <= 0 || img.width < 32 || img.height < 32) return;
	const d = img.data;
	let blur: Uint8ClampedArray;
	try {
		blur = blurredCopy(img, 1 / 70);
	} catch {
		return;
	}
	for (let i = 0; i < d.length; i += 4) {
		if (hasAlpha && d[i + 3]! < 180) continue;
		const r = d[i]!;
		const g = d[i + 1]!;
		const b = d[i + 2]!;
		const l = r * 0.299 + g * 0.587 + b * 0.114;
		const lb = blur[i]! * 0.299 + blur[i + 1]! * 0.587 + blur[i + 2]! * 0.114;
		const x = l / 255;
		// protect highlights and deep blacks from clipping
		const weight = Math.max(0.25, 1 - ((x - 0.4) / 0.6) ** 2);
		const delta = Math.max(-40, Math.min(40, (l - lb) * amount * weight));
		d[i] = r + delta;
		d[i + 1] = g + delta;
		d[i + 2] = b + delta;
	}
}

/** WebP encoding in WASM for browsers whose canvas cannot encode WebP (Safari). */
export async function encodeWebpWasm(c: HTMLCanvasElement, quality: number): Promise<Blob | null> {
	try {
		const { encode } = await import("@jsquash/webp");
		const data = ctx2d(c).getImageData(0, 0, c.width, c.height);
		const buf = await encode(data, { quality: Math.round(quality * 100) });
		return new Blob([buf], { type: "image/webp" });
	} catch (err) {
		console.warn("webp wasm encode failed", err);
		return null;
	}
}
