"use client";

import { Suspense, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { fetcher, apiPatch } from "@/lib/apiClient";
import { Card, StatItem, EmptyState } from "@/components/ui/Card";
import { formatDuration } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { TASK_STATUS_LABELS, PROJECT_STATUS_LABELS, type TaskStatus, type ProjectStatus } from "@/lib/types";
import { CheckSquareIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";

// A query param (?id=...) rather than a /projects/[id] dynamic segment on purpose: the Android
// build statically exports every page (no server at runtime to resolve an arbitrary id), which
// requires generateStaticParams() up front for any dynamic segment — impossible here since
// project ids are created on-device, long after the app is built. A plain query param needs no
// build-time knowledge of which ids exist, so the exact same file works for both targets.
export default function ProjectDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDetailContent />
    </Suspense>
  );
}

function ProjectDetailContent() {
  const id = useSearchParams().get("id");
  const { data, mutate } = useSWR<any>(id ? `/api/projects/${id}` : null, fetcher);
  const [completing, setCompleting] = useState(false);
  const { format } = useCurrencyUnit();

  if (!data) return <p className="text-sm text-gray-400 text-center py-10">در حال بارگذاری...</p>;

  const { project, tasks, activities, transactions, summary, virtualAssetEntry } = data;

  async function markComplete() {
    setCompleting(true);
    try {
      await apiPatch(`/api/projects/${id}`, { status: "COMPLETED" });
      mutate();
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-800">{project.name}</h1>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {PROJECT_STATUS_LABELS[project.status as ProjectStatus]}
            </span>
          </div>
          {project.description && <p className="text-sm text-gray-500 mt-1">{project.description}</p>}
        </div>
        {project.status !== "COMPLETED" && (
          <button
            onClick={markComplete}
            disabled={completing}
            className="shrink-0 flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-2 rounded-xl hover:bg-brand-700 disabled:opacity-40"
          >
            <CheckSquareIcon className="w-4 h-4" />
            اتمام پروژه
          </button>
        )}
      </div>

      {virtualAssetEntry && (
        <Card className="p-4 bg-brand-50 border-brand-100">
          <p className="text-sm text-brand-800">
            این پروژه در {formatJalali(new Date(virtualAssetEntry.date))} تکمیل شد و به‌عنوان یک دارایی مجازی جداگانه به ارزش{" "}
            <strong>{format(virtualAssetEntry.totalValue, { withSuffix: true })}</strong> در سیستم دارایی ثبت شده است.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">پیشرفت</span>
          <span className="text-sm font-bold text-brand-700">{summary.progress}٪</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-600" style={{ width: `${summary.progress}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-5">
          <StatItem label="زمان کل" value={formatDuration(summary.totalDurationMin)} />
          <StatItem label="هزینه مستقیم" value={format(summary.directCost, { withSuffix: true })} tone="negative" />
          <StatItem label="هزینه زمانی" value={format(summary.timeCost, { withSuffix: true })} />
          <StatItem label="هزینه واقعی" value={format(summary.realCost, { withSuffix: true })} tone="negative" />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-bold text-gray-800 text-sm mb-3">جریان نقدینگی پروژه</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatItem label="درآمد" value={format(summary.income, { withSuffix: true })} tone="positive" />
          <StatItem label="هزینه مستقیم" value={format(summary.directCost, { withSuffix: true })} tone="negative" />
          <StatItem
            label="خالص"
            value={`${summary.netCashFlow >= 0 ? "+" : ""}${format(summary.netCashFlow, { withSuffix: true })}`}
            tone={summary.netCashFlow >= 0 ? "positive" : "negative"}
          />
        </div>
      </Card>

      <section>
        <h2 className="font-bold text-gray-700 text-sm mb-2">کارها ({summary.doneTasks}/{summary.totalTasks})</h2>
        <Card>
          {tasks.length === 0 ? (
            <EmptyState message="کاری برای این پروژه ثبت نشده." />
          ) : (
            <ul className="divide-y divide-gray-50">
              {tasks.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className={t.status === "DONE" ? "line-through text-gray-400" : "text-gray-700"}>{t.title}</span>
                  <span className="text-xs text-gray-400">{TASK_STATUS_LABELS[t.status as TaskStatus]}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <h2 className="font-bold text-gray-700 text-sm mb-2">فعالیت‌ها</h2>
        {activities.length === 0 ? (
          <Card>
            <EmptyState message="فعالیتی برای این پروژه ثبت نشده." />
          </Card>
        ) : (
          <div className="space-y-3">
            {Object.entries(
              activities.reduce((groups: Record<string, any[]>, a: any) => {
                const key = a.category?.name ?? "بدون دسته‌بندی";
                (groups[key] ??= []).push(a);
                return groups;
              }, {})
            ).map(([categoryName, items]) => (
              <div key={categoryName}>
                <p className="text-xs text-gray-400 mb-1 px-1">{categoryName}</p>
                <Card>
                  <ul className="divide-y divide-gray-50">
                    {(items as any[]).map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-700">{a.title}</span>
                        <span className="text-xs text-gray-400">{formatDuration(a.totalDurationMin)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-bold text-gray-700 text-sm mb-2">تراکنش‌ها</h2>
        <Card>
          {transactions.length === 0 ? (
            <EmptyState message="تراکنشی برای این پروژه ثبت نشده." />
          ) : (
            <ul className="divide-y divide-gray-50">
              {transactions.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-gray-700">{t.description || "تراکنش"}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{formatJalali(new Date(t.date))}</span>
                    <span className={t.type === "EXPENSE" ? "text-waste-600" : "text-brand-700"}>{format(t.amount, { withSuffix: true })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
