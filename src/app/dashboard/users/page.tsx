"use client";

// Every account, its subscription and how long it has left — with the controls to extend it. The
// filter, sort and search live in the address bar, so a view can be bookmarked or linked from the
// overview's tiles.
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { LICENSE_LABELS, LICENSE_TONES, ago, fa, jalaliDate, remainingLabel } from "@/components/dashboard/format";
import UserDrawer from "@/components/dashboard/UserDrawer";
import QuickExtend from "@/components/dashboard/QuickExtend";
import type { AdminUserRow } from "@/lib/adminUsers";

const FILTERS = [
  ["all", "همه"],
  ["expiring", "رو به پایان (۷ روز)"],
  ["trial", "آزمایشی"],
  ["subscribed", "مشترک"],
  ["lifetime", "مادام‌العمر"],
  ["free", "بدون اشتراک"],
  ["unverified", "ایمیل تأییدنشده"],
  ["disabled", "غیرفعال"],
] as const;

const SORTS = [
  ["created", "جدیدترین عضو"],
  ["lastSeen", "آخرین بازدید"],
  ["expiry", "نزدیک‌ترین پایان اشتراک"],
  ["name", "نام"],
] as const;

interface UserList {
  users: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <Users />
    </Suspense>
  );
}

function Users() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const sort = params.get("sort") ?? "created";
  const page = Number(params.get("page") ?? "1") || 1;
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [openId, setOpenId] = useState<string | null>(null);

  function setParam(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "" || (k === "filter" && v === "all") || (k === "page" && v === "1")) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  // Search as you type, a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) setParam({ q: search.trim() || null, page: null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams({ filter, sort, page: String(page), pageSize: "50", ...(q ? { q } : {}) });
  const key = `/api/admin/users?${query}`;
  const { data, error, mutate } = useSWR<UserList>(key, fetcher, { keepPreviousData: true });

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">کاربران و اشتراک‌ها</h1>
          <p className="text-sm text-muted mt-1">{data ? `${fa(data.total)} حساب` : "…"}</p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو: نام، ایمیل یا موبایل"
            className="w-64 bg-surface rounded-xl border border-line px-3 py-2 text-sm"
          />
          <select value={sort} onChange={(e) => setParam({ sort: e.target.value, page: null })} className="bg-surface rounded-xl border border-line px-3 py-2 text-sm">
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                مرتب‌سازی: {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setParam({ filter: value, page: null })}
            className={`rounded-full px-3 py-1.5 text-xs transition ${filter === value ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-waste">{error.message}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted border-b border-line">
              <th className="text-right font-medium px-4 py-3">کاربر</th>
              <th className="text-right font-medium px-3 py-3">موبایل</th>
              <th className="text-right font-medium px-3 py-3">اشتراک</th>
              <th className="text-right font-medium px-3 py-3">پایان</th>
              <th className="text-right font-medium px-3 py-3">آخرین بازدید</th>
              <th className="text-right font-medium px-3 py-3">عضویت</th>
              <th className="text-right font-medium px-3 py-3">تمدید سریع</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className={`border-b border-line last:border-0 hover:bg-canvas/60 ${u.disabled ? "opacity-60" : ""}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    {u.isAdmin && <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 text-[10px]">مدیر</span>}
                    {u.disabled && <span className="rounded bg-waste-soft text-waste px-1.5 text-[10px]">غیرفعال</span>}
                  </div>
                  <div className="text-xs text-muted flex items-center gap-1" dir="ltr">
                    <span className="truncate max-w-[16rem]">{u.email}</span>
                    <span title={u.emailVerified ? "ایمیل تأییدشده" : "ایمیل تأیید نشده"}>{u.emailVerified ? "✓" : "·"}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs" dir="ltr">
                  {u.phone && u.phoneVerified ? u.phone : <span className="text-muted">—</span>}
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${LICENSE_TONES[u.license.status]}`}>{LICENSE_LABELS[u.license.status]}</span>
                </td>
                <td className="px-3 py-3 text-xs whitespace-nowrap">
                  <div>{u.license.endsAt ? jalaliDate(u.license.endsAt) : "—"}</div>
                  <div className={`text-muted ${u.license.daysRemaining !== null && u.license.daysRemaining <= 7 ? "text-waste" : ""}`}>
                    {remainingLabel(u.license.status, u.license.daysRemaining)}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">{ago(u.lastSeenAt)}</td>
                <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">{jalaliDate(u.createdAt)}</td>
                <td className="px-3 py-3">
                  <QuickExtend userId={u.id} disabled={u.license.status === "LIFETIME"} onDone={() => void mutate()} />
                </td>
                <td className="px-3 py-3 text-left">
                  <button onClick={() => setOpenId(u.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-canvas">
                    جزئیات
                  </button>
                </td>
              </tr>
            ))}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                  کاربری با این مشخصات نیست.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40">
            قبلی
          </button>
          <span className="text-muted">
            صفحه‌ی {fa(data.page)} از {fa(data.pages)}
          </span>
          <button disabled={page >= data.pages} onClick={() => setParam({ page: String(page + 1) })} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40">
            بعدی
          </button>
        </div>
      )}

      {openId && <UserDrawer userId={openId} onClose={() => setOpenId(null)} onChanged={() => void mutate()} />}
    </div>
  );
}
