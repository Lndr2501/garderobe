// Local development: API server on :8787 (rebuilt and restarted on change) plus Vite with hot reload.
import { spawn } from "node:child_process";

const env = { ...process.env, DATA_DIR: ".dev/data", PORT: "8787", ALLOW_SETUP: "true", STATIC_DIR: "dist/client" };
const run = (cmd, args, extra = {}) => spawn(cmd, args, { stdio: "inherit", ...extra });

const build = run(process.execPath, ["scripts/build-server.mjs", "--watch", "--out=.dev/server.mjs"]);
// Give the first bundle a moment before starting the server in watch mode.
setTimeout(() => {
	run(process.execPath, ["--watch", "--disable-warning=ExperimentalWarning", ".dev/server.mjs"], { env });
	run("npx", ["vp", "dev", ...process.argv.slice(2)]);
}, 1500);
process.on("SIGINT", () => {
	build.kill();
	process.exit(0);
});
