export function localDate(d = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function parseLocal(date: string): Date {
	return new Date(`${date.slice(0, 10)}T12:00:00`);
}

export function addDays(date: string, n: number): string {
	const d = parseLocal(date);
	d.setDate(d.getDate() + n);
	return localDate(d);
}

export function daysBetween(a: string, b: string): number {
	return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000);
}

const fmtLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const fmtWd = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

export const formatLong = (date: string) => fmtLong.format(parseLocal(date));
export const formatShort = (date: string) => fmtShort.format(parseLocal(date));
export const formatMonth = (d: Date) => fmtMonth.format(d);
export const formatWeekday = (date: string) => fmtWd.format(parseLocal(date)).replace(".", "");

export function relativeDays(date: string | null): string {
	if (!date) return "nie";
	const n = daysBetween(date, localDate());
	if (n <= 0) return "heute";
	if (n === 1) return "gestern";
	if (n < 7) return `vor ${n} Tagen`;
	if (n < 60) return `vor ${Math.round(n / 7)} Wochen`;
	return `vor ${Math.round(n / 30)} Monaten`;
}

export function greeting(d = new Date()): string {
	const h = d.getHours();
	if (h >= 5 && h < 11) return "Guten Morgen";
	if (h >= 11 && h < 17) return "Hallo";
	if (h >= 17 && h < 22) return "Guten Abend";
	return "Gute Nacht";
}

export function timeOfDay(d = new Date()): "morning" | "day" | "evening" | "night" {
	const h = d.getHours() + d.getMinutes() / 60;
	if (h >= 5.5 && h < 9) return "morning";
	if (h >= 9 && h < 17.5) return "day";
	if (h >= 17.5 && h < 21) return "evening";
	return "night";
}
