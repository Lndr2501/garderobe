import { COLORS } from "../../shared/taxonomy.ts";
import { autoEnhance, encodeWebpWasm, refineAlpha } from "./imageFx.ts";

export { autoEnhance, refineAlpha };

/** Stored sizes: full image for detail views, thumbnail for rack/grid (sharp on 3x retina). */
export const FULL_DIM = 1400;
export const THUMB_DIM = 640;

export interface ProcessedImage {
	full: Blob;
	thumb: Blob;
	/** JPEG on a light background for the vision model (untouched colors, ≤1024 px). */
	aiBlob: Blob;
	/** Whether the stored images have transparency (cut-out). */
	alpha: boolean;
	colorHex: string;
	preview: string;
	bgRemoved: boolean;
}

export type Stage = "laden" | "freistellen" | "modell" | "fertig";

export interface ProcessOptions {
	removeBg: boolean;
	quality: "fast" | "best";
	/** Brightness/contrast/sharpness auto-fix. */
	enhance?: boolean;
	onProgress?: (stage: Stage, pct: number) => void;
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

async function loadDrawable(blob: Blob): Promise<Drawable> {
	try {
		return await createImageBitmap(blob, { imageOrientation: "from-image" });
	} catch {
		const url = URL.createObjectURL(blob);
		try {
			const img = new Image();
			img.decoding = "async";
			img.src = url;
			await img.decode();
			return img;
		} catch {
			throw new Error("Bild konnte nicht gelesen werden (HEIC? Bitte als JPG/PNG exportieren).");
		} finally {
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}
	}
}

function dims(d: Drawable): { w: number; h: number } {
	if (d instanceof HTMLImageElement) return { w: d.naturalWidth, h: d.naturalHeight };
	return { w: d.width, h: d.height };
}

function toCanvas(d: Drawable, maxDim: number): HTMLCanvasElement {
	const { w, h } = dims(d);
	const scale = Math.min(1, maxDim / Math.max(w, h));
	const tw = Math.max(1, Math.round(w * scale));
	const th = Math.max(1, Math.round(h * scale));
	// Halve in steps for big reductions – a single drawImage aliases fine fabric texture.
	let src: Drawable = d;
	let sw = w;
	let sh = h;
	while (sw / 2 > tw * 1.15 && sh / 2 > th * 1.15) {
		const step = document.createElement("canvas");
		step.width = Math.round(sw / 2);
		step.height = Math.round(sh / 2);
		const sctx = step.getContext("2d")!;
		sctx.imageSmoothingQuality = "high";
		sctx.drawImage(src, 0, 0, step.width, step.height);
		src = step;
		sw = step.width;
		sh = step.height;
	}
	const c = document.createElement("canvas");
	c.width = tw;
	c.height = th;
	const ctx = c.getContext("2d")!;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(src, 0, 0, tw, th);
	return c;
}

function transparencyRatio(c: HTMLCanvasElement): number {
	const sample = toCanvas(c, 160);
	const data = sample.getContext("2d")!.getImageData(0, 0, sample.width, sample.height).data;
	let transparent = 0;
	for (let i = 3; i < data.length; i += 4) if (data[i]! < 250) transparent++;
	return transparent / (data.length / 4);
}

/** Crops fully transparent borders and adds a little padding. */
export function trimTransparent(c: HTMLCanvasElement, pad = 0.03): HTMLCanvasElement {
	const ctx = c.getContext("2d")!;
	const { width: w, height: h } = c;
	const data = ctx.getImageData(0, 0, w, h).data;
	let minX = w,
		minY = h,
		maxX = -1,
		maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3]! > 12) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) return c;
	const p = Math.round(Math.max(maxX - minX, maxY - minY) * pad);
	minX = Math.max(0, minX - p);
	minY = Math.max(0, minY - p);
	maxX = Math.min(w - 1, maxX + p);
	maxY = Math.min(h - 1, maxY + p);
	const out = document.createElement("canvas");
	out.width = maxX - minX + 1;
	out.height = maxY - minY + 1;
	out.getContext("2d")!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
	return out;
}

function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	return new Promise((resolve) => c.toBlob((b) => resolve(b), type, quality));
}

let nativeWebp: boolean | undefined;

/**
 * Encodes to WebP (keeps alpha, small). Safari cannot encode WebP from a canvas,
 * so a WASM encoder is used there; PNG/JPEG only as last resort.
 */
