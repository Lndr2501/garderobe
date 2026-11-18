import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { colorDef } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { HangerHook } from "./Hanger.tsx";
import { imgUrl } from "../api.ts";
import { cachedHook, detectHook } from "../lib/hanger.ts";
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
	const [, setHooks] = useState(0);
	const frame = useRef(0);

	const update = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const mid = el.scrollLeft + el.clientWidth / 2;
		const slots = el.children;
		const shelf = display === "shelf";
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < slots.length; i++) {
			const s = slots[i] as HTMLElement;
			const w = s.offsetWidth || 1;
			const c = s.offsetLeft + w / 2;
			const p = (c - mid) / w;
			const ap = Math.abs(p);
			// Centre piece full size, neighbours smaller and tucked behind it, far ones fade out.
			const scale = 1 - Math.min(ap, 2) * (shelf ? 0.12 : 0.15);
			const tx = -Math.sign(p) * Math.max(0, ap - 1) * w * 0.32;
			const opacity = Math.max(0, Math.min(1, 1 - (ap - 2.2) * 1.4));
			const body = s.firstElementChild as HTMLElement | null;
			if (body) {
				body.style.transform = `translate(${tx.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
				body.style.opacity = opacity.toFixed(2);
			}
			s.style.zIndex = String(100 - Math.min(99, Math.round(ap * 10)));
			if (Math.abs(c - mid) < bestD) {
				bestD = Math.abs(c - mid);
				best = i;
			}
		}
		if (best !== centerRef.current) {
			centerRef.current = best;
			setCenter(best);
		}
	}, [display]);

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
			>
				{items.map((item, i) => {
					const thumb = imgUrl(item.thumbFront ?? item.imageFront);
					const ownHanger = display === "hanger" && cachedHook(thumb ? new URL(thumb, location.href).href : undefined) === true;
					return (
					<button
						key={item.id}
						type="button"
						className={`rack-slot ${i === center ? "center" : ""}`}
						aria-label={item.name || "Kleidungsstück"}
						tabIndex={-1}
						onClick={() => (i === center ? onOpen(item) : scrollToIndex(i))}
					>
						<div className="slot-body">
							<div className={`swing ${ownHanger ? "own-hanger" : ""}`}>
								{display === "hanger" && !ownHanger && <HangerHook />}
								<div className="piece">
									<ItemImage
										item={item}
										onLoad={
											display === "hanger"
												? (img) => {
														if (detectHook(img)) setHooks((n) => n + 1);
													}
												: undefined
										}
									/>
								</div>
							</div>
						</div>
					</button>
					);
				})}
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
					{items.length > 1 && items.length <= 14 && (
						<div className="rack-dots" aria-hidden="true">
							{items.map((it, i) => (
								<span key={it.id} className={i === center ? "on" : ""} />
							))}
						</div>
					)}
					{items.length > 14 && (
						<div className="tiny faint">
							{center + 1} / {items.length}
						</div>
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
