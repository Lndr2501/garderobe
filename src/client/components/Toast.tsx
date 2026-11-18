import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "ok" | "error";
interface ToastMsg {
	id: number;
	text: string;
	kind: Kind;
}

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastMsg[]>([]);
	const show = useCallback((text: string, kind: Kind = "info") => {
		const id = Date.now() + Math.random();
		setToasts((t) => [...t.slice(-2), { id, text, kind }]);
		setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
	}, []);
	return (
		<Ctx.Provider value={show}>
			{children}
			<div className="toasts" role="status" aria-live="polite">
				{toasts.map((t) => (
					<div key={t.id} className={`toast ${t.kind}`}>
						{t.text}
					</div>
				))}
			</div>
		</Ctx.Provider>
	);
}

export const useToast = () => useContext(Ctx);

export function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
