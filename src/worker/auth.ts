import { getMeta, setMeta } from "./db.ts";

const enc = new TextEncoder();
export const SESSION_COOKIE = "gd_session";
export const SESSION_DAYS = 365;
// Workers caps PBKDF2 iterations at 100k; 20k keeps login well below free-plan CPU limits.
const PBKDF2_ITERATIONS = 20_000;

function b64(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (const b of arr) s += String.fromCharCode(b);
	return btoa(s);
}

function unb64(str: string): Uint8Array {
	const bin = atob(str);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
	return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function timingSafeEqual(a: string, b: string): boolean {
	const ab = enc.encode(a);
	const bb = enc.encode(b);
	let diff = ab.length ^ bb.length;
	const len = Math.max(ab.length, bb.length);
	for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
	return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
	return new Uint8Array(bits);
}

/** Format: pbkdf2$<iterations>$<salt b64>$<hash b64> (compatible with Node's crypto.pbkdf2Sync). */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [algo, iter, salt, hash] = stored.split("$");
	if (algo !== "pbkdf2" || !iter || !salt || !hash) return false;
	const calc = await pbkdf2(password, unb64(salt), Math.min(Number(iter), 100_000));
	return timingSafeEqual(b64(calc), hash);
}

async function sessionKey(db: D1Database): Promise<CryptoKey> {
	let secret = await getMeta(db, "session_secret");
	if (!secret) {
		secret = b64(crypto.getRandomValues(new Uint8Array(32)));
		await db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)`).bind(secret).run();
		secret = (await getMeta(db, "session_secret")) ?? secret;
	}
	return crypto.subtle.importKey("raw", unb64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function rotateSessionSecret(db: D1Database): Promise<void> {
	await setMeta(db, "session_secret", b64(crypto.getRandomValues(new Uint8Array(32))));
}

export async function createSession(db: D1Database): Promise<string> {
	const exp = Date.now() + SESSION_DAYS * 86_400_000;
	const payload = `v1.${exp}.${b64url(crypto.getRandomValues(new Uint8Array(9)))}`;
	const sig = await crypto.subtle.sign("HMAC", await sessionKey(db), enc.encode(payload));
	return `${payload}.${b64url(sig)}`;
}

export async function verifySession(db: D1Database, token: string | undefined): Promise<boolean> {
	if (!token) return false;
	const parts = token.split(".");
	if (parts.length !== 4 || parts[0] !== "v1") return false;
	const exp = Number(parts[1]);
	if (!Number.isFinite(exp) || exp < Date.now()) return false;
	const payload = parts.slice(0, 3).join(".");
	const sig = await crypto.subtle.sign("HMAC", await sessionKey(db), enc.encode(payload));
	return timingSafeEqual(b64url(sig), parts[3]!);
}

export async function getPasswordHash(db: D1Database): Promise<string | null> {
	return getMeta(db, "password_hash");
}

export async function setPassword(db: D1Database, password: string): Promise<void> {
	await setMeta(db, "password_hash", await hashPassword(password));
}

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;

export async function loginBlocked(db: D1Database, ip: string): Promise<boolean> {
	const row = await db
		.prepare(`SELECT count, first_at FROM login_attempts WHERE ip = ?`)
		.bind(ip)
		.first<{ count: number; first_at: number }>();
	if (!row) return false;
	if (Date.now() - row.first_at > WINDOW_MS) return false;
	return row.count >= MAX_ATTEMPTS;
}

export async function recordFailedLogin(db: D1Database, ip: string): Promise<void> {
	const t = Date.now();
	await db
		.prepare(
			`INSERT INTO login_attempts (ip, count, first_at) VALUES (?1, 1, ?2)
			ON CONFLICT(ip) DO UPDATE SET
				count = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE count + 1 END,
				first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`,
		)
		.bind(ip, t, WINDOW_MS)
		.run();
}

export async function clearFailedLogins(db: D1Database, ip: string): Promise<void> {
	await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}
