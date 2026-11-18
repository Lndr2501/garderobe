// Minimal OpenAI-compatible client. Always streams chat completions (some proxies only support
// stream:true) and also accepts plain JSON responses from providers that ignore `stream`.

export interface AiConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	visionModel: string;
	imageModel: string;
	tryonMode: "edits" | "chat";
	jsonMode: boolean;
	/** Let reasoning models think before answering (slower). Off = ask them to answer directly. */
	reasoning: boolean;
}

export const EMPTY_AI: AiConfig = {
	baseUrl: "",
	apiKey: "",
	model: "",
	visionModel: "",
	imageModel: "",
	tryonMode: "edits",
	jsonMode: false,
	reasoning: false,
};

/** Providers that rejected the thinking switch – don't send it to them again (per isolate). */
const NO_THINK_UNSUPPORTED = new Set<string>();

export class AiError extends Error {
	constructor(
		message: string,
		public status = 502,
	) {
		super(message);
	}
}

export type ChatContent =
	| string
	| ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: string } })[];

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: ChatContent;
}

export function normalizeBaseUrl(raw: string): string {
	let url = raw.trim().replace(/\/+$/, "");
	if (!url) return "";
	if (!/^https?:\/\//.test(url)) url = `https://${url}`;
	try {
		const u = new URL(url);
		if (u.pathname === "" || u.pathname === "/") url = `${url}/v1`;
	} catch {
		throw new AiError("Ungültige Base-URL", 400);
	}
	return url.replace(/\/+$/, "");
}

export function aiConfigured(cfg: AiConfig): boolean {
	return !!cfg.baseUrl && !!cfg.model;
}

function headers(cfg: AiConfig, json = true): Record<string, string> {
	const h: Record<string, string> = { "X-Title": "Garderobe", "HTTP-Referer": "https://garderobe.app" };
	if (json) h["Content-Type"] = "application/json";
	if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
	return h;
}

async function errorFrom(res: Response): Promise<AiError> {
	let detail = "";
	try {
		const text = await res.text();
		try {
			const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
			detail = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? text);
		} catch {
			detail = text;
		}
	} catch {
		/* ignore */
	}
	detail = detail.slice(0, 300);
	if (res.status === 401 || res.status === 403) return new AiError(`KI-Anbieter: Zugriff verweigert (API-Key prüfen). ${detail}`, 502);
	if (res.status === 404) return new AiError(`KI-Anbieter: Endpunkt oder Modell nicht gefunden. ${detail}`, 502);
	if (res.status === 429) return new AiError(`KI-Anbieter: Limit erreicht, später nochmal versuchen. ${detail}`, 502);
	return new AiError(`KI-Anbieter antwortet mit ${res.status}. ${detail}`, 502);
}

async function postChat(cfg: AiConfig, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
	if (!aiConfigured(cfg)) throw new AiError("Keine KI eingerichtet (Einstellungen → KI).", 400);
	const send = async (b: Record<string, unknown>) => {
		try {
			return await fetch(`${cfg.baseUrl}/chat/completions`, {
				method: "POST",
				headers: headers(cfg),
				body: JSON.stringify(b),
				signal,
			});
		} catch (err) {
			throw new AiError(`KI-Anbieter nicht erreichbar: ${(err as Error).message}`);
		}
	};
	let res = await send(body);
	// Strict providers (e.g. OpenAI) reject unknown fields: retry once without the thinking switch.
	if (res.status === 400 && "chat_template_kwargs" in body) {
		NO_THINK_UNSUPPORTED.add(cfg.baseUrl);
		const { chat_template_kwargs: _drop, ...rest } = body;
		res = await send(rest);
	}
	if (!res.ok) throw await errorFrom(res);
	return res;
}

/** Yields content deltas from an SSE or JSON chat completion response. */
export async function* readCompletion(res: Response): AsyncGenerator<string> {
	const type = res.headers.get("content-type") ?? "";
	if (type.includes("application/json")) {
		const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
		const content = j.choices?.[0]?.message?.content;
		if (typeof content === "string") yield content;
		else if (Array.isArray(content)) {
			for (const part of content) if (part && typeof part.text === "string") yield part.text;
		}
		return;
	}
	if (!res.body) return;
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += value;
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (data === "[DONE]") return;
			try {
				const j = JSON.parse(data) as {
					choices?: { delta?: { content?: string | null } }[];
					error?: { message?: string };
				};
				if (j.error) throw new AiError(`KI-Fehler: ${j.error.message ?? "unbekannt"}`);
				const delta = j.choices?.[0]?.delta?.content;
				if (delta) yield delta;
			} catch (err) {
				if (err instanceof AiError) throw err;
			}
		}
	}
}

