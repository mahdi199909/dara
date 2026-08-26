import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AppTopBar from "@/components/nav/AppTopBar";
import BottomNav from "@/components/nav/BottomNav";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";
import GlobalCaptureFab from "@/components/GlobalCaptureFab";
import SWRProvider from "@/components/SWRProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/session-expired");

  return (
    <SWRProvider>
      <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
        <AppTopBar />
        <main style={{ paddingBottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1.5rem)` }}>{children}</main>
        <GlobalCaptureFab />
        <BottomNav userName={user.name} />
      </div>
    </SWRProvider>
  );
}
