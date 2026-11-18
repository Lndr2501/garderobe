import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const PW = "e2e-passwort-123";
const SHOTS = "e2e/.tmp/shots";
mkdirSync(SHOTS, { recursive: true });

async function garment(color: string): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
		<rect width="100%" height="100%" fill="#eeece8"/>
		<path d="M200 150 L400 150 L520 290 L450 340 L420 300 L420 700 L180 700 L180 300 L150 340 L80 290 Z" fill="${color}"/>
	</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function login(page: Page) {
	await page.goto("/");
	const pw = page.getByRole("textbox", { name: "Passwort", exact: true });
	await expect(pw).toBeVisible();
	await pw.fill(PW);
	// Status loads async – the "repeat" field appears only in setup mode.
	await page.waitForLoadState("networkidle");
	const repeat = page.getByLabel("Passwort wiederholen");
	if (await repeat.isVisible()) await repeat.fill(PW);
	await page.locator("form.login-card button.btn.primary").click();
	await expect(page.getByLabel("Teil hinzufügen")).toBeVisible();
}

interface ApiItem {
	id: string;
	name: string;
	createdAt: string;
	imageFront: string;
	aiState: string;
	rotate: number;
}

async function newestItem(page: Page): Promise<ApiItem> {
	const items = (await (await page.request.get("/api/items")).json()) as ApiItem[];
	return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
}

/** Adds one photo on the "Neue Teile" page and saves it; returns the created item. */
async function addPhoto(page: Page, file: { name: string; buffer: Buffer }, opts: { removeBg?: boolean; category?: string; timeout?: number } = {}): Promise<ApiItem> {
	await page.goto("/neu");
	await page.getByRole("button", { name: "Optionen" }).click();
	const bg = page.getByRole("switch", { name: "Hintergrund entfernen" });
	if ((await bg.getAttribute("aria-checked")) !== String(!!opts.removeBg)) await bg.click();
	await page.locator('input[type="file"][multiple]').setInputFiles({ name: file.name, mimeType: "image/jpeg", buffer: file.buffer });
	if (opts.category) await page.getByLabel("Kategorie").selectOption({ label: opts.category });
	const save = page.getByRole("button", { name: /in den Schrank/ });
	await expect(save).toBeEnabled({ timeout: opts.timeout ?? 30_000 });
	await page.screenshot({ path: `${SHOTS}/add-${file.name}.png` });
	await save.click();
	await expect(page).toHaveURL(/\/$/);
	return newestItem(page);
}

