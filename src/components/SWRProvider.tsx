"use client";

import { SWRConfig } from "swr";

/**
 * Global SWR defaults. `revalidateOnFocus`/`revalidateOnReconnect` are SWR's defaults
 * (both true) and refetch EVERY mounted hook on each focus/visibility/online event —
 * harmless on an occasional tab-switch, but some environments fire those events in rapid
 * bursts, which turns into a real request storm (confirmed: dozens of duplicate requests
 * per second, all pages affected). Mutations already call `mutate()` explicitly after every
 * write, so focus-revalidation isn't needed for correctness here — just for auto-refreshing
 * stale-in-background data, which the notification bell's own refreshInterval already covers.
 */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 4000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
