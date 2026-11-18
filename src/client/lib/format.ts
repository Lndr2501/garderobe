export function money(value: number | null | undefined, currency = "EUR"): string {
	if (value === null || value === undefined) return "–";
	try {
		return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
	} catch {
		return `${value.toFixed(2)} ${currency}`;
	}
}

export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}
