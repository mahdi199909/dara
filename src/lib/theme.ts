// Shared theme-mode logic. The blocking anti-flash script inlined in src/app/layout.tsx
// duplicates the read/resolve logic below in plain JS on purpose — it runs before any bundle
// loads, so it can't import this module — but every other call site (settings UI, the
// system-preference listener, the DB-reconciliation sync) goes through here so there's exactly
// one implementation to keep correct.
export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "parva-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Pure on purpose — takes the system preference as a parameter instead of reading
// systemPrefersDark() itself, so the actual decision ("system" only resolves dark when the OS
// does) is unit-testable in this project's plain-Node vitest environment without a DOM. Every
// real call site still just passes systemPrefersDark() (see applyThemeClass below).
export function resolveIsDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode, disabled site data, etc.) — fall through to the
    // system default; the DB value is still the source of truth once settings load.
  }
  return "system";
}

// Applies the resolved dark/light class to the document root. Does NOT touch localStorage —
// call storeThemeMode too when the user is actively changing their preference (see
// setThemeMode below); the boot-time reconciliation path applies the class without rewriting
// storage it just read from.
export function applyThemeClass(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", resolveIsDark(mode, systemPrefersDark()));
}

export function storeThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Best-effort cache only — the DB write (done by the caller alongside this) is what
    // actually persists the preference.
  }
}

// The one function UI code should call when the user picks a mode: applies it immediately (no
// flash, no waiting on the network write) and caches it for next boot's blocking script.
export function setThemeMode(mode: ThemeMode): void {
  applyThemeClass(mode);
  storeThemeMode(mode);
}
