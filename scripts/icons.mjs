// Renders the PNG app icons from public/icons/icon.svg (run: npm run icons).
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const dir = new URL("../public/icons/", import.meta.url);
const svg = await readFile(new URL("icon.svg", dir));

// Full-bleed variant (no rounded corners) for iOS + maskable, where the OS applies its own mask.
const square = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));

const jobs = [
	{ file: "icon-192.png", size: 192, src: svg },
	{ file: "icon-512.png", size: 512, src: svg },
	{ file: "apple-touch-icon.png", size: 180, src: square },
];
for (const j of jobs) {
	await sharp(j.src, { density: 300 }).resize(j.size, j.size).png().toFile(new URL(j.file, dir).pathname);
	console.log("wrote", j.file);
}

// Maskable: shrink artwork into the 80% safe zone on a full-bleed background.
const inner = await sharp(square, { density: 300 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#3a6ee0" } })
	.composite([{ input: inner, left: 51, top: 51 }])
	.png()
	.toFile(new URL("icon-maskable-512.png", dir).pathname);
console.log("wrote icon-maskable-512.png");
