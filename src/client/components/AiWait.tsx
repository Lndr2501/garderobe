import { useEffect, useState } from "react";

/** Seconds since `since` (ms timestamp), ticking every second while set. */
export function useElapsed(since: number | null | undefined): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!since) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [since]);
	return since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

/** Inline "waiting for the AI" indicator with a running seconds counter. */
export function AiWait({ since, label = "KI denkt nach" }: { since: number | null | undefined; label?: string }) {
	const s = useElapsed(since);
	if (!since) return null;
	return (
		<span className="ai-wait" role="status">
			<span className="spinner" />
			<span>
				{label} · {s} s
				{s >= 20 && <span className="muted"> – dein KI-Anbieter braucht gerade länger, du kannst schon weitermachen</span>}
			</span>
		</span>
	);
}
