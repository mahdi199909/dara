"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { formatDuration } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { useCurrencyUnit } from "@/lib/currencyUnit";

export default function PrintReportPage() {
  return (
    <Suspense fallback={null}>
      <PrintReportContent />
    </Suspense>
  );
}

function PrintReportContent() {
  const params = useSearchParams();
  const preset = params.get("preset") ?? "month";
  const { data } = useSWR<any>(`/api/reports?preset=${preset}`, fetcher);
  const { format } = useCurrencyUnit();

  if (!data) {
    return <p className="p-10 text-center text-gray-400">در حال آماده‌سازی گزارش...</p>;
  }

  const { report, netWorth, hiddenCost, narrative, label } = data;
  const generatedAt = new Date();

  return (
    <div dir="rtl" className="print-page max-w-3xl mx-auto px-8 py-10 text-gray-800 bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-page { max-width: none; padding: 0; }
          @page { margin: 16mm; }
        }
        .print-page table { width: 100%; border-collapse: collapse; }
        .print-page th, .print-page td { padding: 6px 8px; text-align: right; font-size: 12.5px; }
        .print-page thead th { border-bottom: 2px solid #1b3c37; color: #1b3c37; }
        .print-page tbody tr { border-bottom: 1px solid #eee; }
        .print-page tbody td.num { font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="no-print flex justify-end mb-6">
        <button
          onClick={() => window.print()}
          className="bg-brand-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-brand-700"
        >
          چاپ / ذخیره PDF
        </button>
      </div>

      <header className="mb-8 pb-4 border-b-2 border-brand-800">
        <h1 className="text-2xl font-bold text-brand-900">پنهان — گزارش {label}</h1>
        <p className="text-xs text-gray-400 mt-1">تاریخ تولید گزارش: {formatJalali(generatedAt, { withTime: true })}</p>
      </header>

      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-800 mb-2">خلاصه</h2>
        <p className="text-sm leading-8 text-gray-700">{narrative}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-800 mb-3">زمان</h2>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryBox label="کل زمان" value={formatDuration(report.totalDurationMin)} />
          <SummaryBox label="زمان مفید" value={formatDuration(report.productiveMin)} />
          <SummaryBox label="زمان هدررفته" value={formatDuration(report.wasteMin)} />
          <SummaryBox label="نسبت مفید بودن" value={`${Math.round(report.productiveRatio * 100)}٪`} />
        </div>
        {report.timeByCategory.length > 0 && (
          <table>
            <thead>
              <tr><th>دسته‌بندی</th><th>مدت زمان</th></tr>
            </thead>
            <tbody>
              {report.timeByCategory.map((c: any) => (
                <tr key={c.categoryId}><td>{c.name}</td><td className="num">{formatDuration(c.minutes)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-800 mb-3">مالی</h2>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryBox label="درآمد" value={format(report.income, { withSuffix: true })} />
          <SummaryBox label="هزینه" value={format(report.expense, { withSuffix: true })} />
          <SummaryBox label="خالص" value={format(report.net, { withSuffix: true })} />
          <SummaryBox label="هزینه زمانی" value={format(report.timeCost, { withSuffix: true })} />
        </div>
        {report.expenseByCategory.length > 0 && (
          <table>
            <thead>
              <tr><th>دسته‌بندی</th><th>مبلغ</th></tr>
            </thead>
            <tbody>
              {report.expenseByCategory.map((c: any) => (
                <tr key={c.categoryId}><td>{c.name}</td><td className="num">{format(c.amount, { withSuffix: true })}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-800 mb-3">هزینه واقعی و فرصت</h2>
        <div className="grid grid-cols-3 gap-3">
          <SummaryBox label="هزینه واقعی (مستقیم + زمانی)" value={format(report.realCost, { withSuffix: true })} />
          <SummaryBox label="هزینه فرصت (زمان‌های اتلافی)" value={format(report.opportunityCost, { withSuffix: true })} />
          <SummaryBox label="دارایی مجازی ایجادشده" value={format(report.virtualAssetValue, { withSuffix: true })} />
        </div>
      </section>

      {hiddenCost.items.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-gray-800 mb-3">هزینه پنهان کارها و رویدادها</h2>
          <table>
            <thead>
              <tr><th>عنوان</th><th>نوع</th><th>هزینه مستقیم</th><th>هزینه زمانی</th><th>مجموع</th></tr>
            </thead>
            <tbody>
              {hiddenCost.items.map((item: any) => (
                <tr key={`${item.entityType}-${item.id}`}>
                  <td>{item.title}</td>
                  <td>{item.entityType === "TASK" ? "کار" : "رویداد"}</td>
                  <td className="num">{format(item.directCost, { withSuffix: true })}</td>
                  <td className="num">{format(item.timeCost, { withSuffix: true })}</td>
                  <td className="num">{format(item.hiddenCost, { withSuffix: true })}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={2}>جمع کل</td>
                <td className="num">{format(hiddenCost.totalDirectCost, { withSuffix: true })}</td>
                <td className="num">{format(hiddenCost.totalTimeCost, { withSuffix: true })}</td>
                <td className="num">{format(hiddenCost.totalHiddenCost, { withSuffix: true })}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="text-base font-bold text-gray-800 mb-3">ارزش خالص دارایی</h2>
        <div className="grid grid-cols-4 gap-3">
          <SummaryBox label="دارایی واقعی" value={format(netWorth.realAssetsValue, { withSuffix: true })} />
          <SummaryBox label="دارایی مجازی" value={format(netWorth.virtualAssetsValue, { withSuffix: true })} />
          <SummaryBox label="بدهی" value={format(netWorth.totalDebt, { withSuffix: true })} />
          <SummaryBox label="ارزش خالص" value={format(netWorth.netWorth, { withSuffix: true })} />
        </div>
      </section>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
