"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fetcher } from "@/lib/apiClient";
import { toPersianDigits, formatDuration } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import type { FounderCapital } from "@/components/CapitalHeader";
import IdentityStatements, { type IdentityStatementDto } from "@/components/IdentityStatements";
import MilestoneProgressBar from "@/components/MilestoneProgressBar";
import { nextMilestoneMinutes } from "@/lib/milestones";

interface CapitalSnapshotPoint {
  date: string;
  investedMinutes: number;
  virtualAssetValue: number;
}
interface CapitalResponse {
  capital: FounderCapital;
  snapshots: CapitalSnapshotPoint[];
}
interface AssetDto {
  id: string;
  name: string;
  currentValue: number;
}
interface AccountDto {
  id: string;
  name: string;
  balance: number;
}
interface VaEntry {
  id: string;
  durationMin: number;
  totalValue: number;
  date: string;
  categoryId: string | null;
  projectId: string | null;
  habitCheckInId: string | null;
}
interface VaBucket {
  categoryId: string;
  name: string;
  icon: string | null;
  total: number;
  entries: VaEntry[];
}
interface VaProjectEntry extends VaEntry {
  project?: { name: string } | null;
}
interface VirtualAssetResponse {
  entries: VaEntry[];
  total: number;
  byCategory: VaBucket[];
  projectEntries: VaProjectEntry[];
  habitEntries: VaEntry[];
}
interface InstallmentPlanDto {
  id: string;
  title: string;
  summary: { remainingAmount: number; remainingCount: number };
}

const RANGES = [
  { key: "30", label: "۳۰ روز" },
  { key: "90", label: "۹۰ روز" },
  { key: "all", label: "همه" },
] as const;

function shortJalali(dateKey: string) {
  // dateKey is already a Jalali "jy-jm-jd" string (see src/lib/jalali.ts's jalaliDateKey) — no
  // Gregorian conversion needed, just reformat for the axis.
  const [, jm, jd] = dateKey.split("-").map(Number);
  return toPersianDigits(`${jd}/${jm}`);
}

/** Every entry has exactly one of activity/task/project/habitCheckIn included (see
 * VirtualAssetEntry in prisma/schema.prisma) — this names whichever one is actually there. */
function entryLabel(e: any): string {
  return (e.activity ?? e.task)?.title ?? e.project?.name ?? e.habitCheckIn?.habit?.title ?? "";
}

