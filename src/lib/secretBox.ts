// Encryption at rest for settings the owner types into the dashboard (API keys, SMTP password).
//
// AES-256-GCM with a key derived (HKDF-SHA256) from SETTINGS_ENCRYPTION_KEY, or — when that is not set —
// from the server's JWT_SECRET. Both live only in the server's environment, never in the database, so a
// stolen database dump or backup file holds nothing usable. The setting's name is bound in as associated
// data: a ciphertext copied onto another setting's row fails to decrypt instead of being read as that
// setting. Format: "v1.<iv>.<tag>.<ciphertext>" (base64url).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { sessionSecret } from "./sessionSecret";

const VERSION = "v1";

function key(): Buffer {
  const material = process.env.SETTINGS_ENCRYPTION_KEY ? Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY, "utf8") : Buffer.from(sessionSecret());
  return Buffer.from(hkdfSync("sha256", material, Buffer.from("parva-server-settings"), Buffer.from("aes-256-gcm/v1"), 32));
}

export function seal(name: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** The plaintext, or null when it cannot be read (the server key changed, or the row was tampered with). */
export function open(name: string, sealed: string): string | null {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(name, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