async function encode(c: HTMLCanvasElement, maxDim: number, alpha: boolean): Promise<Blob> {
	const scaled = toCanvas(c, maxDim);
	if (nativeWebp !== false) {
		const webp = await canvasBlob(scaled, "image/webp", 0.86);
		nativeWebp = !!webp && webp.type === "image/webp";
		if (nativeWebp) return webp!;
	}
	const wasm = await encodeWebpWasm(scaled, 0.86);
	if (wasm) return wasm;
	if (alpha) {
		const png = await canvasBlob(scaled, "image/png");
		if (png) return png;
	}
	const jpg = await canvasBlob(scaled, "image/jpeg", 0.86);
	if (!jpg) throw new Error("Bild konnte nicht kodiert werden");
	return jpg;
}

/** Encodes the full image and the thumbnail. */
export async function encodePair(c: HTMLCanvasElement, alpha: boolean): Promise<{ full: Blob; thumb: Blob }> {
	const full = await encode(c, FULL_DIM, alpha);
	const thumb = await encode(c, THUMB_DIM, alpha);
	return { full, thumb };
}

/** Light grey (not white) so white garments stay visible to the model. */
const AI_BACKGROUND = "#ebebeb";

/** JPEG for the vision model: cut-out on a light background, max 1024 px. */
export async function aiJpeg(c: HTMLCanvasElement, maxDim = 1024): Promise<Blob> {
	const scaled = toCanvas(c, maxDim);
	const out = document.createElement("canvas");
	out.width = scaled.width;
	out.height = scaled.height;
	const ctx = out.getContext("2d")!;
	ctx.fillStyle = AI_BACKGROUND;
	ctx.fillRect(0, 0, out.width, out.height);
	ctx.drawImage(scaled, 0, 0);
	const blob = await canvasBlob(out, "image/jpeg", 0.85);
	if (!blob) throw new Error("Bild für die KI konnte nicht erstellt werden");
	return blob;
}

/** Returns a new canvas turned clockwise by 0/90/180/270 degrees. */
export function rotateCanvas(c: HTMLCanvasElement, deg: number): HTMLCanvasElement {
	const d = ((deg % 360) + 360) % 360;
	if (!d) return c;
	const out = document.createElement("canvas");
	const swap = d === 90 || d === 270;
	out.width = swap ? c.height : c.width;
	out.height = swap ? c.width : c.height;
	const ctx = out.getContext("2d")!;
	ctx.translate(out.width / 2, out.height / 2);
	ctx.rotate((d * Math.PI) / 180);
	ctx.drawImage(c, -c.width / 2, -c.height / 2);
	return out;
}

/** Loads a stored/processed image, turns it and re-encodes full + thumbnail. */
export async function rotateImage(src: string | Blob, deg: number): Promise<{ full: Blob; thumb: Blob }> {
	const c = await loadCanvas(src, 1600);
	const alpha = hasTransparency(c);
	return encodePair(rotateCanvas(c, deg), alpha);
}

/** Most common color among opaque pixels (center region if the image has a background). */
export function dominantColor(c: HTMLCanvasElement, hasAlpha: boolean): string {
	const s = toCanvas(c, 120);
	const ctx = s.getContext("2d")!;
	const x0 = hasAlpha ? 0 : Math.floor(s.width * 0.25);
	const y0 = hasAlpha ? 0 : Math.floor(s.height * 0.25);
	const w = hasAlpha ? s.width : Math.ceil(s.width * 0.5);
	const h = hasAlpha ? s.height : Math.ceil(s.height * 0.5);
	const data = ctx.getImageData(x0, y0, w, h).data;
	const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3]! < 200) continue;
		const r = data[i]!,
			g = data[i + 1]!,
			b = data[i + 2]!;
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
		e.n++;
		e.r += r;
		e.g += g;
		e.b += b;
		buckets.set(key, e);
	}
	let best: { n: number; r: number; g: number; b: number } | null = null;
	for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
	if (!best) return "";
	const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
	return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
	const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
	const lin = (v: number) => {
		v /= 255;
		return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
	};
	const R = lin(r),
		G = lin(g),
		B = lin(b);
	const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
	const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
	const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
	const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** Maps a hex color to the closest named wardrobe color. */
