"use client";

import useSWR from "swr";
import Link from "next/link";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { fetcher } from "@/lib/apiClient";
import { toPersianDigits } from "@/lib/money";
import { Card, EmptyState } from "@/components/ui/Card";

interface CapitalSnapshotPoint {
  date: string;
  investedMinutes: number;
  virtualAssetValue: number;
}
export interface FounderCapital {
  investedMinutes: number;
  virtualAssetValue: number;
  skillCount: number;
  projectCount: number;
  assetCount: number;
  firstRecordAt: string | null;
  todayDeltaMinutes: number;
  monthDeltaMinutes: number;
}
interface CapitalResponse {
  capital: FounderCapital;
  snapshots: CapitalSnapshotPoint[];
}

/**
 * "سرمایه من" — the one dashboard number that only ever goes up (see the product brief on why:
 * every other card on Home can show cost/waste/backlog, this one never does). Deliberately
 * doesn't use the word «پنهان» — that's reserved for the two moments defined in the brand voice
 * rules (revealing an unaccounted cost, or an asset the user didn't know they'd built), and this
 * is a routine, ongoing display, not either of those moments.
 */
export default function CapitalHeader({ onEmptyCta }: { onEmptyCta?: () => void }) {
  const { data } = useSWR<CapitalResponse>("/api/capital", fetcher);

  // Render nothing until the real numbers are in — avoids a flash of a zero/placeholder value,
  // same convention as this page's DailyQuoteCard.
  if (!data) return null;

  const { capital, snapshots } = data;

  if (!capital.firstRecordAt) {
    return (
      <Card className="p-5">
        <EmptyState
          message="سرمایه‌ات از اولین ثبت شروع می‌شود."
          cta={
            onEmptyCta && (
              <button onClick={onEmptyCta} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                ثبت کن
              </button>
            )
          }
        />
      </Card>
    );
  }

  const hours = Math.round(capital.investedMinutes / 60);

  return (
    <Link href="/capital">
      <Card className="p-5 hover:shadow-md transition-shadow">
        <p className="text-xs text-gray-400 mb-1">سرمایه من</p>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-bold text-gray-800">
              {toPersianDigits(hours)} <span className="text-base font-medium text-gray-400">ساعت</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {toPersianDigits(capital.skillCount)} مهارت · {toPersianDigits(capital.projectCount)} پروژه · {toPersianDigits(capital.assetCount)} دارایی
            </p>
            {capital.todayDeltaMinutes > 0 && <p className="text-xs text-brand-600 mt-1">+{toPersianDigits(capital.todayDeltaMinutes)} دقیقه امروز</p>}
          </div>
          {snapshots.length > 1 && (
            <div className="w-20 h-10 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={snapshots}>
                  <Line type="monotone" dataKey="investedMinutes" stroke="#3947c4" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
