import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Sheet({ title, onClose, children }: { title?: ReactNode; onClose: () => void; children: ReactNode }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [onClose]);
	return createPortal(
		<div className="sheet-backdrop" onClick={onClose}>
			<div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="grab" />
				{title !== undefined && (
					<div className="row between" style={{ marginBottom: 14 }}>
						<h2>{title}</h2>
						<button className="icon-btn" onClick={onClose} aria-label="Schließen">
							<X size={18} />
						</button>
					</div>
				)}
				{children}
			</div>
		</div>,
		document.body,
	);
}
