import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vite-plus/test";
import { createFluxStudio } from "../src/server/flux.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

it("streams binary input and output through SSH and the Mac helper", async () => {
	const dir = await mkdtemp(join(tmpdir(), "garderobe-test-"));
	try {
		const helper = fileURLToPath(new URL("../scripts/garderobe-flux.sh", import.meta.url));
		const input = Uint8Array.from(png).buffer;
		const prompt = "Professional e-commerce product photo of the sweater's \"front\".\nPreserve all details.";
		const vars = {
			FLUX_SSH_HOST: "mac.test",
			FLUX_SSH_USER: "test",
			FLUX_SSH_PORT: "2222",
			FLUX_SSH_KEY_FILE: join(dir, "key"),
			FLUX_SSH_KNOWN_HOSTS: join(dir, "known_hosts"),
		};
		await writeFile(join(dir, "expected.png"), png);
		await writeFile(join(dir, "ssh"), `#!/bin/bash
set -eu
printf '%s\\n' "$@" > "$FLUX_TEST_DIR/ssh_args"
exec /bin/bash "$FLUX_TEST_HELPER"
`, { mode: 0o700 });
		await writeFile(join(dir, "Flux2CLI"), `#!/bin/bash
set -eu
[[ "$1 $2 $3 $4 $5 $6 $7 $8" == 'i2i --model klein-4b --width 1024 --height 768 --output' ]]
[[ "${"$"}{10}" == "Professional e-commerce product photo of the sweater's \\\"front\\\". Preserve all details." ]]
[[ "${"$"}{11}" == "--images" ]]
cmp "${"$"}{12}" "$FLUX_TEST_DIR/expected.png"
cp "${"$"}{12}" "$9"
echo "CLI progress; must not be mixed with PNG on stdout"
`, { mode: 0o700 });
		vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
		vi.stubEnv("FLUX_TEST_DIR", dir);
		vi.stubEnv("FLUX_TEST_HELPER", helper);
		vi.stubEnv("FLUX2CLI_PATH", join(dir, "Flux2CLI"));
		expect(createFluxStudio({})).toBeUndefined();
		expect(() => createFluxStudio({ ...vars, FLUX_SSH_HOST: "-option" })).toThrow();
		const generate = createFluxStudio(vars)!;
		expect(await generate(prompt, { data: input, type: "image/png" }, { width: 1024, height: 768 })).toEqual(png);
		const args = await readFile(join(dir, "ssh_args"), "utf8");
		expect(args).toContain("StrictHostKeyChecking=yes\n");
		expect(args).toContain(`UserKnownHostsFile=${vars.FLUX_SSH_KNOWN_HOSTS}\n`);
		expect(args).toContain("-l\ntest\n-p\n2222\n--\nmac.test\n");
		expect(args).not.toContain(prompt);
	} finally {
		vi.unstubAllEnvs();
		await rm(dir, { recursive: true, force: true });
	}
});
