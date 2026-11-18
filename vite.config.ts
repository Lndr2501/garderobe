import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [react(), cloudflare()],
	build: { chunkSizeWarningLimit: 900 },
	// jsquash loads its WASM via import.meta.url – pre-bundling would break that path.
	optimizeDeps: { exclude: ["@jsquash/webp"] },
	fmt: { useTabs: true },
	lint: {
		options: { typeAware: true, typeCheck: true },
	},
});