/** Removes <think>…</think> blocks from a streamed text, even when tags are split across chunks. */
export class ThinkFilter {
	private buf = "";
	private inThink = false;

	push(chunk: string): string {
		this.buf += chunk;
		let out = "";
		for (;;) {
			if (this.inThink) {
				const end = this.buf.indexOf("</think>");
				if (end < 0) {
					this.buf = this.buf.slice(Math.max(0, this.buf.length - 8));
					return out;
				}
				this.buf = this.buf.slice(end + 8);
				this.inThink = false;
				continue;
			}
			const start = this.buf.indexOf("<think>");
			if (start >= 0) {
				out += this.buf.slice(0, start);
				this.buf = this.buf.slice(start + 7);
				this.inThink = true;
				continue;
			}
			// Hold back a possible partial "<think>" at the end.
			let hold = 0;
			for (let k = Math.min(6, this.buf.length); k > 0; k--) {
				if ("<think>".startsWith(this.buf.slice(-k))) {
					hold = k;
					break;
				}
			}
			out += this.buf.slice(0, this.buf.length - hold);
			this.buf = this.buf.slice(this.buf.length - hold);
			return out;
		}
	}

	flush(): string {
		const rest = this.inThink ? "" : this.buf;
		this.buf = "";
		return rest;
	}
}

export interface ChatOptions {
	model?: string;
	json?: boolean;
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}

function chatBody(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: opts.model || cfg.model,
		messages,
		stream: true,
	};
	if (opts.temperature !== undefined) body.temperature = opts.temperature;
	if (opts.maxTokens) body.max_tokens = opts.maxTokens;
	if (opts.json && cfg.jsonMode) body.response_format = { type: "json_object" };
	// Qwen3/GLM/DeepSeek-style templates: skip the hidden thinking phase (much faster, same answers here).
	if (!cfg.reasoning && !NO_THINK_UNSUPPORTED.has(cfg.baseUrl)) body.chat_template_kwargs = { enable_thinking: false };
	return body;
}

export async function chatText(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
	const res = await postChat(cfg, chatBody(cfg, messages, opts), opts.signal);
	const filter = new ThinkFilter();
	let out = "";
	for await (const delta of readCompletion(res)) out += filter.push(delta);
	out += filter.flush();
	return out.trim();
}

export async function chatJson<T>(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
	const text = await chatText(cfg, messages, { ...opts, json: true });
	return extractJson<T>(text);
}

/** Streams plain text deltas (think blocks removed). */
export async function chatStream(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ReadableStream<Uint8Array>> {
	const res = await postChat(cfg, chatBody(cfg, messages, opts), opts.signal);
	const enc = new TextEncoder();
	const filter = new ThinkFilter();
	const iter = readCompletion(res);
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { value, done } = await iter.next();
				if (done) {
					const rest = filter.flush();
					if (rest) controller.enqueue(enc.encode(sse({ t: rest })));
					controller.enqueue(enc.encode("data: [DONE]\n\n"));
					controller.close();
					return;
				}
				const text = filter.push(value);
				if (text) controller.enqueue(enc.encode(sse({ t: text })));
			} catch (err) {
				controller.enqueue(enc.encode(sse({ error: (err as Error).message })));
				controller.enqueue(enc.encode("data: [DONE]\n\n"));
				controller.close();
			}
		},
		cancel() {
			void iter.return(undefined);
		},
	});
}

function sse(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

export function extractJson<T>(text: string): T {
	let t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence?.[1]) t = fence[1].trim();
	const startObj = t.indexOf("{");
	const startArr = t.indexOf("[");
	const start = startObj < 0 ? startArr : startArr < 0 ? startObj : Math.min(startObj, startArr);
	if (start < 0) throw new AiError("KI-Antwort enthielt kein JSON.");
	const open = t[start];
	const close = open === "{" ? "}" : "]";
	const end = t.lastIndexOf(close);
	if (end <= start) throw new AiError("KI-Antwort enthielt kein vollständiges JSON.");
	try {
		return JSON.parse(t.slice(start, end + 1)) as T;
	} catch {
		throw new AiError("KI-Antwort war kein gültiges JSON.");
	}
}