export function nearestColorKey(hex: string): string | null {
	const rgb = hexToRgb(hex);
	if (!rgb) return null;
	const lab = rgbToLab(rgb);
	let best: string | null = null;
	let bestD = Infinity;
	for (const c of COLORS) {
		const crgb = hexToRgb(c.hex);
		if (!crgb) continue;
		const l2 = rgbToLab(crgb);
		const d = (lab[0] - l2[0]) ** 2 + (lab[1] - l2[1]) ** 2 + (lab[2] - l2[2]) ** 2;
		if (d < bestD) {
			bestD = d;
			best = c.key;
		}
	}
	return best;
}

async function removeBg(blob: Blob, quality: "fast" | "best", onProgress?: ProcessOptions["onProgress"]): Promise<Blob> {
	const mod = await import("@imgly/background-removal");
	return mod.removeBackground(blob, {
		model: quality === "fast" ? "isnet_quint8" : "isnet_fp16",
		output: { format: "image/png", quality: 1 },
		progress: (key: string, current: number, total: number) => {
			if (key.startsWith("fetch")) onProgress?.("modell", total ? current / total : 0);
			else onProgress?.("freistellen", total ? current / total : 0.5);
		},
	});
}

export async function processImage(file: Blob, opts: ProcessOptions): Promise<ProcessedImage> {
	opts.onProgress?.("laden", 0);
	const drawable = await loadDrawable(file);
	let canvas = toCanvas(drawable, 1600);
	if ("close" in drawable && typeof drawable.close === "function") drawable.close();
	let hasAlpha = transparencyRatio(canvas) > 0.02;
	let bgRemoved = false;
	if (opts.removeBg && !hasAlpha) {
		opts.onProgress?.("freistellen", 0);
		const src = await canvasBlob(canvas, "image/png");
		if (!src) throw new Error("Bild konnte nicht vorbereitet werden");
		const cut = await removeBg(src, opts.quality, opts.onProgress);
		const cutDrawable = await loadDrawable(cut);
		const cutCanvas = toCanvas(cutDrawable, 1600);
		// Guard against the model removing (almost) everything.
		if (transparencyRatio(cutCanvas) < 0.985) {
			canvas = cutCanvas;
			hasAlpha = true;
			bgRemoved = true;
		}
	}
	if (bgRemoved) refineAlpha(canvas);
	if (hasAlpha) canvas = trimTransparent(canvas);
	// Color + AI image from the untouched pixels, the stored image gets the enhancement.
	const colorHex = dominantColor(canvas, hasAlpha);
	const aiBlob = await aiJpeg(canvas);
	if (opts.enhance) autoEnhance(canvas, hasAlpha);
	const { full, thumb } = await encodePair(canvas, hasAlpha);
	opts.onProgress?.("fertig", 1);
	return { full, thumb, aiBlob, alpha: hasAlpha, colorHex, preview: URL.createObjectURL(full), bgRemoved };
}

/** Loads a stored image (URL or blob) into a canvas for editing. */
export async function loadCanvas(src: string | Blob, maxDim = 1600): Promise<HTMLCanvasElement> {
	const blob = typeof src === "string" ? await (await fetch(src, { credentials: "same-origin" })).blob() : src;
	const d = await loadDrawable(blob);
	const c = toCanvas(d, maxDim);
	if ("close" in d && typeof d.close === "function") d.close();
	return c;
}

export function hasTransparency(c: HTMLCanvasElement): boolean {
	return transparencyRatio(c) > 0.02;
}

/** Copy of a canvas (for undo/reset in the editor). */
export function cloneCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
	const out = document.createElement("canvas");
	out.width = c.width;
	out.height = c.height;
	out.getContext("2d")!.drawImage(c, 0, 0);
	return out;
}

/** Simple resize/encode for photos that must keep their background (e.g. person photo, shopping check). */
export async function prepareImage(file: Blob, maxDim = 1400): Promise<{ blob: Blob; dataUrl: string }> {
	const d = await loadDrawable(file);
	const c = toCanvas(d, maxDim);
	const blob = (await canvasBlob(c, "image/jpeg", 0.88)) ?? file;
	return { blob, dataUrl: toCanvas(c, 1024).toDataURL("image/jpeg", 0.85) };
}

export function isImageFile(f: File): boolean {
	return f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|avif)$/i.test(f.name);
}
