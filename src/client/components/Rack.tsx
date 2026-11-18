import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { colorDef } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { Hanger } from "./Hanger.tsx";
import { ItemImage } from "./ItemImage.tsx";

export function itemSubline(item: Item): string {
	return [item.colors.map((c) => colorDef(c)?.label ?? c).join(" & "), item.material, item.fit]
		.filter(Boolean)
		.join("  |  ");
}

interface RackProps {
	items: Item[];
	display: "hanger" | "shelf";
	onOpen: (item: Item) => void;
	label?: string;
}

export function Rack({ items, display, onOpen, label }: RackProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [center, setCenter] = useState(0);
	const centerRef = useRef(0);
	const frame = useRef(0);

	const update = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const mid = el.scrollLeft + el.clientWidth / 2;
		const slots = el.children;
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < slots.length; i++) {
			const s = slots[i] as HTMLElement;
			const c = s.offsetLeft + s.offsetWidth / 2;
			const dist = (c - mid) / (s.offsetWidth * 1.7);
			const p = Math.max(-1, Math.min(1, dist));
			s.style.setProperty("--p", p.toFixed(3));
			s.style.setProperty("--ap", Math.abs(p).toFixed(3));
			s.style.zIndex = String(100 - Math.min(99, Math.round(Math.abs(dist) * 10)));
			if (Math.abs(c - mid) < bestD) {
				bestD = Math.abs(c - mid);
				best = i;
			}
		}
		if (best !== centerRef.current) {
			centerRef.current = best;
			setCenter(best);
		}
	}, []);

	useLayoutEffect(() => {
		update();
	}, [items, update]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			cancelAnimationFrame(frame.current);
			frame.current = requestAnimationFrame(update);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			el.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			cancelAnimationFrame(frame.current);
		};
	}, [update]);

	const scrollToIndex = (i: number) => {
		const el = scrollRef.current;
		const s = el?.children[i] as HTMLElement | undefined;
		if (!el || !s) return;
		el.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - el.clientWidth / 2, behavior: "smooth" });
	};

	const current = items[Math.min(center, items.length - 1)];

	return (
		<div className={`rack ${display === "shelf" ? "shelf" : ""}`} aria-label={label}>
			{display === "hanger" && <div className="rail" />}
			{display === "shelf" && <div className="shelf-board" />}
			<div
				className="rack-scroll"
				ref={scrollRef}
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "ArrowRight") scrollToIndex(Math.min(items.length - 1, center + 1));
					else if (e.key === "ArrowLeft") scrollToIndex(Math.max(0, center - 1));
					else if (e.key === "Enter" && current) onOpen(current);
					else return;
					e.preventDefault();
				}}
				style={{ paddingInline: "calc(50% - var(--slot-w, 96px) / 2)" }}
			>
				{items.map((item, i) => (
					<button
						key={item.id}
						type="button"
						className={`rack-slot ${i === center ? "center" : ""}`}
						aria-label={item.name || "Kleidungsstück"}
						tabIndex={-1}
						onClick={() => (i === center ? onOpen(item) : scrollToIndex(i))}
					>
						<div className="swing">
							{display === "hanger" && <Hanger />}
							<div className="piece">
								<ItemImage item={item} />
							</div>
						</div>
					</button>
				))}
			</div>
			<div className="row between" style={{ alignItems: "flex-start" }}>
				<button className="icon-btn hide-mobile" style={{ visibility: center > 0 ? "visible" : "hidden" }} onClick={() => scrollToIndex(center - 1)} aria-label="Zurück">
					<ChevronLeft size={18} />
				</button>
				<div className="rack-label" style={{ flex: 1 }}>
					{current && (
						<>
							<div className="name">{current.name || "Ohne Namen"}</div>
							<div className="sub">{itemSubline(current)}</div>
						</>
					)}
				</div>
				<button
					className="icon-btn hide-mobile"
					style={{ visibility: center < items.length - 1 ? "visible" : "hidden" }}
					onClick={() => scrollToIndex(center + 1)}
					aria-label="Weiter"
				>
					<ChevronRight size={18} />
				</button>
			</div>
		</div>
	);
}
