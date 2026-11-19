import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { colorDef } from "../../shared/taxonomy.ts";
import type { Item } from "../../shared/types.ts";
import { HangerHook } from "./Hanger.tsx";
import { imgUrl } from "../api.ts";
import { frontKey, hasStudio, studioBusy, studioStatusText } from "../lib/studio.ts";
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
		const sideScale = shelf ? 0.6 : 0.54;
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < slots.length; i++) {
			const s = slots[i] as HTMLElement;
			const step = s.offsetWidth || 1;
			const c = s.offsetLeft + step / 2;
			const p = (c - mid) / step;
			const ap = Math.abs(p);
			const t = Math.min(ap, 1);
			const body = s.firstElementChild as HTMLElement | null;
			const piece = body?.querySelector<HTMLElement>(".piece");
			if (body && piece) {
				const w = body.offsetWidth || step;
				// Set visual distance independently of scroll snap, without squeezing either axis.
				const gap = Math.max(step, Math.min(w * (1 + sideScale) / 2, (el.clientWidth - w * sideScale) / 2 - 8));
				const distance = t * gap + Math.max(0, ap - 1) * step;
				const tx = Math.sign(p) * distance - (c - mid);
				body.style.transform = `translate3d(${tx.toFixed(1)}px,0,0)`;
				piece.style.transform = `scale(${(1 - t * (1 - sideScale)).toFixed(3)})`;
				body.style.opacity = ap > 7 ? "0" : "1";
			}
			s.style.zIndex = String(200 - Math.min(199, Math.round(ap * 10)));
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

	// Start in the middle of the rail so garments hang on both sides (like a real closet).
	const started = useRef(false);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && !started.current && items.length > 2) {
			const s = el.children[Math.floor(items.length / 2)] as HTMLElement | undefined;
			if (s) el.scrollLeft = s.offsetLeft + s.offsetWidth / 2 - el.clientWidth / 2;
			started.current = true;
		}
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
		<div className={`rack ${display === "shelf" ? "shelf" : ""} ${items.length === 1 ? "single" : ""}`} aria-label={label}>
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
					const thumb = imgUrl(frontKey(item));
					const studio = hasStudio(item) && !item.preferOriginal;
					const ownHanger = display === "hanger" && !studio && cachedHook(thumb ? new URL(thumb, location.href).href : undefined) === true;
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
							<div className={`swing ${studio ? "studio-cutout" : ownHanger ? "own-hanger" : ""}`}>
								{display === "hanger" && !ownHanger && <HangerHook />}
								<div className="piece">
									<ItemImage
										item={item}
										onLoad={
											display === "hanger" && !studio
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
							{itemSubline(current) && <div className="sub">{itemSubline(current)}</div>}
							{studioBusy(current) && (
								<div className="rack-studio-status" role="status">
									<span className="spinner" aria-hidden="true" />
									{studioStatusText(current)}
								</div>
							)}
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
