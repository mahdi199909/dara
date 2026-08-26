import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AppTopBar from "@/components/nav/AppTopBar";
import GlobalCaptureFab from "@/components/GlobalCaptureFab";
import SWRProvider from "@/components/SWRProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/session-expired");

  return (
    <SWRProvider>
      <div className="min-h-screen bg-[#f8f9fb]" dir="rtl">
        <AppTopBar userName={user.name} />
        <main className="pb-24">{children}</main>
        <GlobalCaptureFab />
      </div>
    </SWRProvider>
  );
}
