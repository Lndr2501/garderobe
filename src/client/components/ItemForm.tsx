import { Sparkles } from "lucide-react";
import { CATEGORIES, FORMALITY_LABELS, PATTERNS, SEASONS, STYLE_TAGS, WARMTH_LABELS, type CategoryKey } from "../../shared/taxonomy.ts";
import type { ItemInput } from "../../shared/types.ts";
import { ChipSelect, ColorSelect, Segmented, Switch } from "./Inputs.tsx";

export function ItemForm({
	value,
	onChange,
	onAiFill,
	aiBusy,
	currency = "EUR",
}: {
	value: ItemInput;
	onChange: (v: ItemInput) => void;
	onAiFill?: () => void;
	aiBusy?: boolean;
	currency?: string;
}) {
	const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]) => onChange({ ...value, [k]: v });
	return (
		<div className="stack" style={{ gap: 16 }}>
			{onAiFill && (
				<button type="button" className="btn soft" onClick={onAiFill} disabled={aiBusy}>
					{aiBusy ? <span className="spinner" /> : <Sparkles size={17} />} {aiBusy ? "KI schaut sich das Teil an …" : "Mit KI ausfüllen"}
				</button>
			)}
			<label className="field">
				<span>Name</span>
				<input className="input" value={value.name ?? ""} placeholder="z.B. Creme Teddy-Jacke" onChange={(e) => set("name", e.target.value)} maxLength={80} />
			</label>
			<div className="field">
				<span>Kategorie</span>
				<ChipSelect<CategoryKey>
					options={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
					value={value.category ? [value.category] : []}
					onChange={(v) => set("category", v[0] ?? value.category)}
				/>
			</div>
			<label className="field">
				<span>Typ</span>
				<input className="input" value={value.subcategory ?? ""} placeholder="z.B. Hoodie, Chino, Sneaker" onChange={(e) => set("subcategory", e.target.value)} maxLength={60} />
			</label>
			<div className="field">
				<span>Farben (Hauptfarbe zuerst)</span>
				<ColorSelect value={value.colors ?? []} onChange={(v) => set("colors", v)} />
			</div>
			<div className="field">
				<span>Muster</span>
				<ChipSelect options={PATTERNS.map((p) => ({ key: p, label: p }))} value={value.pattern ? [value.pattern] : []} onChange={(v) => set("pattern", v[0] ?? "")} />
			</div>
			<div className="grid grid-2">
				<label className="field">
					<span>Material</span>
					<input className="input" value={value.material ?? ""} placeholder="Baumwolle" onChange={(e) => set("material", e.target.value)} />
				</label>
				<label className="field">
					<span>Passform</span>
					<input className="input" value={value.fit ?? ""} placeholder="oversized" onChange={(e) => set("fit", e.target.value)} />
				</label>
			</div>
			<div className="field">
				<span>Wärme · {WARMTH_LABELS[value.warmth ?? 3]}</span>
				<Segmented options={[1, 2, 3, 4, 5].map((n) => ({ key: n, label: String(n) }))} value={value.warmth ?? 3} onChange={(v) => set("warmth", v)} />
			</div>
			<div className="field">
				<span>Stil · {FORMALITY_LABELS[value.formality ?? 2]}</span>
				<Segmented options={[1, 2, 3, 4, 5].map((n) => ({ key: n, label: String(n) }))} value={value.formality ?? 2} onChange={(v) => set("formality", v)} />
			</div>
			<div className="field">
				<span>Saisons</span>
				<ChipSelect multi options={SEASONS.map((s) => ({ key: s.key as string, label: s.label }))} value={value.seasons ?? []} onChange={(v) => set("seasons", v)} />
			</div>
			<div className="field">
				<span>Tags</span>
				<ChipSelect multi options={STYLE_TAGS.map((s) => ({ key: s, label: s }))} value={value.styleTags ?? []} onChange={(v) => set("styleTags", v)} />
			</div>
			<div className="row between">
				<span className="label">Wasserdicht</span>
				<Switch label="Wasserdicht" on={!!value.waterproof} onChange={(v) => set("waterproof", v)} />
			</div>
			<div className="grid grid-2">
				<label className="field">
					<span>Marke</span>
					<input className="input" value={value.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
				</label>
				<label className="field">
					<span>Größe</span>
					<input className="input" value={value.size ?? ""} onChange={(e) => set("size", e.target.value)} />
				</label>
				<label className="field">
					<span>Preis ({currency})</span>
					<input
						className="input"
						inputMode="decimal"
						value={value.price ?? ""}
						onChange={(e) => {
							const v = e.target.value.replace(",", ".");
							set("price", v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : value.price);
						}}
					/>
				</label>
				<label className="field">
					<span>Gekauft am</span>
					<input className="input" type="date" value={value.purchasedAt ?? ""} onChange={(e) => set("purchasedAt", e.target.value || null)} />
				</label>
			</div>
			<label className="field">
				<span>Notizen</span>
				<textarea className="textarea" value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Pflegehinweise, Geschenk von …" />
			</label>
		</div>
	);
}
