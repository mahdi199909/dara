import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminAccount } from "@/lib/adminIdentity";
import DashboardShell from "@/components/dashboard/DashboardShell";
import SWRProvider from "@/components/SWRProvider";

// The owner's area (my.parvaapp.ir/dashboard), a desktop layout of its own — not a tab of the app.
// Three locks: the middleware turns away any token that names another address, this layout checks the
// account itself (suspended, unverified owner address — see adminIdentity.ts), and every /api/admin
// route runs requireAdmin() again. It is web only: the Android export deletes this folder.
export const dynamic = "force-dynamic";

export const metadata = { title: "داشبورد مدیریت", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isAdminAccount(user)) notFound();
  return (
    <SWRProvider>
      <DashboardShell ownerName={user!.name} ownerEmail={user!.email}>
        {children}
      </DashboardShell>
    </SWRProvider>
  );
}
