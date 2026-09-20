// Runtime-adjustable thresholds: a base level, per-domain/module/component overrides, and a
// per-user "trace this person" override — each optionally expiring. This is what lets someone turn
// SYNC up to DEBUG for twenty minutes without a deployment (the admin endpoint that drives it comes
// in a later phase; the mechanism lives here so every environment behaves the same).
import { LEVEL_VALUE, type Level } from "./levels";

interface TimedLevel {
  level: Level;
  /** Epoch ms after which the override no longer applies; null = until cleared. */
  expiresAt: number | null;
}

export interface LevelKeys {
  component?: string;
  module?: string;
  domain?: string;
  userId?: string | null;
}

export interface LevelSnapshot {
  base: Level;
  overrides: Record<string, TimedLevel>;
  /** Only the count: user ids are not something a diagnostics view needs to echo. */
  userOverrideCount: number;
}

export class LevelController {
  private base: Level;
  private readonly overrides = new Map<string, TimedLevel>();
  private readonly userOverrides = new Map<string, TimedLevel>();
  private min = 0;

  constructor(
    base: Level,
    overrides: Record<string, Level> = {},
    private readonly now: () => number = Date.now
  ) {
    this.base = base;
    for (const [key, level] of Object.entries(overrides)) this.overrides.set(key.toUpperCase(), { level, expiresAt: null });
    this.recompute();
  }

  /**
   * The lowest numeric level anything could currently enable. The logger compares a record's level
   * against this first, so a disabled DEBUG call costs one comparison and no allocation.
   */
  get minValue(): number {
    return this.min;
  }

  get baseLevel(): Level {
    return this.base;
  }

  hasUserOverrides(): boolean {
    return this.userOverrides.size > 0;
  }

  setBase(level: Level): void {
    this.base = level;
    this.recompute();
  }

  setOverride(key: string, level: Level, ttlMs?: number): void {
    this.overrides.set(key.toUpperCase(), { level, expiresAt: ttlMs && ttlMs > 0 ? this.now() + ttlMs : null });
    this.recompute();
  }

  clearOverride(key: string): void {
    this.overrides.delete(key.toUpperCase());
    this.recompute();
  }

  setUserOverride(userId: string, level: Level, ttlMs?: number): void {
    this.userOverrides.set(userId, { level, expiresAt: ttlMs && ttlMs > 0 ? this.now() + ttlMs : null });
    this.recompute();
  }

  clearUserOverride(userId: string): void {
    this.userOverrides.delete(userId);
    this.recompute();
  }

  /**
   * Most specific rule wins: component, then module, then domain, then the base level. A user
   * override can only make things MORE verbose for that user — "trace this person" must never
   * silence something an operator has already turned up.
   */
  effectiveLevel(keys: LevelKeys): Level {
    let level = this.base;
    for (const key of [keys.component, keys.module, keys.domain]) {
      if (!key) continue;
      const rule = this.overrides.get(key.toUpperCase());
      if (rule && this.isActive(rule)) {
        level = rule.level;
        break;
      }
    }
    if (keys.userId && this.userOverrides.size > 0) {
      const rule = this.userOverrides.get(keys.userId);
      if (rule && this.isActive(rule) && LEVEL_VALUE[rule.level] < LEVEL_VALUE[level]) level = rule.level;
    }
    return level;
  }

  snapshot(): LevelSnapshot {
    this.prune();
    return {
      base: this.base,
      overrides: Object.fromEntries(this.overrides),
      userOverrideCount: this.userOverrides.size,
    };
  }

  private isActive(rule: TimedLevel): boolean {
    return rule.expiresAt === null || rule.expiresAt > this.now();
  }

  private prune(): void {
    for (const [key, rule] of this.overrides) if (!this.isActive(rule)) this.overrides.delete(key);
    for (const [key, rule] of this.userOverrides) if (!this.isActive(rule)) this.userOverrides.delete(key);
    this.recompute();
  }

  private recompute(): void {
    let min = LEVEL_VALUE[this.base];
    for (const rule of this.overrides.values()) min = Math.min(min, LEVEL_VALUE[rule.level]);
    for (const rule of this.userOverrides.values()) min = Math.min(min, LEVEL_VALUE[rule.level]);
    this.min = min;
  }
}
