import { Camera, RotateCcw, Send, Square } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { imgUrl, streamChat } from "../api.ts";
import { PageHead } from "../components/Layout.tsx";
import { Mascot } from "../components/Mascot.tsx";
import { errorText } from "../components/Toast.tsx";
import { prepareImage } from "../lib/image.ts";
import { useLocal } from "../lib/useLocal.ts";
import { useItemMap, useSettings, useWeather } from "../queries.ts";

interface Msg {
	role: "user" | "assistant";
	content: string;
	image?: string;
	error?: boolean;
}

const QUICK = [
	"Was zieh ich heute an?",
	"Outfit für ein Date heute Abend?",
	"Was fehlt in meinem Schrank?",
	"Welche Teile sollte ich aussortieren?",
	"Wie kombiniere ich mein Lieblingsteil?",
];

function RichText({ text }: { text: string }) {
	const map = useItemMap();
	const [, navigate] = useLocation();
	const parts = text.split(/(\[\[[0-9a-f-]{36}\]\])/g);
	return (
		<>
			{parts.map((p, i) => {
				const m = p.match(/^\[\[([0-9a-f-]{36})\]\]$/);
				if (!m) return <Fragment key={i}>{p.replace(/\*\*(.+?)\*\*/g, "$1")}</Fragment>;
				const item = map.get(m[1]!);
				if (!item) return null;
				return (
					<button key={i} className="item-ref" onClick={() => navigate(`/teil/${item.id}`)}>
						{(item.thumbFront ?? item.imageFront) && <img src={imgUrl(item.thumbFront ?? item.imageFront)} alt="" />}
						{item.name || "Teil"}
					</button>
				);
			})}
		</>
	);
}

export function Assistant() {
	const { data: settings } = useSettings();
	const { data: weather } = useWeather();
	const [msgs, setMsgs] = useLocal<Msg[]>("gd-chat", []);
	const [input, setInput] = useState("");
	const [image, setImage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const abort = useRef<AbortController | null>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const aiOn = !!settings?.ai.configured;

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [msgs]);

	const send = async (text: string) => {
		const content = text.trim();
		if (!content || busy) return;
		const history: Msg[] = [...msgs, { role: "user", content, image: image ?? undefined }];
		setMsgs([...history, { role: "assistant", content: "" }]);
		setInput("");
		const img = image;
		setImage(null);
		setBusy(true);
		const ctrl = new AbortController();
		abort.current = ctrl;
		const now = new Date();
		const context = [
			`Jetzt: ${now.toLocaleString("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`,
			weather
				? `Wetter${weather.place ? ` in ${weather.place}` : ""}: ${Math.round(weather.temp)} °C (gefühlt ${Math.round(weather.feelsLike)} °C), ${weather.description}, heute ${Math.round(weather.tMin)}–${Math.round(weather.tMax)} °C, Regenrisiko ${weather.precipProb} %`
				: "",
		]
			.filter(Boolean)
			.join(". ");
		let acc = "";
		try {
			for await (const chunk of streamChat(
				{ messages: history.slice(-16).map((m) => ({ role: m.role, content: m.content })), context, image: img ?? undefined },
				ctrl.signal,
			)) {
				acc += chunk;
				setMsgs([...history, { role: "assistant", content: acc }]);
			}
			if (!acc) setMsgs([...history, { role: "assistant", content: "(keine Antwort)", error: true }]);
		} catch (e) {
			if ((e as Error).name === "AbortError") setMsgs([...history, { role: "assistant", content: acc || "(abgebrochen)" }]);
			else setMsgs([...history, { role: "assistant", content: `${acc ? `${acc}\n\n` : ""}⚠︎ ${errorText(e)}`, error: true }]);
		} finally {
			setBusy(false);
			abort.current = null;
		}
	};

	return (
		<div className="container page" style={{ maxWidth: 820 }}>
			<PageHead
				title="Assistent"
				right={
					msgs.length > 0 && (
						<button className="btn small" onClick={() => setMsgs([])} disabled={busy}>
							<RotateCcw size={15} /> Neuer Chat
						</button>
					)
				}
			/>
			<div className="row" style={{ alignItems: "flex-end" }}>
				<Mascot />
				<div className="bubble">
					<b>Hi, ich bin Bügel!</b>
					Ich kenne deinen ganzen Schrank und das Wetter. Frag mich nach Outfits, Kombis oder was du aussortieren kannst.
				</div>
			</div>

			{!aiOn && settings && (
				<div className="card stack">
					<b>KI noch nicht eingerichtet</b>
					<span className="small muted">Trage in den Einstellungen eine OpenAI-kompatible Schnittstelle ein (Base-URL, API-Key, Modell) – dann kann ich loslegen.</span>
					<Link href="/einstellungen" className="btn primary" style={{ alignSelf: "flex-start" }}>
						KI einrichten
					</Link>
				</div>
			)}

			<div className="chat">
				{msgs.map((m, i) => (
					<div key={i} className={`msg ${m.role}`} style={m.error ? { borderColor: "var(--danger)" } : undefined}>
						{m.image && <img src={m.image} alt="" style={{ maxWidth: 160, borderRadius: 12, display: "block", marginBottom: 6 }} />}
						{m.role === "assistant" ? m.content ? <RichText text={m.content} /> : <span className="spinner" style={{ display: "inline-block" }} /> : m.content}
					</div>
				))}
				<div ref={endRef} />
			</div>

			{msgs.length === 0 && aiOn && (
				<div className="chips">
					{QUICK.map((q) => (
						<button key={q} className="chip" onClick={() => void send(q)}>
							{q}
						</button>
					))}
				</div>
			)}

			{image && (
				<div className="row">
					<img src={image} alt="Anhang" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 12 }} />
					<button className="btn small ghost" onClick={() => setImage(null)}>
						Entfernen
					</button>
				</div>
			)}

			<form
				className="composer"
				onSubmit={(e) => {
					e.preventDefault();
					void send(input);
				}}
			>
				<button type="button" className="icon-btn" aria-label="Foto anhängen" onClick={() => fileRef.current?.click()} disabled={!aiOn}>
					<Camera size={18} />
				</button>
				<input value={input} onChange={(e) => setInput(e.target.value)} placeholder={aiOn ? "Frag Bügel …" : "KI einrichten, um zu chatten"} disabled={!aiOn} enterKeyHint="send" />
				{busy ? (
					<button type="button" className="icon-btn" aria-label="Stopp" onClick={() => abort.current?.abort()}>
						<Square size={16} />
					</button>
				) : (
					<button type="submit" className="icon-btn active" aria-label="Senden" disabled={!input.trim() || !aiOn}>
						<Send size={17} />
					</button>
				)}
				<input
					ref={fileRef}
					type="file"
					accept="image/*"
					hidden
					onChange={async (e) => {
						const f = e.target.files?.[0];
						e.target.value = "";
						if (f) setImage((await prepareImage(f, 768)).dataUrl);
					}}
				/>
			</form>
		</div>
	);
}
