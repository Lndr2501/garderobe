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
	// The server (and its settings) is shared by both browser projects.
	const before = (await (await page.request.get("/api/settings")).json()) as { ai: { providers: unknown[] } };
	if (!before.ai.providers.length) {
		await page.getByRole("button", { name: "Eigener" }).click();
		await page.getByLabel("Name des Anbieters").fill("Mock");
		await page.getByPlaceholder("https://api.openai.com/v1").fill("http://localhost:8799/v1");
		await page.getByLabel("Modell für Texte").fill("mock-chat");
		await page.getByLabel("Modell für Erkennung").fill("mock-vision");
		for (const area of ["Studio-Bild", "Anprobe"]) {
			await page.getByLabel(`Anbieter für ${area}`).selectOption({ label: "Mock" });
			await page.getByLabel(`Modell für ${area}`).fill("mock-image");
		}
	}
	await page.getByRole("button", { name: "Testen" }).click();
	await expect(page.getByText("Verbindung klappt")).toBeVisible();
	await expect(page.getByText("3 Modelle gefunden", { exact: false })).toBeVisible();
	const saved = (await (await page.request.get("/api/settings")).json()) as { ai: { areas: Record<string, boolean> } };
	expect(saved.ai.areas).toEqual({ text: true, vision: true, studio: true, tryon: true });
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

	// Studio picture: made by the image model, finished (background) in the app, shown in 3D.
	await page.getByRole("button", { name: "Studio-Bild", exact: true }).click();
	await expect
		.poll(async () => {
			const items = (await (await page.request.get("/api/items")).json()) as (ApiItem & { studioState: string; imageStudio: string | null })[];
			const it = items.find((i) => i.id === added.id)!;
			return `${it.studioState}|${!!it.imageStudio}`;
		}, { timeout: 60_000 })
		.toBe("done|true");
	await expect(page.getByRole("radio", { name: "Studio" })).toBeVisible();
	const studioKey = ((await (await page.request.get(`/api/items/${added.id}`)).json()) as { imageStudio: string }).imageStudio;
	await expect(page.locator(".stage .flip-face img").first()).toHaveAttribute("src", `/api/img/${studioKey}`);
	await page.getByRole("radio", { name: "Dein Foto" }).click();
	await expect(page.getByRole("radio", { name: "Dein Foto" })).toHaveAttribute("aria-checked", "true");
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-studio.png` });
	await page.getByRole("radio", { name: "Studio" }).click();

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

test("layers: dress inside out and fan the layers apart", async ({ page }, info) => {
	await login(page);
	const origin = new URL(page.url()).origin;
	for (const data of [
		{ name: `Thermoshirt ${info.project.name}`, category: "base", subcategory: "Thermoshirt" },
		{ name: `Wollsocken ${info.project.name}`, category: "socks" },
	]) {
		expect((await page.request.post("/api/items", { data, headers: { Origin: origin } })).ok()).toBe(true);
	}
	await page.goto("/outfits/neu");
	await page.getByRole("button", { name: `Rote Strickjacke anziehen` }).first().click();
	await page.getByRole("button", { name: `Shirt ${info.project.name} anziehen`, exact: true }).click();
	await page.getByRole("button", { name: `Thermoshirt ${info.project.name} anziehen`, exact: true }).click();
	await page.getByRole("button", { name: `Wollsocken ${info.project.name} anziehen`, exact: true }).click();
	const torso = page.locator(".zone-block").first().locator(".layer-row .name");
	await expect(torso).toHaveText(["Rote Strickjacke", `Shirt ${info.project.name}`, `Thermoshirt ${info.project.name}`]);
	await page.getByRole("button", { name: `Shirt ${info.project.name} weiter nach innen`, exact: true }).click();
	await expect(torso).toHaveText(["Rote Strickjacke", `Thermoshirt ${info.project.name}`, `Shirt ${info.project.name}`]);
	await page.getByRole("button", { name: "Lagen auffächern" }).click();
	await expect(page.locator(".holo.exploded")).toBeVisible();
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${SHOTS}/${info.project.name}-layers.png` });

	await page.getByRole("button", { name: "Speichern" }).first().click();
	await page.getByPlaceholder("z.B. Sonntagsspaziergang").fill(`Zwiebel ${info.project.name}`);
	await page.locator(".sheet").getByRole("button", { name: "Speichern" }).click();
	await expect(page).toHaveURL(/\/outfits\/[0-9a-f-]{36}$/);
	const outfits = (await (await page.request.get("/api/outfits")).json()) as { name: string; itemIds: string[] }[];
	const items = (await (await page.request.get("/api/items")).json()) as ApiItem[];
	const names = outfits.find((o) => o.name === `Zwiebel ${info.project.name}`)!.itemIds.map((id) => items.find((i) => i.id === id)!.name);
	// Stored inside out, zone by zone.
	expect(names).toEqual([`Shirt ${info.project.name}`, `Thermoshirt ${info.project.name}`, "Rote Strickjacke", `Wollsocken ${info.project.name}`]);
	await page.reload();
	await expect(torso).toHaveText(["Rote Strickjacke", `Thermoshirt ${info.project.name}`, `Shirt ${info.project.name}`]);
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

