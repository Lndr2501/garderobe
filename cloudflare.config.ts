import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
	accountId: "24367421a530495b01c9fcfcf69dfe5b",
	worker: {
		name: "garderobe",
		compatibilityDate: "2026-11-17",
		entrypoint,
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: ["/api/*"],
		},
		workersDev: true,
		previewUrls: false,
		observability: { enabled: true },
		exports: {
			// Background AI recognition of new garments (retries, independent of the open app).
			TagWorkflow: exports.workflow({ name: "garderobe-tag" }),
		},
		env: {
			DB: bindings.d1({ id: "8056cc74-19d1-4f2c-987f-b66ca2767a80", name: "garderobe" }),
			IMAGES: bindings.kv({ id: "4a463ebf418a433694c97d5e07f620bd" }),
			TAGGER: bindings.workflow({ name: "garderobe-tag", worker: "garderobe", exportName: "TagWorkflow" }),
			// First-run password setup in the browser is only allowed outside production.
			ALLOW_SETUP: bindings.text(mode === "production" ? "false" : "true"),
		},
	},
}));
