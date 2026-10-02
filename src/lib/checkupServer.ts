// Server-side helpers for the public research form's routes (/api/checkup, /api/checkup/event): who is
// asking (as a keyed hash, never the raw address), how much they may write, and reading a body without
// letting a large one cost memory. The shared rules live in checkup.ts.
import { createHmac } from "node:crypto";
import { BODY_MAX_BYTES } from "./checkup";

/**
 * The unit an address is counted by. IPv4: the address. IPv6: its /64 — one subscriber usually holds a
 * whole /64, so counting single IPv6 addresses would hand an attacker billions of fresh "addresses".
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) is treated as the IPv4 address.
 */
export function ipBucket(ip: string | null): string | null {
  if (!ip) return null;
  const raw = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;
  const groups = expandIpv6(raw);
  return groups ? groups.slice(0, 4).join(":") + "::/64" : raw.toLowerCase();
}

function expandIpv6(ip: string): string[] | null {
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // A trailing embedded IPv4 (…:1.2.3.4) takes two groups; only the first four groups matter here anyway.
  const width = (parts: string[]) => parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const missing = 8 - width(head) - width(tail);
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g) || g.includes("."))) return null;
  return groups.map((g) => (g.includes(".") ? g : g.padStart(4, "0")));
}

/**
 * A keyed hash of the address bucket, stored for spam checks only. Keyed with a server secret, so a copy
 * of the database alone cannot be turned back into addresses by hashing all four billion IPv4s.
 */
export function hashIp(bucket: string | null): string | null {
  if (!bucket) return null;
  const secret = process.env.CHECKUP_IP_SECRET || process.env.JWT_SECRET || "dev-only-secret-change-me-in-production";
  return createHmac("sha256", `parva-checkup-ip:${secret}`).update(bucket).digest("hex").slice(0, 32);
}

/** Ceiling on new answer sheets per rolling 24 hours, for the whole server (CHECKUP_DAILY_CAP, default 2000). */
export function dailyCap(): number {
  const n = Number(process.env.CHECKUP_DAILY_CAP ?? "2000");
  return Number.isInteger(n) && n >= 0 ? n : 2000;
}

export class BodyTooLargeError extends Error {}

/**
 * The body as text, refused (BodyTooLargeError) once it passes `limit` bytes — checked against the declared
 * Content-Length first, then while streaming, so a body nginx would let through (20 MB) never sits in memory.
 */
export async function readCappedText(req: Request, limit = BODY_MAX_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) throw new BodyTooLargeError();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
