// Image storage (files on disk in production, memory in tests).
import type { BlobStore } from "./platform.ts";

export interface ImageEnv {
	IMAGES: BlobStore;
}

const ALLOWED = new Set(["image/webp", "image/png", "image/jpeg", "image/avif", "image/gif"]);
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function isAllowedType(type: string): boolean {
	return ALLOWED.has(type);
}

function extFor(type: string): string {
	return type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
}

export function newImageKey(type: string, prefix = "img"): string {
	return `${prefix}/${crypto.randomUUID()}.${extFor(type)}`;
}

export function isValidKey(key: string): boolean {
	return /^(img|tryon|person|studio)\/[0-9a-f-]{36}\.(webp|png|jpg|avif|gif)$/.test(key);
}

export async function putImage(env: ImageEnv, key: string, data: ArrayBuffer | Uint8Array, type: string): Promise<void> {
	await env.IMAGES.put(key, data, type);
}

export async function getImage(env: ImageEnv, key: string): Promise<{ body: Uint8Array; type: string } | null> {
	const img = await env.IMAGES.get(key);
	return img ? { body: img.data, type: img.type } : null;
}

export async function getImageBytes(env: ImageEnv, key: string): Promise<{ data: ArrayBuffer; type: string } | null> {
	const img = await env.IMAGES.get(key);
	if (!img) return null;
	const data = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength) as ArrayBuffer;
	return { data, type: img.type };
}

export async function deleteImages(env: ImageEnv, keys: (string | null | undefined)[]): Promise<void> {
	const valid = keys.filter((k): k is string => !!k && isValidKey(k));
	await Promise.all(valid.map((k) => env.IMAGES.delete(k)));
}

/** All stored keys with their last write time. */
export async function listImages(env: ImageEnv): Promise<{ key: string; t: number }[]> {
	return env.IMAGES.list();
}

export function toDataUrl(data: ArrayBuffer, type: string): string {
	const bytes = new Uint8Array(data);
	let bin = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return `data:${type};base64,${btoa(bin)}`;
}

export function fromBase64(b64: string): ArrayBuffer {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}
