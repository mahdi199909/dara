"use client";

// The owner dashboard's frame: a sidebar on the right (RTL), the page on the left. Built for a desktop
// browser; below 1024px the sidebar becomes a row of links on top.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_DISPLAY_NAME } from "@/lib/appVersion";
import { HomeIcon, BoxIcon, ChartIcon, GearIcon, BellIcon } from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "نمای کلی", icon: HomeIcon },
  { href: "/dashboard/users", label: "کاربران و اشتراک‌ها", icon: BoxIcon },
  { href: "/dashboard/system", label: "سلامت سرور و گزارش‌ها", icon: ChartIcon },
  { href: "/dashboard/release", label: "نسخه‌ی اپ اندروید", icon: GearIcon },
  { href: "/dashboard/messaging", label: "ایمیل و پیامک", icon: BellIcon },
] as const;

export default function DashboardShell({ ownerName, ownerEmail, children }: { ownerName: string; ownerEmail: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(href + "/"));

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex" dir="rtl">
      <aside className="lg:w-64 lg:shrink-0 lg:min-h-screen bg-surface border-b lg:border-b-0 lg:border-l border-line">
        <div className="px-5 py-5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-9 w-9 rounded-xl" />
          <div className="min-w-0">
            <p className="font-bold text-sm">{APP_DISPLAY_NAME}</p>
            <p className="text-xs text-muted">داشبورد مدیریت</p>
          </div>
        </div>
        <nav className="flex lg:flex-col gap-1 px-3 pb-3 overflow-x-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition ${
                active(href) ? "bg-accent text-on-accent font-medium" : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden lg:block px-5 py-4 border-t border-line text-xs text-muted space-y-1">
          <p className="text-ink">{ownerName}</p>
          <p dir="ltr" className="text-right truncate">
            {ownerEmail}
          </p>
          <Link href="/" className="inline-block pt-2 text-accent">
            ← بازگشت به برنامه
          </Link>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-4 lg:p-8">{children}</main>
    </div>
  );
}
