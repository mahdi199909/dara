"use client";

import { useEffect } from "react";
import { applyThemeClass, readStoredThemeMode } from "@/lib/theme";

// Mounted once in the root layout (src/app/layout.tsx) so it's active on every page, including
// the pre-login auth screens — unlike ThemeSettingsSync (app/layout.android.tsx +
// (app)/layout.tsx), this has no dependency on an authenticated settings row, since "system"
// mode needs to keep working even before there's a user session to read a preference from.
export default function ThemeSystemListener() {
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredThemeMode() === "system") applyThemeClass("system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return null;
}