export default function CapitalPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");
  const { data } = useSWR<CapitalResponse>(`/api/capital?range=${range}`, fetcher);
  const { data: identityData } = useSWR<{ statements: IdentityStatementDto[] }>("/api/identity", fetcher);
  const { data: assetsData } = useSWR<{ assets: AssetDto[] }>("/api/assets", fetcher);
  const { data: accountsData } = useSWR<{ accounts: AccountDto[] }>("/api/accounts", fetcher);
  const { data: vaData } = useSWR<VirtualAssetResponse>("/api/virtual-assets", fetcher);
  const { data: installmentsData } = useSWR<{ plans: InstallmentPlanDto[] }>("/api/installment-plans", fetcher);
  const { format } = useCurrencyUnit();

  const visibleAssetsTotal = (accountsData?.accounts.reduce((s, a) => s + a.balance, 0) ?? 0) + (assetsData?.assets.reduce((s, a) => s + a.currentValue, 0) ?? 0);
  const totalDebt = installmentsData?.plans.reduce((s, p) => s + p.summary.remainingAmount, 0) ?? 0;

  // "دارایی‌های پنهان" is skills + projects, not habits (habits already have their own dedicated
  // display on /assets and their own identity-statement pattern) — matching what's itemized below.
  const hiddenAssetEntries = vaData?.entries.filter((e) => !e.habitCheckInId) ?? [];
  const hiddenMinutesTotal = hiddenAssetEntries.reduce((s, e) => s + e.durationMin, 0);

  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const recentEntries = (vaData?.entries ?? [])
    .filter((e) => new Date(e.date).getTime() >= thirtyDaysAgo)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-800">سرمایه من</h1>

      {!data ? (
        <p className="text-sm text-gray-400">در حال بارگذاری...</p>
      ) : !data.capital.firstRecordAt ? (
        <Card className="p-5">
          <EmptyState
            message="هر ساعتی که روی یک مهارت، پروژه یا کار می‌گذاری، اینجا به‌عنوان دارایی پنهانت جمع می‌شود. سرمایه‌ات از اولین ثبت شروع می‌شود."
            cta={
              <Link href="/" className="text-xs font-medium text-brand-600 hover:text-brand-700">
                ثبت اول
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="p-5 space-y-1">
            <p className="text-3xl font-bold text-gray-800">
              {toPersianDigits(Math.round(data.capital.investedMinutes / 60))} <span className="text-base font-medium text-gray-400">ساعت سرمایه‌گذاری‌شده</span>
            </p>
            <p className="text-sm text-gray-500">
              معادل تخمینی: <span className="font-bold text-brand-700">{format(data.capital.virtualAssetValue, { withSuffix: true })}</span>
            </p>
            <p className="text-xs text-gray-400 pt-1">از {formatJalali(new Date(data.capital.firstRecordAt), { long: true })}</p>
          </Card>

          {identityData && identityData.statements.length > 0 && (
            <Card className="p-4">
              <IdentityStatements statements={identityData.statements.slice(0, 3)} />
            </Card>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <StatItem label="مهارت" value={toPersianDigits(data.capital.skillCount)} />
            </Card>
            <Card className="p-4">
              <StatItem label="پروژه" value={toPersianDigits(data.capital.projectCount)} />
            </Card>
            <Card className="p-4">
              <StatItem label="دارایی" value={toPersianDigits(data.capital.assetCount)} />
            </Card>
          </div>

          {data.capital.monthDeltaMinutes > 0 && (
            <Card className="p-4">
              <StatItem label="این ماه" value={`+${toPersianDigits(data.capital.monthDeltaMinutes)} دقیقه`} tone="positive" />
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-gray-700 text-sm">روند سرمایه</h2>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition ${range === r.key ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {data.snapshots.length < 2 ? (
              <p className="text-xs text-gray-400 text-center py-4">با ادامه ثبت، روند رشد اینجا شکل می‌گیرد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data.snapshots} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={shortJalali} tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} width={32} tickFormatter={(v) => toPersianDigits(Math.round(v / 60))} />
                  <Tooltip labelFormatter={(v) => shortJalali(v as string)} formatter={(v: number) => [`${toPersianDigits(Math.round(v / 60))} ساعت`, "سرمایه"]} />
                  <Line type="monotone" dataKey="investedMinutes" stroke="#3947c4" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <StatItem label="دارایی‌های مرئی" value={format(visibleAssetsTotal, { withSuffix: true })} />
            </Card>
            <Card className="p-4">
              <StatItem label="دارایی‌های پنهان" value={formatDuration(hiddenMinutesTotal)} tone="positive" />
            </Card>
          </div>

          <section className="space-y-2">
            <h2 className="font-bold text-gray-700 text-sm">دارایی‌های مرئی</h2>
            {(accountsData?.accounts.length ?? 0) === 0 && (assetsData?.assets.length ?? 0) === 0 ? (
              <Card>
                <EmptyState message="هنوز حساب یا دارایی واقعی ثبت نکرده‌اید." />
              </Card>
            ) : (
              <Card>
                <ul className="divide-y divide-gray-50">
                  {accountsData?.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-gray-700">{a.name}</span>
                      <span className="text-sm font-bold text-gray-800">{format(a.balance, { withSuffix: true })}</span>
                    </li>
                  ))}
                  {assetsData?.assets.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-gray-700">{a.name}</span>
                      <span className="text-sm font-bold text-gray-800">{format(a.currentValue, { withSuffix: true })}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-gray-700 text-sm">دارایی‌های پنهان</h2>
            {!vaData || (vaData.byCategory.length === 0 && vaData.projectEntries.length === 0) ? (
              <Card>
                <EmptyState message="هنوز مهارت یا پروژه‌ای دارایی پنهان نساخته." />
              </Card>
            ) : (
              <div className="space-y-2">
                {vaData.byCategory.map((bucket) => {
                  const minutes = bucket.entries.reduce((s, e) => s + e.durationMin, 0);
                  return (
                    <Card key={bucket.categoryId} className="p-4 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-800">
                          {bucket.icon} {bucket.name}
                        </span>
                        <span className="text-sm font-bold text-gray-800">{formatDuration(minutes)}</span>
                      </div>
                      <MilestoneProgressBar totalMinutes={minutes} nextMilestoneMinutes={nextMilestoneMinutes(minutes)} />
                      {bucket.total > 0 && <p className="text-xs text-gray-400">معادل تخمینی: {format(bucket.total, { withSuffix: true })}</p>}
                    </Card>
                  );
                })}
                {vaData.projectEntries.map((e) => (
                  <Card key={e.id} className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-800">{e.project?.name}</span>
                      <span className="text-sm font-bold text-gray-800">{formatDuration(e.durationMin)}</span>
                    </div>
                    <MilestoneProgressBar totalMinutes={e.durationMin} nextMilestoneMinutes={nextMilestoneMinutes(e.durationMin)} />
                    {e.totalValue > 0 && <p className="text-xs text-gray-400">معادل تخمینی: {format(e.totalValue, { withSuffix: true })}</p>}
                  </Card>
                ))}
              </div>
            )}
          </section>

          {installmentsData && installmentsData.plans.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-bold text-gray-700 text-sm">بدهی‌ها و اقساط</h2>
              <Card>
                <ul className="divide-y divide-gray-50">
                  {installmentsData.plans.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm text-gray-700">{p.title}</p>
                        <p className="text-xs text-gray-400">{toPersianDigits(p.summary.remainingCount)} قسط باقی‌مانده</p>
                      </div>
                      <span className="text-sm font-bold text-waste-600">{format(p.summary.remainingAmount, { withSuffix: true })}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">جمع بدهی</span>
                    <span className="text-sm font-bold text-waste-600">{format(totalDebt, { withSuffix: true })}</span>
                  </li>
                </ul>
              </Card>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-bold text-gray-700 text-sm">چه چیزی این ماه ساختی</h2>
            {recentEntries.length === 0 ? (
              <Card>
                <EmptyState message="هنوز در ۳۰ روز اخیر دارایی پنهانی ثبت نشده." />
              </Card>
            ) : (
              <Card>
                <ul className="divide-y divide-gray-50">
                  {recentEntries.slice(0, 10).map((e: any) => (
                    <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700 truncate">{entryLabel(e) || "—"}</p>
                        <p className="text-xs text-gray-400">
                          {formatDuration(e.durationMin)} · {formatJalali(new Date(e.date))}
                        </p>
                      </div>
                      <span className="text-sm text-gray-600 shrink-0">{format(e.totalValue, { withSuffix: true })}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
