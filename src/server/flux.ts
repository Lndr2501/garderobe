// Local Studio transport. SSH settings are only read by the Node process, never by the browser.
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { MAX_IMAGE_BYTES } from "../worker/images.ts";
import type { LocalStudio, StudioCutout, StudioReference } from "../worker/studio.ts";

const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const REMOTE_COMMAND = 'exec /bin/bash "$HOME/.local/libexec/garderobe-flux"';

export function createFluxStudio(env: NodeJS.ProcessEnv): LocalStudio | undefined {
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

	const send = async (mode: "studio-9b" | "cutout", prompt: string, image: StudioReference, width: number, height: number) => {
		const ext = {
			"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
			...(mode === "cutout" ? { "image/gif": "gif", "image/avif": "avif" } : {}),
		}[image.type];
		if (!ext || !image.data.byteLength || image.data.byteLength > MAX_IMAGE_BYTES) {
			throw new Error("Das Bildformat wird auf dem Mac nicht unterstützt oder das Bild ist größer als 12 MB.");
		}
		const header = Buffer.from(`${width} ${height} ${ext} ${mode}\n${prompt.replace(/\s+/g, " ").trim()}\n`);
		return new Promise<StudioCutout>((resolve, reject) => {
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
				if (bytes > MAX_IMAGE_BYTES * 2 + 32) stop("Die Ausgabe vom Mac ist zu groß.");
				else chunks.push(chunk);
			});
			child.on("close", (code) => {
				clearTimeout(timeout);
				if (failure) return reject(failure);
				if (code === 255) return reject(new Error("SSH zum Mac fehlgeschlagen. Prüfe Erreichbarkeit, Schlüssel und Hostschlüssel."));
				if (code === 69 || code === 127) return reject(new Error("FLUX2CLI oder der SSH-Helfer fehlt auf dem Mac."));
				if (code === 73) return reject(new Error("Der Helfer zum Freistellen fehlt auf dem Mac."));
				if (code === 74) return reject(new Error("Das Kleidungsstück konnte nicht sauber freigestellt werden."));
				if (code !== 0) return reject(new Error("Der Mac konnte das Studio-Bild nicht verarbeiten."));
				try {
					resolve(parseCutout(Buffer.concat(chunks, bytes)));
				} catch (err) {
					reject(err);
				}
			});
			child.stdin.write(header);
			child.stdin.end(Buffer.from(image.data));
		});
	};
	return {
		generate: (prompt, image, { width, height }) => send("studio-9b", prompt, image, width, height),
		cutout: (image) => send("cutout", "", image, 0, 0),
	};
}

/** Read the full image and thumbnail from a versioned, length-prefixed response. */
function parseCutout(result: Buffer): StudioCutout {
	const end = result.indexOf(10);
	const match = end > 0 && end < 32 && /^GARDEROBE\/2 ([0-9]+)$/.exec(result.toString("ascii", 0, end));
	if (!match) throw new Error("Der Mac hat keine freigestellten Bilder geliefert. Prüfe den SSH-Helfer.");
	const fullLength = Number(match[1]);
	const full = result.subarray(end + 1, end + 1 + fullLength);
	const thumb = result.subarray(end + 1 + fullLength);
	for (const png of [full, thumb]) {
		// RGBA PNG (IHDR color type 6), not an opaque RGB render from an older helper.
		if (png.length < 33 || png.length > MAX_IMAGE_BYTES || !png.subarray(0, PNG_HEADER.length).equals(PNG_HEADER) || png[25] !== 6) {
			throw new Error("Der Mac hat kein gültiges PNG mit Alphakanal geliefert.");
		}
	}
	return { full, thumb };
}
