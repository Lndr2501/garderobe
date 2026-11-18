// Bundles the Node server (API + static files) into one file. `--watch` rebuilds on change.
import { context } from "esbuild";

const watch = process.argv.includes("--watch");
const outfile = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "dist/server/main.mjs";

const ctx = await context({
	entryPoints: ["src/server/main.ts"],
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	outfile,
	sourcemap: true,
	// Some dependencies still call require(); give the ESM bundle one.
	banner: { js: "import { createRequire as __garderobeRequire } from 'node:module'; const require = __garderobeRequire(import.meta.url);" },
	logLevel: "warning",
});
await ctx.rebuild();
if (watch) await ctx.watch();
else await ctx.dispose();
