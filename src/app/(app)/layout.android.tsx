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
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirstRunGate>
      <SWRProvider>
        <WidgetQueueDrainer />
        <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
          <AppTopBar userName="کاربر پنهان" />
          <main style={{ paddingBottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1.5rem)` }}>{children}</main>
          <GlobalCaptureFab />
          <BottomNav userName="کاربر پنهان" />
        </div>
      </SWRProvider>
    </FirstRunGate>
  );
}
