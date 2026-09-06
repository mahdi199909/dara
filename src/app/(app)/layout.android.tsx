"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import AppTopBar from "@/components/nav/AppTopBar";
import BottomNav from "@/components/nav/BottomNav";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";
import GlobalCaptureFab from "@/components/GlobalCaptureFab";
import SWRProvider from "@/components/SWRProvider";
import FirstRunGate from "@/components/native/FirstRunGate";
import WidgetQueueDrainer from "@/components/native/WidgetQueueDrainer";

// Capacitor/static-export variant of (app)/layout.tsx — see scripts/prepare-android-export.mjs,
// which swaps this in for the real layout.tsx during an Android build only. No server-side
// cookie check here (there's no server at runtime in a static export to run one against, and
// output: 'export' can't render an async server component that calls redirect() anyway).
// FirstRunGate handles the Android-only first-launch login instead; it's a no-op on the web
// build, which keeps using the original, untouched layout.tsx.
function AndroidChrome({ children }: { children: React.ReactNode }) {
  // Same SWR key Settings' own name field reads/writes — a name change there calls this
  // hook's shared mutate("/api/settings"), so the header picks it up without a reload.
  const { data } = useSWR<{ user: { name: string } | null }>("/api/settings", fetcher);
  const userName = data?.user?.name ?? "کاربر پنهان";

  return (
    <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
      <AppTopBar userName={userName} />
      <main style={{ paddingBottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1.5rem)` }}>{children}</main>
      <GlobalCaptureFab />
      <BottomNav userName={userName} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirstRunGate>
      <SWRProvider>
        <WidgetQueueDrainer />
        <AndroidChrome>{children}</AndroidChrome>
      </SWRProvider>
    </FirstRunGate>
  );
}
