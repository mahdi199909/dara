"use client";

import useSWR from "swr";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fetcher } from "@/lib/apiClient";
import { toPersianDigits } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import type { FounderCapital } from "@/components/CapitalHeader";

interface CapitalSnapshotPoint {
  date: string;
  investedMinutes: number;
  virtualAssetValue: number;
}
interface CapitalResponse {
  capital: FounderCapital;
  snapshots: CapitalSnapshotPoint[];
}

function shortJalali(dateKey: string) {
  // dateKey is already a Jalali "jy-jm-jd" string (see src/lib/jalali.ts's jalaliDateKey) — no
  // Gregorian conversion needed, just reformat for the axis.
  const [, jm, jd] = dateKey.split("-").map(Number);
  return toPersianDigits(`${jd}/${jm}`);
}

export default function CapitalPage() {
  const { data } = useSWR<CapitalResponse>("/api/capital", fetcher);
  const { format } = useCurrencyUnit();

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-800">سرمایه من</h1>

      {!data ? (
        <p className="text-sm text-gray-400">در حال بارگذاری...</p>
      ) : !data.capital.firstRecordAt ? (
        <Card>
          <EmptyState message="سرمایه‌ات از اولین ثبت شروع می‌شود." />
        </Card>
      ) : (
        <>
          <Card className="p-5 space-y-1">
            <p className="text-3xl font-bold text-gray-800">
              {toPersianDigits(Math.round(data.capital.investedMinutes / 60))} <span className="text-base font-medium text-gray-400">ساعت سرمایه‌گذاری‌شده</span>
            </p>
            <p className="text-xl font-bold text-brand-700">{format(data.capital.virtualAssetValue, { withSuffix: true })}</p>
            <p className="text-xs text-gray-400 pt-1">از {formatJalali(new Date(data.capital.firstRecordAt), { long: true })}</p>
          </Card>

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
            <h2 className="font-bold text-gray-700 text-sm mb-2">روند سرمایه</h2>
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
        </>
      )}
    </div>
  );
}
