// 3D stage for a piece: tilts with the pointer or the phone's motion sensor, a light sheen follows
// the tilt (masked to the picture), a soft floor shadow, and a gentle float when nothing moves.
import { Move3d } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

function needsPermission(): boolean {
	return typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission === "function";
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** Motion sensor allowed in this session (iOS asks once per page load). */
let motionGranted = false;

export function Stage({ children, shine }: { children: ReactNode; shine?: string | null }) {
	const ref = useRef<HTMLDivElement>(null);
	const [motion, setMotion] = useState(motionGranted || !needsPermission());
	const [askable, setAskable] = useState(needsPermission() && !motionGranted);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const target = { x: 0, y: 0 };
		const cur = { x: 0, y: 0 };
		let lastInput = 0;
		let raf = 0;
		let visible = true;
		let base: number | null = null;

		const tick = (t: number) => {
			raf = 0;
			if (t - lastInput > 2500) {
				// Idle: float slowly so the piece never looks flat.
				target.x = reduce ? 0 : Math.sin(t / 1900) * 0.32;
				target.y = reduce ? 0 : Math.cos(t / 2600) * 0.2;
			}
			cur.x += (target.x - cur.x) * 0.09;
			cur.y += (target.y - cur.y) * 0.09;
			el.style.setProperty("--rx", `${(-cur.y * 9).toFixed(2)}deg`);
			el.style.setProperty("--ry", `${(cur.x * 13).toFixed(2)}deg`);
			el.style.setProperty("--mx", `${(50 - cur.x * 45).toFixed(1)}%`);
			el.style.setProperty("--my", `${(35 - cur.y * 35).toFixed(1)}%`);
			el.style.setProperty("--sx", `${(-cur.x * 14).toFixed(1)}px`);
			el.style.setProperty("--fs", `${(1 - Math.abs(cur.x) * 0.12).toFixed(3)}`);
			if (visible && !document.hidden) raf = requestAnimationFrame(tick);
		};
		const start = () => {
			if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
		};

		const onPointer = (e: PointerEvent) => {
			if (e.pointerType === "touch") return;
			const r = el.getBoundingClientRect();
			target.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1);
			target.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
			lastInput = performance.now();
		};
		const onLeave = () => {
			lastInput = 0;
		};
		const onOrientation = (e: DeviceOrientationEvent) => {
			if (e.gamma === null || e.beta === null) return;
			// Relative to how the phone was held when the page opened.
			base ??= e.beta;
			target.x = clamp(e.gamma / 25);
			target.y = clamp((e.beta - base) / 25);
			lastInput = performance.now();
		};
		const io = new IntersectionObserver(([entry]) => {
			visible = !!entry?.isIntersecting;
			start();
		});
		io.observe(el);
		document.addEventListener("visibilitychange", start);
		el.addEventListener("pointermove", onPointer);
		el.addEventListener("pointerleave", onLeave);
		if (motion && !reduce) window.addEventListener("deviceorientation", onOrientation);
		start();
		return () => {
			cancelAnimationFrame(raf);
			io.disconnect();
			document.removeEventListener("visibilitychange", start);
			el.removeEventListener("pointermove", onPointer);
			el.removeEventListener("pointerleave", onLeave);
			window.removeEventListener("deviceorientation", onOrientation);
		};
	}, [motion]);

	const ask = async () => {
		try {
			const res = await (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission!();
			motionGranted = res === "granted";
			setMotion(motionGranted);
		} catch {
			/* denied or not from a tap */
		}
		setAskable(false);
	};

	return (
		<div className="stage" ref={ref}>
			<div className="stage-tilt">
				{children}
				{shine && <div className="stage-shine" style={{ maskImage: `url("${shine}")`, WebkitMaskImage: `url("${shine}")` }} aria-hidden />}
			</div>
			<div className="stage-floor" aria-hidden />
			{askable && (
				<button type="button" className="stage-motion" onClick={() => void ask()} aria-label="Mit Handy-Bewegung drehen" title="Mit Handy-Bewegung drehen">
					<Move3d size={16} />
				</button>
			)}
		</div>
	);
}
