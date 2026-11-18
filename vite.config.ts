import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [react()],
	build: { outDir: "dist/client", emptyOutDir: true, chunkSizeWarningLimit: 900 },
	// `npm run dev`: the API runs separately on :8787 (see scripts/dev.mjs).
	server: { proxy: { "/api": "http://localhost:8787" } },
	// jsquash loads its WASM via import.meta.url – pre-bundling would break that path.
	optimizeDeps: { exclude: ["@jsquash/webp"] },
	fmt: { useTabs: true },
	lint: {
		options: { typeAware: true, typeCheck: true },
	},
});