export async function listModels(cfg: AiConfig): Promise<string[]> {
	if (!cfg.baseUrl) throw new AiError("Keine Base-URL gesetzt.", 400);
	const res = await fetch(`${cfg.baseUrl}/models`, { headers: headers(cfg, false) });
	if (!res.ok) throw await errorFrom(res);
	const j = (await res.json()) as { data?: { id: string }[] };
	return (j.data ?? []).map((m) => m.id).sort();
}

export interface ImageInput {
	data: ArrayBuffer;
	type: string;
	name: string;
}

/** OpenAI-style /images/edits with one or more input images. Returns PNG/WebP bytes. */
export async function imageEdit(cfg: AiConfig, prompt: string, images: ImageInput[]): Promise<{ data: ArrayBuffer; type: string }> {
	if (!cfg.baseUrl || !cfg.imageModel) throw new AiError("Kein Bild-Modell eingerichtet (Einstellungen → KI).", 400);
	const form = new FormData();
	form.append("model", cfg.imageModel);
	form.append("prompt", prompt);
	form.append("n", "1");
	for (const img of images) {
		form.append(images.length > 1 ? "image[]" : "image", new File([new Uint8Array(img.data)], img.name, { type: img.type }));
	}
	let res: Response;
	try {
		res = await fetch(`${cfg.baseUrl}/images/edits`, { method: "POST", headers: headers(cfg, false), body: form });
	} catch (err) {
		throw new AiError(`KI-Anbieter nicht erreichbar: ${(err as Error).message}`);
	}
	if (!res.ok) throw await errorFrom(res);
	const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
	const first = j.data?.[0];
	if (first?.b64_json) return { data: base64ToBuffer(first.b64_json), type: "image/png" };
	if (first?.url) return fetchImage(first.url);
	throw new AiError("KI-Anbieter hat kein Bild geliefert.");
}

/** Chat completion with image output (e.g. OpenRouter `modalities: ["image","text"]`). */
export async function imageViaChat(cfg: AiConfig, prompt: string, images: ImageInput[]): Promise<{ data: ArrayBuffer; type: string }> {
	if (!cfg.baseUrl || !cfg.imageModel) throw new AiError("Kein Bild-Modell eingerichtet (Einstellungen → KI).", 400);
	const content: ChatContent = [
		{ type: "text", text: prompt },
		...images.map((img) => ({ type: "image_url" as const, image_url: { url: bufferToDataUrl(img.data, img.type) } })),
	];
	let res: Response;
	try {
		res = await fetch(`${cfg.baseUrl}/chat/completions`, {
			method: "POST",
			headers: headers(cfg),
			body: JSON.stringify({
				model: cfg.imageModel,
				messages: [{ role: "user", content }],
				modalities: ["image", "text"],
				stream: false,
			}),
		});
	} catch (err) {
		throw new AiError(`KI-Anbieter nicht erreichbar: ${(err as Error).message}`);
	}
	if (!res.ok) throw await errorFrom(res);
	const j = (await res.json()) as {
		choices?: {
			message?: {
				images?: { image_url?: { url?: string } }[];
				content?: string | { type: string; image_url?: { url?: string } }[];
			};
		}[];
	};
	const msg = j.choices?.[0]?.message;
	let url = msg?.images?.[0]?.image_url?.url;
	if (!url && Array.isArray(msg?.content)) url = msg.content.find((p) => p.image_url?.url)?.image_url?.url;
	if (!url && typeof msg?.content === "string") url = msg.content.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/)?.[0];
	if (!url) throw new AiError("KI-Anbieter hat kein Bild geliefert (unterstützt das Modell Bildausgabe?).");
	if (url.startsWith("data:")) {
		const m = url.match(/^data:([^;]+);base64,(.*)$/);
		if (!m) throw new AiError("Ungültiges Bild vom KI-Anbieter.");
		return { data: base64ToBuffer(m[2]!), type: m[1]! };
	}
	return fetchImage(url);
}

async function fetchImage(url: string): Promise<{ data: ArrayBuffer; type: string }> {
	const r = await fetch(url);
	if (!r.ok) throw new AiError(`Bild konnte nicht geladen werden (${r.status}).`);
	return { data: await r.arrayBuffer(), type: r.headers.get("content-type") ?? "image/png" };
}

function base64ToBuffer(b64: string): ArrayBuffer {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

function bufferToDataUrl(data: ArrayBuffer, type: string): string {
	const bytes = new Uint8Array(data);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return `data:${type};base64,${btoa(bin)}`;
}
