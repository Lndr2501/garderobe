import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { COLORS } from "../../shared/taxonomy.ts";

export function ChipSelect<T extends string>({
	options,
	value,
	onChange,
	multi = false,
}: {
	options: { key: T; label: string }[];
	value: T[];
	onChange: (v: T[]) => void;
	multi?: boolean;
}) {
	return (
		<div className="chips">
			{options.map((o) => {
				const on = value.includes(o.key);
				return (
					<button
						type="button"
						key={o.key}
						className={`chip ${on ? "on" : ""}`}
						aria-pressed={on}
						onClick={() => {
							if (multi) onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key]);
							else onChange(on ? [] : [o.key]);
						}}
					>
						{on && multi && <Check size={14} />}
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

export function swatchStyle(hex: string): CSSProperties {
	return hex === "conic-gradient"
		? { background: "conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)" }
		: { background: hex };
}

export function ColorSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
	return (
		<div className="chips" style={{ gap: 10 }}>
			{COLORS.map((c) => {
				const idx = value.indexOf(c.key);
				return (
					<button
						type="button"
						key={c.key}
						title={c.label}
						aria-label={c.label}
						aria-pressed={idx >= 0}
						className={`swatch ${idx >= 0 ? "on" : ""}`}
						style={swatchStyle(c.hex)}
						onClick={() => onChange(idx >= 0 ? value.filter((v) => v !== c.key) : [...value, c.key])}
					>
						{idx >= 0 && value.length > 1 && <span className="order">{idx + 1}</span>}
					</button>
				);
			})}
		</div>
	);
}

export function Segmented<T extends string | number>({
	options,
	value,
	onChange,
}: {
	options: { key: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
}) {
	return (
		<div className="segmented" role="radiogroup">
			{options.map((o) => (
				<button type="button" key={String(o.key)} role="radio" aria-checked={o.key === value} className={o.key === value ? "on" : ""} onClick={() => onChange(o.key)}>
					{o.label}
				</button>
			))}
		</div>
	);
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
	return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Meter({ value, max = 5 }: { value: number; max?: number }) {
	return (
		<span className="meter" aria-label={`${value} von ${max}`}>
			{Array.from({ length: max }, (_, i) => (
				<i key={i} className={i < value ? "on" : ""} />
			))}
		</span>
	);
}
