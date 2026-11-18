// Self-hosted entry point (Docker): API + static app on one port, data in DATA_DIR.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSchema } from "../worker/db.ts";
import app, { type Bindings } from "../worker/index.ts";
import { JobRunner } from "../worker/jobs.ts";
import type { Background } from "../worker/platform.ts";
import { repairLegacyStudio, runLocalStudioJob, runStudioJob, type StudioParams } from "../worker/studio.ts";
import { runTagJob, type TagParams } from "../worker/tagging.ts";
import { FileBlobStore } from "./files.ts";
import { createFluxStudio } from "./flux.ts";
import { SqliteDb } from "./sqlite.ts";

const PORT = Number(process.env.PORT ?? 8000);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const STATIC_DIR = process.env.STATIC_DIR ?? "dist/client";
const TRUST_PROXY = process.env.TRUST_PROXY !== "false";

mkdirSync(join(DATA_DIR, "images"), { recursive: true });
const db = new SqliteDb(join(DATA_DIR, "garderobe.db"));
const log = (msg: string, err?: unknown) => console.error(`[garderobe] ${msg}`, err ?? "");
const jobs = new JobRunner(db, { concurrency: 3, log });
// Studio pictures one after another: they may wait a whole day for the free allowance
// and must not block photo recognition.
const studioJobs = new JobRunner(db, { concurrency: 1, log });
// A sleeping Cloudflare job must not block the Mac, and the Mac generates one image at a time.
const localStudioJobs = new JobRunner(db, { concurrency: 1, log });

const env: Bindings = {
	DB: db,
	IMAGES: new FileBlobStore(join(DATA_DIR, "images")),
	ALLOW_SETUP: process.env.ALLOW_SETUP ?? "false",
	FLUX_STUDIO: createFluxStudio(process.env),
};
env.TAGGER = jobs.register<TagParams>("tag", (params, step) => runTagJob(env, params, step));
env.STUDIO = studioJobs.register<StudioParams>("studio", (params, step) => runStudioJob(env, params, step));
env.LOCAL_STUDIO = localStudioJobs.register<StudioParams>("studio-local", (params, step) => runLocalStudioJob(env, params, step));

const background = {
	waitUntil(p: Promise<unknown>) {
		p.catch((err: unknown) => log("background task failed", err));
	},
	passThroughOnException() {},
	props: {},
} satisfies Background & Record<string, unknown>;

const web = new Hono();
web.all("/api/*", (c) => app.fetch(c.req.raw, env, background as never));
web.use(
	"/assets/*",
	serveStatic({ root: STATIC_DIR, onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable") }),
);
web.use(
	"*",
	serveStatic({
		root: STATIC_DIR,
		onFound: (path, c) => {
			if (/(sw\.js|\.webmanifest|\.html)$/.test(path)) c.header("Cache-Control", "no-cache");
		},
	}),
);
// Single-page app: every other path gets the shell.
web.get("*", serveStatic({ root: STATIC_DIR, path: "index.html", onFound: (_p, c) => c.header("Cache-Control", "no-cache") }));

/** Behind Caddy the request arrives as http://; cookies and the CSRF check need the public URL. */
function publicRequest(req: Request): Request {
	if (!TRUST_PROXY) return req;
	const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
	const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
	if (!proto && !host) return req;
	const url = new URL(req.url);
	if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
	if (host) url.host = host;
	if (url.href === req.url) return req;
	return new Request(url, {
		method: req.method,
		headers: req.headers,
		body: req.body,
		signal: req.signal,
		duplex: "half",
	} as RequestInit);
}

await ensureSchema(db);
// Existing renders need only a quick cutout. Put them ahead of expensive queued generations.
await repairLegacyStudio(env);
const resumed = (await jobs.resume()) + (await studioJobs.resume()) + (await localStudioJobs.resume());
const server = serve({ fetch: (req) => web.fetch(publicRequest(req)), port: PORT, hostname: "0.0.0.0" }, (info) => {
	console.log(`[garderobe] listening on :${info.port}, data in ${DATA_DIR}${resumed ? `, ${resumed} job(s) resumed` : ""}`);
});

function shutdown() {
	server.close(() => {
		db.close();
		process.exit(0);
	});
	setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