/** Without AI the name is set on the edit page. */
async function addItem(page: Page, name: string, color: string, category = "Oberteil") {
	const item = await addPhoto(page, { name: "teil.jpg", buffer: await garment(color) }, { category });
	await page.goto(`/teil/${item.id}/bearbeiten`);
	await page.getByPlaceholder("z.B. Creme Teddy-Jacke").fill(name);
	await page.getByRole("button", { name: "Speichern" }).first().click();
	await expect(page).toHaveURL(new RegExp(`/teil/${item.id}$`));
	await expect(page.getByText(name).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("core: add item, wear it, see it in wardrobe and stats", async ({ page }, info) => {
	await login(page);
	const name = `Shirt ${info.project.name}`;
	await addItem(page, name, "#2f6fd6");
	await page.getByRole("button", { name: /Heute getragen/ }).click();
	await expect(page.getByText("Als heute getragen eingetragen")).toBeVisible();

	await page.goto("/");
	const rackImg = page.locator(".rack-slot img").first();
	await expect(rackImg).toBeVisible();
	await expect.poll(() => rackImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
	await page.waitForLoadState("networkidle");
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-wardrobe-rack.png` });
	await page.getByLabel("Raster").click();
	await expect(page.getByText(name).first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-wardrobe-grid.png`, fullPage: true });

	await page.goto("/outfits");
	await expect(page.getByText(/nach Wetter|von der KI/).first()).toBeVisible();

	await page.goto("/statistik");
	await expect(page.getByText(/getragen/i).first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-stats.png`, fullPage: true });
});

test("ai: connect mock provider, auto-tag, chat, try-on, shopping, packing", async ({ page }, info) => {
	await login(page);
	await page.goto("/einstellungen");
	await page.getByPlaceholder("https://api.openai.com/v1").fill("http://localhost:8799/v1");
	await page.getByPlaceholder("gpt-4.1-mini").fill("mock-chat");
	await page.getByPlaceholder("gpt-image-1").fill("mock-image");
	await page.getByRole("button", { name: "Verbindung testen" }).click();
	await expect(page.getByText("Verbindung klappt")).toBeVisible();
	await expect(page.getByText("3 Modelle gefunden", { exact: false })).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-settings.png`, fullPage: true });

	// Recognition runs on the server (workflow); the app shows progress and turns the photo upright.
	const added = await addPhoto(page, { name: "jacke.jpg", buffer: await garment("#c0392b") });
	await expect(page.getByText(/KI sortiert|Rote Strickjacke/).first()).toBeVisible();
	await expect
		.poll(async () => {
			const items = (await (await page.request.get("/api/items")).json()) as ApiItem[];
			const it = items.find((i) => i.id === added.id)!;
			return `${it.aiState}|${it.name}|${it.rotate}|${it.imageFront !== added.imageFront}`;
		}, { timeout: 60_000 })
		.toBe("done|Rote Strickjacke|0|true");
	await page.goto(`/teil/${added.id}`);
	await expect(page.getByText("Rote Strickjacke").first()).toBeVisible();
	const dims = await page.evaluate(async (src) => {
		const img = new Image();
		img.src = src;
		await img.decode();
		return { w: img.naturalWidth, h: img.naturalHeight };
	}, `/api/img/${(await newestItem(page)).imageFront}`);
	// The 600×800 test photo was reported "collar left" → turned 90°, so it is now wider than tall.
	expect(dims.w).toBeGreaterThan(dims.h);

	await page.goto("/outfits");
	await expect(page.getByText("KI-Kombi").first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-outfits.png`, fullPage: true });

	await page.goto("/assistent");
	await page.getByPlaceholder("Frag Bügel …").fill("Was zieh ich heute an?");
	await page.getByRole("button", { name: "Senden" }).click();
	await expect(page.getByText("Hallo vom Mock!")).toBeVisible();
	await expect(page.locator(".item-ref").first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-assistant.png` });

	await page.goto("/anprobe");
	await page.getByRole("radio", { name: "KI-Anprobe" }).click();
	const person = page.locator('input[type="file"]').first();
	if (await page.getByRole("button", { name: "Foto hochladen" }).isVisible()) {
		await person.setInputFiles({ name: "ich.jpg", mimeType: "image/jpeg", buffer: await garment("#888888") });
		await expect(page.getByAltText("Dein Foto")).toBeVisible();
	}
	await page.getByRole("button", { name: "Teile wählen" }).click();
	await page.locator(".sheet .tile").first().click();
	await page.locator(".sheet").getByRole("button", { name: /Fertig|Übernehmen|Auswählen/ }).click();
	await page.getByRole("button", { name: "Anprobieren" }).click();
	await expect(page.locator(".sheet img[alt='Anprobe']")).toBeVisible();
	await page.keyboard.press("Escape");

	await page.goto("/shopping");
	await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "laden.jpg", mimeType: "image/jpeg", buffer: await garment("#1e5bd8") });
	await page.getByRole("button", { name: "Prüfen" }).click();
	await expect(page.getByText("Kaufen!")).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-shopping.png`, fullPage: true });

	await page.goto("/reisen");
	await page.getByRole("button", { name: "Reise" }).click();
	await page.getByPlaceholder("Stadt, z.B. Barcelona").fill("Testhausen");
	await page.getByRole("button", { name: "Packliste erstellen" }).click();
	await expect(page).toHaveURL(/\/reisen\/[0-9a-f-]{36}$/);
	await expect(page.getByText("Zahnbürste")).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-trip.png`, fullPage: true });
});

test("background removal runs on-device and yields a transparent cut-out", async ({ page }, info) => {
	test.setTimeout(300_000);
	await login(page);
	const item = await addPhoto(page, { name: "freisteller.jpg", buffer: await garment("#2e8b57") }, { removeBg: true, category: "Oberteil", timeout: 240_000 });
	const key = item.imageFront;
	const corner = await page.evaluate(async (src) => {
		const img = new Image();
		img.src = src;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const ctx = c.getContext("2d")!;
		ctx.drawImage(img, 0, 0);
		return { alpha: ctx.getImageData(1, 1, 1, 1).data[3], w: img.naturalWidth, h: img.naturalHeight };
	}, `/api/img/${key}`);
	expect(corner.alpha).toBeLessThan(30);
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-bg-removed.png` });
});

test("pwa: manifest, icons and service worker files are served", async ({ request }) => {
	const m = await request.get("/manifest.webmanifest");
	expect(m.ok()).toBe(true);
	const manifest = (await m.json()) as { icons: { src: string }[] };
	for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
	expect((await request.get("/sw.js")).ok()).toBe(true);
	expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);
});
