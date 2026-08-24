"use client";

import { createContext, useContext, useCallback, useMemo } from "react";
import useSWR from "swr";
import { fetcher, apiPatch } from "./apiClient";
import { formatMoney, tomanToUnit, unitToToman } from "./money";
import type { CurrencyUnit } from "./types";

interface CurrencyUnitContextValue {
  unit: CurrencyUnit;
  setUnit: (u: CurrencyUnit) => Promise<void>;
  /** Formats an integer Toman amount in the current unit (thousands separators, Persian digits). */
  format: (amountToman: number, opts?: { persianDigits?: boolean; withSuffix?: boolean }) => string;
  /** Converts a value entered in the current unit back into integer Toman. */
  toToman: (displayValue: number) => number;
  /** Converts an integer Toman amount into the current unit (for pre-filling an input). */
  fromToman: (amountToman: number) => number;
}

const CurrencyUnitContext = createContext<CurrencyUnitContextValue | null>(null);

/**
 * Mounted once at the root layout so every page — authenticated or not — shares the same
 * currency display preference without a duplicate fetch (SWR dedupes the shared
 * "/api/settings" key against whatever else already requests it). Defaults to TOMAN before
 * settings load or on pages where the fetch 401s (login/register), which is the app's
 * documented default unit either way.
 */
export function CurrencyUnitProvider({ children }: { children: React.ReactNode }) {
  const { data, mutate } = useSWR<{ settings: any }>("/api/settings", fetcher);
  const unit: CurrencyUnit = (data?.settings?.currencyDisplayUnit as CurrencyUnit) ?? "TOMAN";

  const setUnit = useCallback(
    async (u: CurrencyUnit) => {
      await apiPatch("/api/settings", { currencyDisplayUnit: u });
      mutate();
    },
    [mutate]
  );

  const value = useMemo<CurrencyUnitContextValue>(
    () => ({
      unit,
      setUnit,
      format: (amountToman, opts) => formatMoney(amountToman, unit, opts),
      toToman: (displayValue) => unitToToman(displayValue, unit),
      fromToman: (amountToman) => tomanToUnit(amountToman, unit),
    }),
    [unit, setUnit]
  );

  return <CurrencyUnitContext.Provider value={value}>{children}</CurrencyUnitContext.Provider>;
}

export function useCurrencyUnit(): CurrencyUnitContextValue {
  const ctx = useContext(CurrencyUnitContext);
  if (!ctx) throw new Error("useCurrencyUnit must be used within CurrencyUnitProvider");
  return ctx;
}
