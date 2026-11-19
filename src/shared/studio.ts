/** Match the reference framing of the Studio trials. Keep shoe stitching and denim at higher resolution. */
export function studioReferenceEdge(category: string, ...hints: string[]): 512 | 1024 {
	const hint = hints.join(" ").toLowerCase();
	return category === "bottom" || (category === "shoes" && /hausschuh|pantoffel|slipper|clog/.test(hint)) ? 1024 : 512;
}
