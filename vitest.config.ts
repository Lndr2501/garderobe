import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflareTest({ config: true })],
	test: { include: ["test/**/*.test.ts"] },
});
