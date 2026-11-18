import { defineConfig, devices } from "@playwright/test";

const PORT = 5180;

export default defineConfig({
	testDir: "e2e",
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	outputDir: "e2e/.tmp/results",
	use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "de-DE", timezoneId: "Europe/Berlin" },
	projects: [
		{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
		{ name: "iphone-webkit", use: { ...devices["iPhone 15 Pro"] } },
	],
	webServer: [
		{ command: "node e2e/mock-ai.mjs", port: 8799, reuseExistingServer: true, gracefulShutdown: { signal: "SIGTERM", timeout: 1000 } },
		{
			command: `rm -rf e2e/.tmp/data && npm run build && DATA_DIR=e2e/.tmp/data ALLOW_SETUP=true PORT=${PORT} STATIC_DIR=dist/client node --disable-warning=ExperimentalWarning dist/server/main.mjs`,
			url: `http://localhost:${PORT}/api/health`,
			reuseExistingServer: false,
			timeout: 240_000,
			gracefulShutdown: { signal: "SIGTERM", timeout: 3000 },
		},
	],
});
