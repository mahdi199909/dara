// The key that signs session tokens. Edge-safe (the middleware imports it): no node: modules.
//
// Outside production a fixed development key keeps `npm run dev` and the tests zero-setup. In production
// a missing JWT_SECRET used to fall back to that same public string — anyone who read the repository
// could have minted a session for any account. Now the server refuses to sign or accept tokens instead
// (docker-compose.yml also refuses to start without it). `next build` evaluates route modules with
// NODE_ENV=production and no secrets, so the check runs when a key is first needed, not at import.
const DEV_ONLY_SECRET = "dev-only-secret-change-me-in-production";

let cached: Uint8Array | null = null;

export function sessionSecret(): Uint8Array {
  if (cached) return cached;
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    // (Deliberately no minimum length here: refusing a short key that is already in use would sign
    // every existing user out. DEPLOYMENT.md asks for 32+ random characters.)
    if (!configured || configured === DEV_ONLY_SECRET) {
      throw new Error("JWT_SECRET must be set to a random value in production.");
    }
  }
  cached = new TextEncoder().encode(configured || DEV_ONLY_SECRET);
  return cached;
}

/** Tests that switch JWT_SECRET between cases. */
export function resetSessionSecretCache(): void {
  cached = null;
}
