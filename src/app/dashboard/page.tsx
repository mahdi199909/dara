"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { LICENSE_LABELS, LICENSE_TONES, fa, jalaliDate, remainingLabel } from "@/components/dashboard/format";
import type { AdminUserRow } from "@/lib/adminUsers";

interface Stats {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  active24h: number;
  active7d: number;
  emailVerified: number;
  phoneVerified: number;
  disabled: number;
  byStatus: Record<string, number>;
  expiringIn7d: number;
  codesSent24h: number;
  signupsByDay: { day: string; count: number }[];
}

interface UserList {
  users: AdminUserRow[];
  total: number;
}

function Tile({ label, value, hint, href }: { label: string; value: number; hint?: string; href?: string }) {
  const body = (
    <Card className="p-4 h-full hover:shadow-md">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold mt-1">{fa(value)}</p>
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function SignupBars({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-28" dir="ltr" aria-label="ثبت‌نام‌های ۳۰ روز اخیر">
      {days.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col justify-end" title={`${jalaliDate(d.day + "T12:00:00")}: ${fa(d.count)}`}>
          <div className="rounded-t bg-accent/80" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 4 : 1 }} />
        </div>
      ))}
    </div>
  );
}

function MiniUserList({ title, users, empty, href }: { title: string; users: AdminUserRow[]; empty: string; href: string }) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm">{title}</h2>
        <Link href={href} className="text-xs text-accent">
          همه ←
        </Link>
      </div>
      {users.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{u.name}</p>
                <p className="text-xs text-muted truncate" dir="ltr">
                  {u.email}
                </p>
              </div>
              <div className="text-left shrink-0">
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${LICENSE_TONES[u.license.status]}`}>{LICENSE_LABELS[u.license.status]}</span>
                <p className="text-[11px] text-muted mt-1">{remainingLabel(u.license.status, u.license.daysRemaining)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardOverview() {
  const { data: stats, error } = useSWR<Stats>("/api/admin/stats", fetcher, { refreshInterval: 60_000 });
  const { data: expiring } = useSWR<UserList>("/api/admin/users?filter=expiring&sort=expiry&pageSize=8", fetcher);
  const { data: recent } = useSWR<UserList>("/api/admin/users?sort=created&pageSize=8", fetcher);

  if (error) return <p className="text-sm text-waste">{error.message ?? "خطا در بارگذاری"}</p>;
  if (!stats) return <p className="text-sm text-muted">در حال بارگذاری...</p>;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">نمای کلی</h1>
        <p className="text-sm text-muted mt-1">وضعیت کاربران و اشتراک‌ها، همین حالا.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="همه‌ی کاربران" value={stats.totalUsers} hint={`${fa(stats.newUsers7d)} نفر در ۷ روز اخیر`} href="/dashboard/users" />
        <Tile label="فعال در ۲۴ ساعت اخیر" value={stats.active24h} hint={`${fa(stats.active7d)} نفر در ۷ روز اخیر`} href="/dashboard/users?sort=lastSeen" />
        <Tile label="اشتراک رو به پایان (۷ روز)" value={stats.expiringIn7d} href="/dashboard/users?filter=expiring" />
        <Tile label="مشترک فعال" value={stats.byStatus.SUBSCRIBED ?? 0} hint={`${fa(stats.byStatus.LIFETIME ?? 0)} مادام‌العمر`} href="/dashboard/users?filter=subscribed" />
        <Tile label="در دوره‌ی آزمایشی" value={stats.byStatus.TRIAL ?? 0} href="/dashboard/users?filter=trial" />
        <Tile label="بدون اشتراک" value={stats.byStatus.FREE ?? 0} href="/dashboard/users?filter=free" />
        <Tile label="ایمیل تأییدشده" value={stats.emailVerified} hint={`${fa(stats.phoneVerified)} موبایل تأییدشده`} href="/dashboard/users?filter=unverified" />
        <Tile label="حساب غیرفعال" value={stats.disabled} hint={`${fa(stats.codesSent24h)} کد در ۲۴ ساعت`} href="/dashboard/users?filter=disabled" />
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm">ثبت‌نام‌های ۳۰ روز اخیر</h2>
          <span className="text-xs text-muted">{fa(stats.newUsers30d)} نفر</span>
        </div>
        <SignupBars days={stats.signupsByDay} />
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <MiniUserList title="اشتراک‌های رو به پایان" users={expiring?.users ?? []} empty="در ۷ روز آینده اشتراکی تمام نمی‌شود." href="/dashboard/users?filter=expiring" />
        <MiniUserList title="تازه‌ترین کاربران" users={recent?.users ?? []} empty="هنوز کاربری نیست." href="/dashboard/users" />
      </div>
    </div>
  );
}
