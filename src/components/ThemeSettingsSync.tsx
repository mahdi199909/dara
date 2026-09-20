"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { applyThemeClass, storeThemeMode, isThemeMode } from "@/lib/theme";
import { getLogger } from "@/lib/observability";

const log = getLogger("settings", "theme-sync");

function isNativePlatform(): boolean {
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

// Best-effort only, same reasoning as every other native-chrome touch-up in this app (see
// refreshLicenseStatus's own doc comment): a failure here should never block or visibly disrupt
// the app over a status bar color. Reads document.documentElement directly rather than
// recomputing resolveIsDark() itself so it always matches whatever applyThemeClass just set,
// "system" included.
async function syncNativeStatusBar(): Promise<void> {
  if (typeof window === "undefined" || !isNativePlatform()) return;
  try {
    const isDark = document.documentElement.classList.contains("dark");
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setBackgroundColor({ color: isDark ? "#0E1412" : "#EFF2EE" });
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
  } catch (err) {
    log.warn("SETTINGS_THEME_SYNC_FAILED", { error: err, layer: "local" });
  }
}

// Reconciles the DB-stored theme preference (the real source of truth) into the locally-applied
// class + localStorage cache, and keeps the native status bar in step. Mounted once inside each
// authenticated app shell (see (app)/layout.tsx and layout.android.tsx). The blocking script in
// src/app/layout.tsx already applied *a* theme from localStorage before first paint — this only
// corrects it once the real settings row loads, which matters the first time a given
// browser/device has no cached value yet, or after the preference was changed from elsewhere.
export default function ThemeSettingsSync() {
  const { data } = useSWR<{ settings: { theme?: string } }>("/api/settings", fetcher);
  const theme = data?.settings.theme;

  useEffect(() => {
    if (!isThemeMode(theme)) return;
    applyThemeClass(theme);
    storeThemeMode(theme);
    void syncNativeStatusBar();
  }, [theme]);

  return null;
}
