// Log levels and the "LOG_LEVEL=info,SYNC=debug" configuration syntax. Pure — no runtime imports,
// so the server, the browser and the Android WebView all share it.

export const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_VALUE: Readonly<Record<Level, number>> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  CRITICAL: 60,
};

const ALIASES: Readonly<Record<string, Level>> = { WARNING: "WARN", ERR: "ERROR", FATAL: "CRITICAL" };

/** Accepts any casing and a few common aliases ("warning", "fatal"); anything else is null. */
export function parseLevel(input: unknown): Level | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toUpperCase();
  if ((LEVELS as readonly string[]).includes(key)) return key as Level;
  return ALIASES[key] ?? null;
}

/** True when a record at `level` passes a threshold of `minimum`. */
export function isLevelEnabled(level: Level, minimum: Level): boolean {
  return LEVEL_VALUE[level] >= LEVEL_VALUE[minimum];
}

export interface LevelSpec {
  /** The plain level in the spec ("info" in "info,SYNC=debug"), if any. */
  base: Level | null;
  /** Per-domain / module / component thresholds, keys upper-cased. */
  overrides: Record<string, Level>;
  /** Tokens that could not be understood — reported, never fatal. */
  invalid: string[];
}

/**
 * "info,SYNC=debug,finance=info" → base INFO, SYNC → DEBUG, FINANCE → INFO. Tokens are separated by
 * commas or semicolons; a bad token is collected in `invalid` and the rest still apply, so a typo
 * in an environment variable can never switch logging off.
 */
export function parseLevelSpec(spec: string | null | undefined): LevelSpec {
  const result: LevelSpec = { base: null, overrides: {}, invalid: [] };
  if (!spec) return result;
  for (const raw of spec.split(/[,;]/)) {
    const token = raw.trim();
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq === -1) {
      const level = parseLevel(token);
      if (level) result.base = level;
      else result.invalid.push(token);
      continue;
    }
    const key = token.slice(0, eq).trim().toUpperCase();
    const level = parseLevel(token.slice(eq + 1));
    if (key && /^[A-Z0-9_.:-]+$/.test(key) && level) result.overrides[key] = level;
    else result.invalid.push(token);
  }
  return result;
}
