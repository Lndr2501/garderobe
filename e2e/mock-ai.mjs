// Minimal OpenAI-compatible mock used by the e2e tests (chat completions with SSE, models, image edits).
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_AI_PORT ?? 8799);
/** 16×16 red piece on a transparent background (so the app skips its background removal). */
const CUTOUT = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR42mNgGH7ghIbGf3x41IBRA+hjwNADAJelpzGqgYqDAAAAAElFTkSuQmCC";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function text(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((p) => p.text ?? "").join(" ");
	return "";
}

function reply(body) {
	const all = (body.messages ?? []).map((m) => text(m.content)).join("\n");
	const ids = [...new Set(all.match(UUID) ?? [])];
	if (all.includes("Bereit!")) return "Bereit!";
	if (all.includes("Analysiere")) {
		return JSON.stringify({ name: "Rote Strickjacke", anker: "links", category: "outerwear", subcategory: "Cardigan", colors: ["rot"], material: "Wolle", pattern: "uni", warmth: 4, formality: 2, seasons: ["herbst", "winter"], styleTags: ["casual"] });
	}
	if (all.includes('{"outfits"')) {
		return "<think>überlege…</think>" + JSON.stringify({ outfits: [{ name: "KI-Kombi", itemIds: ids.slice(0, 2), reason: "Vom Mock-Stylisten" }] });
	}
	if (all.includes('"extras"')) {
		return JSON.stringify({ items: ids.slice(0, 2).map((itemId) => ({ itemId, reason: "Mock" })), extras: [{ text: "Zahnbürste", qty: 1 }], notes: "Gute Reise!" });
	}
	if (all.includes('"verdict"')) {
		return JSON.stringify({ name: "Neuer Pulli", category: "top", colors: ["blau"], similarIds: [], pairsWithIds: ids.slice(0, 2), verdict: "kaufen", reasoning: "Mock sagt ja." });
	}
	return `Hallo vom Mock! Probier mal ${ids[0] ? `[[${ids[0]}]]` : "etwas Neues"} – passt super zum Wetter.`;
}

createServer(async (req, res) => {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const raw = Buffer.concat(chunks);
	const path = new URL(req.url, "http://x").pathname;
	if (path === "/v1/models") {
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ data: [{ id: "mock-chat" }, { id: "mock-vision" }, { id: "mock-image" }] }));
	}
	if (path === "/v1/images/edits") {
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ data: [{ b64_json: CUTOUT }] }));
	}
	if (path === "/v1/chat/completions") {
		const body = JSON.parse(raw.toString() || "{}");
		const out = reply(body);
		if (!body.stream) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: out } }] }));
		}
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (let i = 0; i < out.length; i += 12) {
			res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: out.slice(i, i + 12) } }] })}\n\n`);
			await new Promise((r) => setTimeout(r, 5));
		}
		return res.end("data: [DONE]\n\n");
	}
	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: { message: "not found" } }));
}).listen(PORT, () => console.log(`mock ai on ${PORT}`));
