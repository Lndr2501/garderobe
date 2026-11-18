// Image storage. Uses an R2 bucket when bound, otherwise Workers KV.

export interface ImageEnv {
	IMAGES: KVNamespace;
	BUCKET?: R2Bucket;
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
	return /^(img|tryon|person)\/[0-9a-f-]{36}\.(webp|png|jpg|avif|gif)$/.test(key);
}

export async function putImage(env: ImageEnv, key: string, data: ArrayBuffer, type: string): Promise<void> {
	if (env.BUCKET) {
		await env.BUCKET.put(key, data, { httpMetadata: { contentType: type } });
		return;
	}
	await env.IMAGES.put(key, data, { metadata: { type, size: data.byteLength, t: Date.now() } });
}

export async function getImage(env: ImageEnv, key: string): Promise<{ body: ReadableStream | ArrayBuffer; type: string } | null> {
	if (env.BUCKET) {
		const obj = await env.BUCKET.get(key);
		if (!obj) return null;
		return { body: obj.body, type: obj.httpMetadata?.contentType ?? "application/octet-stream" };
	}
	const res = await env.IMAGES.getWithMetadata<{ type: string }>(key, { type: "arrayBuffer", cacheTtl: 86_400 });
	if (!res.value) return null;
	return { body: res.value, type: res.metadata?.type ?? "application/octet-stream" };
}

export async function getImageBytes(env: ImageEnv, key: string): Promise<{ data: ArrayBuffer; type: string } | null> {
	const img = await getImage(env, key);
	if (!img) return null;
	const data = img.body instanceof ArrayBuffer ? img.body : await new Response(img.body).arrayBuffer();
	return { data, type: img.type };
}

export async function deleteImages(env: ImageEnv, keys: (string | null | undefined)[]): Promise<void> {
	const valid = keys.filter((k): k is string => !!k && isValidKey(k));
	await Promise.all(valid.map((k) => (env.BUCKET ? env.BUCKET.delete(k) : env.IMAGES.delete(k))));
}

export async function listImageKeys(env: ImageEnv): Promise<string[]> {
	const keys: string[] = [];
	if (env.BUCKET) {
		let cursor: string | undefined;
		do {
			const page = await env.BUCKET.list({ cursor, limit: 1000 });
			keys.push(...page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		return keys;
	}
	let cursor: string | undefined;
	do {
		const page: KVNamespaceListResult<unknown> = await env.IMAGES.list({ cursor, limit: 1000 });
		keys.push(...page.keys.map((k) => k.name));
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return keys;
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