test("studio: rail keeps the original until the transparent cutout is ready", async ({ page }, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	const original = await sharp(await garment("#32496a")).png().toBuffer();
	const transparent = await sharp(Buffer.from(`<svg width="160" height="180" xmlns="http://www.w3.org/2000/svg"><path d="M50 10h60l40 50-23 25-15-14v95H48V71L33 85 10 60Z" fill="#496188"/></svg>`)).png().toBuffer();
	const upload = async (buffer: Buffer) => {
		const res = await page.request.post("/api/images", { multipart: { file: { name: "piece.png", mimeType: "image/png", buffer } } });
		expect(res.ok()).toBe(true);
		return (await res.json()).key as string;
	};
	const originalKey = await upload(original);
	const cutoutKey = await upload(transparent);
	const res = await page.request.post("/api/items", { data: { name: "Studio-Test", category: "top", imageFront: originalKey } });
	expect(res.ok()).toBe(true);
	const item = await res.json();
	let ready = false;
	await page.route("**/api/items", (route) => route.fulfill({ json: [{ ...item,
		studioState: ready ? "done" : "running", imageStudio: ready ? cutoutKey : "studio/old.png", thumbStudio: ready ? cutoutKey : null,
	}] }));
	await page.goto("/");
	const garmentImage = page.locator(".rack-slot img");
	await expect(garmentImage).toHaveAttribute("src", `/api/img/${originalKey}`);
	await expect(page.locator(".rack-studio-status")).toHaveText(/wird erstellt/);
	ready = true;
	await expect(garmentImage).toHaveAttribute("src", `/api/img/${cutoutKey}`, { timeout: 12_000 });
	await expect(page.locator(".studio-cutout .hook")).toBeVisible();
	await expect(page.locator(".rack-studio-status")).toHaveCount(0);
	await page.locator(".rack").screenshot({ path: `${SHOTS}/${info.project.name}-studio-cutout.png`, animations: "disabled" });
});

test("mobile rail keeps the side garment’s proportions and lets you select it", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await login(page);
	const image = await garment("#242632");
	const upload = await page.request.post("/api/images", { multipart: { file: { name: "rail.jpg", mimeType: "image/jpeg", buffer: image } } });
	const key = (await upload.json()).key;
	const res = await page.request.post("/api/items", { data: { name: "Mitte", category: "top", imageFront: key } });
	const item = await res.json();
	const left = { ...item, id: "rack-left", name: "Links" };
	const right = { ...item, id: "rack-right", name: "Rechts" };
	await page.route("**/api/items", (route) => route.fulfill({ json: [left, item, right] }));
	await page.goto("/");
	const rack = page.locator(".rack").first();
	await expect(rack.locator(".rack-slot.center")).toHaveAccessibleName("Mitte");
	const piece = rack.getByRole("button", { name: "Rechts", exact: true }).locator(".piece");
	const transform = await piece.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).toJSON());
	expect(transform.a).toBeGreaterThan(0.45);
	expect(transform.a).toBeLessThan(0.7);
	expect(transform.a).toBeCloseTo(transform.d);
	const middle = rack.locator(".rack-slot.center .piece");
	expect((await piece.boundingBox())!.x).toBeGreaterThan((await middle.boundingBox())!.x + 110);
	await piece.locator("img").click();
	await expect(rack.locator(".rack-slot.center")).toHaveAccessibleName("Rechts");
	await expect(page).toHaveURL(/\/$/);
});

test("local 3D sends a centered white square as a JPEG reference", async ({ page }) => {
	await login(page);
	const png = await sharp({ create: { width: 700, height: 350, channels: 4, background: "#243a56ff" } }).png().toBuffer();
	const front = await page.request.post("/api/images", { multipart: { file: { name: "test.png", mimeType: "image/png", buffer: png } } });
	const created = await page.request.post("/api/items", { data: { name: "Vorlagen-Test", category: "top", imageFront: (await front.json()).key } });
	const item = await created.json();
	await page.route("**/api/settings", async (route) => {
		const response = await route.fetch();
		const settings = await response.json();
		settings.ai.routes.studio.provider = "local-flux";
		settings.ai.areas.studio = true;
		await route.fulfill({ response, json: settings });
	});
	let jpeg: Buffer | undefined;
	await page.route("**/api/images", async (route) => {
		const req = route.request();
		const form = await new Request(req.url(), { method: "POST", headers: { "Content-Type": req.headers()["content-type"]! }, body: new Uint8Array(req.postDataBuffer()!) }).formData();
		const file = form.get("file") as File;
		jpeg = Buffer.from(await file.arrayBuffer());
		await route.fulfill({ json: { key: (await front.json()).key } });
	});
	await page.route(`**/api/items/${item.id}/studio`, (route) => route.fulfill({ json: { ...item, studioState: "queued" } }));
	await page.goto(`/teil/${item.id}`);
	await page.getByRole("button", { name: "KI-3D-Variante" }).click();
	await expect(page.getByRole("status").filter({ hasText: "Studio-Bild ist in der Warteschlange" })).toBeVisible();
	const image = sharp(jpeg!);
	expect(await image.metadata()).toMatchObject({ format: "jpeg", width: 512, height: 512 });
	const pixels = await image.removeAlpha().raw().toBuffer();
	expect([...pixels.subarray(0, 3)]).toEqual([255, 255, 255]);
	expect(pixels[(256 * 512 + 256) * 3]).toBeLessThan(80);
});

test("pwa: manifest, icons and service worker files are served", async ({ request }) => {
	const m = await request.get("/manifest.webmanifest");
	expect(m.ok()).toBe(true);
	const manifest = (await m.json()) as { icons: { src: string }[] };
	for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
	expect((await request.get("/sw.js")).ok()).toBe(true);
	expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);
});
