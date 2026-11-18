// BlobStore implementations: plain files on disk (production) and memory (tests).
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobStore, StoredBlob } from "../worker/platform.ts";

const TYPES: Record<string, string> = {
	webp: "image/webp",
	png: "image/png",
	jpg: "image/jpeg",
	avif: "image/avif",
	gif: "image/gif",
};

function typeOf(key: string): string {
	return TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
}

/** Only `<prefix>/<uuid>.<ext>` – nothing that could leave the folder. */
const SAFE_KEY = /^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]+$/;

function bytes(data: ArrayBuffer | Uint8Array): Uint8Array {
	return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export class FileBlobStore implements BlobStore {
	constructor(private dir: string) {}

	private file(key: string): string {
		if (!SAFE_KEY.test(key)) throw new Error(`Ungültiger Bild-Schlüssel: ${key}`);
		return join(this.dir, key);
	}

	async put(key: string, data: ArrayBuffer | Uint8Array, _type: string): Promise<void> {
		const f = this.file(key);
		await mkdir(dirname(f), { recursive: true });
		const tmp = `${f}.${crypto.randomUUID()}.tmp`;
		await writeFile(tmp, bytes(data));
		await rename(tmp, f);
	}

	async get(key: string): Promise<StoredBlob | null> {
		const f = this.file(key);
		try {
			const [buf, st] = await Promise.all([readFile(f), stat(f)]);
			return { data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), type: typeOf(key), t: st.mtimeMs };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw err;
		}
	}

	async delete(key: string): Promise<void> {
		await rm(this.file(key), { force: true });
	}

	async list(): Promise<{ key: string; t: number }[]> {
		const out: { key: string; t: number }[] = [];
		let prefixes: string[];
		try {
			prefixes = await readdir(this.dir);
		} catch {
			return out;
		}
		for (const prefix of prefixes) {
			let names: string[];
			try {
				names = await readdir(join(this.dir, prefix));
			} catch {
				continue;
			}
			for (const name of names) {
				const key = `${prefix}/${name}`;
				if (!SAFE_KEY.test(key)) continue;
				const st = await stat(join(this.dir, key)).catch(() => null);
				if (st?.isFile()) out.push({ key, t: st.mtimeMs });
			}
		}
		return out;
	}
}

export class MemoryBlobStore implements BlobStore {
	private items = new Map<string, StoredBlob>();

	async put(key: string, data: ArrayBuffer | Uint8Array, type: string): Promise<void> {
		this.items.set(key, { data: bytes(data).slice(), type, t: Date.now() });
	}

	async get(key: string): Promise<StoredBlob | null> {
		return this.items.get(key) ?? null;
	}

	async delete(key: string): Promise<void> {
		this.items.delete(key);
	}

	async list(): Promise<{ key: string; t: number }[]> {
		return [...this.items].map(([key, v]) => ({ key, t: v.t }));
	}
}
