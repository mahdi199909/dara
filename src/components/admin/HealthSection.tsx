"use client";

// The owner's at-a-glance view of the running server (GET /api/admin/health): counts and timings since it started, and
// the last few problems. Numbers only — never a person's data. See src/lib/observability/server/healthReport.ts.
import { useState } from "react";
import { Card, StatItem } from "@/components/ui/Card";
import type { HealthReport } from "@/lib/observability/server/healthReport";
import { adminFetch, clockTime, errorText, levelTone } from "./adminFetch";

const num = (value: number | null | undefined): string => (value === null || value === undefined ? "—" : value.toLocaleString("en-US"));
const ms = (value: number | null | undefined): string => (value === null || value === undefined ? "—" : `${num(Math.round(value))} ms`);
const percent = (rate: number): string => `${(rate * 100).toFixed(rate > 0 && rate < 0.001 ? 2 : 1)}%`;
const pairs = (record: Record<string, number>): string => (Object.keys(record).length === 0 ? "—" : Object.entries(record).map(([name, count]) => `${name} ${num(count)}`).join("، "));

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days} روز و ${hours} ساعت` : hours > 0 ? `${hours} ساعت و ${minutes} دقیقه` : `${minutes} دقیقه`;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="text-xs font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export default function HealthSection() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setHealth(await adminFetch<HealthReport>("GET", "/api/admin/health"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-ink text-sm">وضعیت سرور</h2>
        <button type="button" onClick={load} disabled={busy} className="bg-canvas text-ink px-4 py-1.5 rounded-xl text-xs disabled:opacity-40">
          {busy ? "..." : health ? "تازه‌سازی" : "بارگذاری"}
        </button>
      </div>
      {error && <p className="text-xs text-waste">{error}</p>}
      {!health && !error && <p className="text-xs text-muted leading-relaxed">تعداد درخواست‌ها، خطاها، کندی‌ها، همگام‌سازی، ورودهای ناموفق، کارهای پس‌زمینه، گزارش‌ها و آخرین مشکلات — از زمان روشن‌شدن سرور.</p>}

      {health && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            روشن از {uptime(health.uptimeSeconds)} پیش — حافظه <span dir="ltr">{health.process.rssMb} MB</span> — <span dir="ltr">Node {health.process.node}</span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatItem label="درخواست‌ها" value={num(health.requests.total)} />
            <StatItem label="خطای سرور (۵xx)" value={`${num(health.requests.serverErrors)} (${percent(health.requests.errorRate)})`} tone={health.requests.serverErrors > 0 ? "negative" : "default"} />
            <StatItem label="میانه / ۹۵٪ زمان" value={<span dir="ltr">{ms(health.requests.p50Ms)} / {ms(health.requests.p95Ms)}</span>} />
            <StatItem label="درخواست کند" value={num(health.requests.slow)} tone={health.requests.slow > 0 ? "negative" : "default"} />
          </div>

          {health.requests.slowestRoutes.length > 0 && (
            <Group title="کندترین مسیرها (۹۵٪ زمان)">
              <ul className="space-y-1 text-xs" dir="ltr">
                {health.requests.slowestRoutes.map((row) => (
                  <li key={`${row.method} ${row.route}`} className="flex justify-between gap-2">
                    <span>{row.method} {row.route}</span>
                    <span className="text-muted">{ms(row.p95Ms)} · {num(row.requests)} req{row.serverErrors > 0 ? ` · ${num(row.serverErrors)} err` : ""}</span>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          <Group title="پایگاه داده">
            <p className="text-xs text-ink">
              {num(health.database.queries)} عملیات — ناموفق {num(health.database.failed)} — کند {num(health.database.slow)} — ۹۵٪ <span dir="ltr">{ms(health.database.p95Ms)}</span> — تراکنش‌ها: <span dir="ltr">{pairs(health.database.transactions)}</span>
            </p>
          </Group>

          <Group title="همگام‌سازی">
            <p className="text-xs text-ink" dir="ltr">
              push: {pairs(health.sync.push)} · pull: {pairs(health.sync.pull)} · 5xx: {num(health.sync.serverErrors)} · slow: {num(health.sync.slow)}
            </p>
          </Group>

          <Group title="ورود و دسترسی">
            <p className="text-xs text-ink" dir="ltr">{pairs(health.auth)}</p>
          </Group>

          {(health.jobs.length > 0 || health.reports.length > 0) && (
            <Group title="کارهای پس‌زمینه و گزارش‌ها">
              <ul className="space-y-1 text-xs" dir="ltr">
                {health.jobs.map((job) => (
                  <li key={job.job} className="flex justify-between gap-2">
                    <span>{job.job}</span>
                    <span className={job.failed > 0 ? "text-waste" : "text-muted"}>ok {num(job.completed)} · failed {num(job.failed)} · skipped {num(job.skipped)}</span>
                  </li>
                ))}
                {health.reports.map((report) => (
                  <li key={report.report} className="flex justify-between gap-2">
                    <span>report: {report.report}</span>
                    <span className={report.failed > 0 ? "text-waste" : "text-muted"}>ok {num(report.completed)} · failed {num(report.failed)} · p95 {ms(report.p95Ms)}</span>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          <Group title="خود لاگ‌ها">
            <p className="text-xs text-ink" dir="ltr">
              emitted: {pairs(health.logging.emitted)} · sampled out: {num(health.logging.sampledOut)} · sink errors: {num(health.logging.sinkErrors)}
            </p>
            {health.logging.sinks?.file ? (
              <p className="text-xs text-muted" dir="ltr">
                file: {health.logging.sinks.file.queue.circuit} · queued {num(health.logging.sinks.file.queue.queued)} · kept {health.logging.sinks.file.retentionDays ?? "until size limit"} days · {num(health.logging.sinks.file.files.archives)} archives
              </p>
            ) : (
              <p className="text-xs text-muted">فایل لاگ تنظیم نشده (LOG_FILE_DIR) — جست‌وجوی تاریخچه در دسترس نیست.</p>
            )}
            {health.logging.sinks?.remote && (
              <p className="text-xs text-muted" dir="ltr">
                collector {health.logging.sinks.remote.host}: {health.logging.sinks.remote.queue.circuit} · queued {num(health.logging.sinks.remote.queue.queued)} · dropped {num(health.logging.sinks.remote.queue.dropped)}
              </p>
            )}
          </Group>

          {health.logging.notable.length > 0 && (
            <Group title="پرتکرارترین هشدارها و خطاها">
              <ul className="space-y-1 text-xs" dir="ltr">
                {health.logging.notable.slice(0, 8).map((row) => (
                  <li key={`${row.event}-${row.level}`} className="flex justify-between gap-2">
                    <span className={levelTone(row.level)}>{row.event}</span>
                    <span className="text-muted">{num(row.count)}</span>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          <Group title="آخرین مشکلات">
            {health.logging.recentProblems.length === 0 ? (
              <p className="text-xs text-muted">از زمان روشن‌شدن سرور هشدار یا خطایی نبوده.</p>
            ) : (
              <ul className="space-y-1.5 text-xs" dir="ltr">
                {health.logging.recentProblems.map((problem, index) => (
                  <li key={`${problem.timestamp}-${index}`} className="leading-relaxed">
                    <span className="text-muted">{clockTime(problem.timestamp)} </span>
                    <b className={levelTone(problem.level)}>{problem.level}</b> {problem.event}
                    {problem.errorCode ? <span className="text-muted"> [{problem.errorCode}]</span> : null}
                    {problem.request ? <span className="text-muted"> {problem.request}{problem.statusCode ? ` → ${problem.statusCode}` : ""}</span> : null}
                    {problem.requestId ? <span className="text-muted"> {problem.requestId}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </div>
      )}
    </Card>
  );
}
