/* Garderobe service worker: offline shell, cached images, cached background-removal models. */
const VERSION = "v1";
const SHELL = `gd-shell-${VERSION}`;
const ASSETS = `gd-assets-${VERSION}`;
const IMAGES = "gd-images";
const MODELS = "gd-models";
const KEEP = [SHELL, ASSETS, IMAGES, MODELS];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/apple-touch-icon.png"]))
			.catch(() => {})
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
			.then(() => self.clients.claim()),
	);
});

async function cacheFirst(cacheName, request) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) return hit;
	const res = await fetch(request);
	if (res.ok) cache.put(request, res.clone()).catch(() => {});
	return res;
}

async function trimImages() {
	const cache = await caches.open(IMAGES);
	const keys = await cache.keys();
	const max = 1500;
	if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);

	// Background-removal model + wasm files from the imgly CDN (large, immutable).
	if (url.hostname === "staticimgly.com" || url.hostname.endsWith(".staticimgly.com")) {
		event.respondWith(cacheFirst(MODELS, req));
		return;
	}
	if (url.origin !== self.location.origin) return;

	// Wardrobe images: content-addressed keys → cache first, they never change.
	if (url.pathname.startsWith("/api/img/")) {
		event.respondWith(
			cacheFirst(IMAGES, req).then((res) => {
				trimImages().catch(() => {});
				return res;
			}),
		);
		return;
	}
	if (url.pathname.startsWith("/api/")) return; // live data: network only (TanStack Query persists offline copies)

	if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/")) {
		event.respondWith(cacheFirst(ASSETS, req));
		return;
	}

	if (req.mode === "navigate") {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res.ok) caches.open(SHELL).then((c) => c.put("/", res.clone())).catch(() => {});
					return res;
				})
				.catch(async () => (await caches.match("/", { cacheName: SHELL })) ?? Response.error()),
		);
	}
});
