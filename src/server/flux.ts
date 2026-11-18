// Local Studio transport. SSH settings are only read by the Node process, never by the browser.
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { MAX_IMAGE_BYTES } from "../worker/images.ts";
import type { LocalStudioGenerator } from "../worker/studio.ts";

const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const REMOTE_COMMAND = 'exec /bin/bash "$HOME/.local/libexec/garderobe-flux"';

export function createFluxStudio(env: NodeJS.ProcessEnv): LocalStudioGenerator | undefined {
	const host = env.FLUX_SSH_HOST?.trim();
	if (!host) return undefined;
	const user = env.FLUX_SSH_USER?.trim();
	const identity = env.FLUX_SSH_KEY_FILE?.trim();
	const knownHosts = env.FLUX_SSH_KNOWN_HOSTS?.trim();
	const port = Number(env.FLUX_SSH_PORT ?? 22);

	if (!(isIP(host) || /^[a-z0-9][a-z0-9.-]*$/i.test(host)) || !user || !/^[a-z_][a-z0-9_-]*$/i.test(user)) {
		throw new Error("FLUX_SSH_HOST oder FLUX_SSH_USER ist ungültig.");
	}
	if (!identity || !knownHosts || !isAbsolute(identity) || !isAbsolute(knownHosts)) {
		throw new Error("FLUX_SSH_KEY_FILE und FLUX_SSH_KNOWN_HOSTS brauchen absolute Pfade.");
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FLUX_SSH_PORT ist ungültig.");

	const args = [
		"-F", "/dev/null", "-T",
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "IdentityAgent=none",
		"-o", "StrictHostKeyChecking=yes",
		"-o", `UserKnownHostsFile=${knownHosts}`,
		"-o", "GlobalKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=10",
		"-o", "ServerAliveInterval=15",
		"-o", "ServerAliveCountMax=2",
		"-i", identity, "-l", user, "-p", String(port), "--", host, REMOTE_COMMAND,
	];

	return async (prompt, image, { width, height }) => {
		const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[image.type];
		if (!ext || !image.data.byteLength || image.data.byteLength > MAX_IMAGE_BYTES) {
			throw new Error("FLUX braucht ein JPEG-, PNG- oder WebP-Referenzbild bis 12 MB.");
		}
		const header = Buffer.from(`${width} ${height} ${ext}\n${prompt.replace(/\s+/g, " ").trim()}\n`);
		return new Promise<Buffer>((resolve, reject) => {
			const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "ignore"] });
			const chunks: Buffer[] = [];
			let bytes = 0;
			let failure: Error | undefined;
			const stop = (message: string) => {
				failure ??= new Error(message);
				child.kill("SIGKILL");
			};
			const timeout = setTimeout(() => stop("Der Mac hat nicht innerhalb von 10 Minuten geantwortet."), 10 * 60_000);
			child.on("error", () => {
				failure ??= new Error("SSH konnte auf dem App-Server nicht gestartet werden.");
			});
			child.stdin.on("error", () => {
				// SSH may reject the connection before the input is written. Handle the exit below.
			});
			child.stdout.on("data", (chunk: Buffer) => {
				bytes += chunk.length;
				if (bytes > MAX_IMAGE_BYTES) stop("Das Studio-Bild vom Mac ist größer als 12 MB.");
				else chunks.push(chunk);
			});
			child.on("close", (code) => {
				clearTimeout(timeout);
				if (failure) return reject(failure);
				if (code === 255) return reject(new Error("SSH zum Mac fehlgeschlagen. Prüfe Erreichbarkeit, Schlüssel und Hostschlüssel."));
				if (code === 69 || code === 127) return reject(new Error("FLUX2CLI oder der SSH-Helfer fehlt auf dem Mac."));
				if (code !== 0) return reject(new Error("FLUX2CLI konnte kein Studio-Bild erzeugen. Prüfe die Klein-4B-Modelldateien auf dem Mac."));
				const result = Buffer.concat(chunks, bytes);
				if (!result.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) return reject(new Error("Der Mac hat kein gültiges PNG geliefert."));
				resolve(result);
			});
			child.stdin.write(header);
			child.stdin.end(Buffer.from(image.data));
		});
	};
}
