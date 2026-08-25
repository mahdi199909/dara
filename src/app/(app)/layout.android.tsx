import AppTopBar from "@/components/nav/AppTopBar";
import GlobalCaptureFab from "@/components/GlobalCaptureFab";
import SWRProvider from "@/components/SWRProvider";
import FirstRunGate from "@/components/native/FirstRunGate";

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
        <div className="min-h-screen bg-[#f7f8f7]" dir="rtl">
          <AppTopBar userName="کاربر دارا" />
          <main className="pb-24">{children}</main>
          <GlobalCaptureFab />
        </div>
      </SWRProvider>
    </FirstRunGate>
  );
}
