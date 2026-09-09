import { describe, expect, it } from "vitest";
import { isThemeMode, resolveIsDark } from "./theme";

describe("isThemeMode", () => {
  it("accepts exactly light/dark/system", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
  });

  it("rejects anything else, including null/undefined/other strings", () => {
    expect(isThemeMode("LIGHT")).toBe(false);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
    expect(isThemeMode(1)).toBe(false);
  });
});

// The actual reconciliation decision — "system" is the only mode where the outcome depends on
// anything external (the OS preference); "light"/"dark" always win outright. This is the part of
// the localStorage<->DB flow worth unit-testing: DOM/localStorage access itself (applyThemeClass,
// readStoredThemeMode, etc.) is a thin, unbranching wrapper around browser APIs this project's
// Node-only vitest environment doesn't exercise anywhere else either.
describe("resolveIsDark", () => {
  it("light mode is never dark, regardless of system preference", () => {
    expect(resolveIsDark("light", true)).toBe(false);
    expect(resolveIsDark("light", false)).toBe(false);
  });

  it("dark mode is always dark, regardless of system preference", () => {
    expect(resolveIsDark("dark", true)).toBe(true);
    expect(resolveIsDark("dark", false)).toBe(true);
  });

  it("system mode follows the OS preference exactly", () => {
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });
});
