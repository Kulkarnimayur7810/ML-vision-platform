import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";

// Format: scrypt$N$r$p$saltB64$keyB64
const N = 16384, R = 8, P = 1, KEYLEN = 32;
function scrypt(pw: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  return new Promise((res, rej) => _scrypt(pw, salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, s, k] = parts;
  const expected = Buffer.from(k, "base64");
  const got = await scrypt(pw, Buffer.from(s, "base64"), +n, +r, +p, expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
/** Returns an error message, or null if the password is acceptable. */
export function passwordProblem(pw: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  const low = pw.toLowerCase();
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && low.includes(local)) return "Password must not contain your email name.";
  for (const part of (ctx.name ?? "").toLowerCase().split(/\s+/)) if (part.length >= 3 && low.includes(part)) return "Password must not contain your name.";
  if (/^(.)\1+$/.test(pw) || ["password123", "1234567890", "qwertyuiop"].includes(low)) return "That password is too easy to guess.";
  return null;
}
