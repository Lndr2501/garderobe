export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
	}
}

export const UNAUTHORIZED_EVENT = "gd:unauthorized";

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
	const init: RequestInit = { method: opts.method ?? "GET", credentials: "same-origin", signal: opts.signal, headers: {} };
	if (opts.body !== undefined) {
		init.body = JSON.stringify(opts.body);
		(init.headers as Record<string, string>)["Content-Type"] = "application/json";
	}
	let res: Response;
	try {
		res = await fetch(path, init);
	} catch {
		throw new ApiError(navigator.onLine ? "Server nicht erreichbar" : "Du bist offline", 0);
	}
	if (res.status === 401 && !path.startsWith("/api/auth/")) {
		window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
	}
	const type = res.headers.get("content-type") ?? "";
	const data = type.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok) {
		const msg = typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : `Fehler ${res.status}`;
		throw new ApiError(msg, res.status);
	}
	return data as T;
}

export async function uploadImage(blob: Blob): Promise<string> {
	const form = new FormData();
	const ext = blob.type.split("/")[1] ?? "bin";
	form.append("file", blob, `upload.${ext}`);
	const res = await fetch("/api/images", { method: "POST", body: form, credentials: "same-origin" });
	if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
	if (!res.ok) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new ApiError(j.error ?? `Upload fehlgeschlagen (${res.status})`, res.status);
	}
	return ((await res.json()) as { key: string }).key;
}

export function imgUrl(key: string | null | undefined): string | undefined {
	return key ? `/api/img/${key}` : undefined;
}

/** Streams the assistant reply as text chunks. */
export async function* streamChat(body: unknown, signal?: AbortSignal): AsyncGenerator<string> {
	const res = await fetch("/api/ai/chat", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new ApiError(j.error ?? `Fehler ${res.status}`, res.status);
	}
	const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buf += value;
		let idx: number;
		while ((idx = buf.indexOf("\n\n")) >= 0) {
			const chunk = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			for (const line of chunk.split("\n")) {
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (data === "[DONE]") return;
				const j = JSON.parse(data) as { t?: string; error?: string };
				if (j.error) throw new ApiError(j.error, 502);
				if (j.t) yield j.t;
			}
		}
	}
}
