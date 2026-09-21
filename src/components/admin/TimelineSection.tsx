"use client";

// The support timeline (GET /api/admin/logs): pick a person — an e-mail address or an account id — or a request or sync
// id, and read what the server did, oldest first, from its log files. Nothing sensitive is in it (records are redacted when
// written and again on the way out), and reading it is itself written to the log. See doc/logging/debugging.md.
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { TimelineEntry } from "@/lib/observability/server/logSearch";
import { adminFetch, clockTime, errorText, levelTone } from "./adminFetch";

interface LogsResponse {
  available: boolean;
  reason?: string;
  records: TimelineEntry[];
  truncated?: boolean;
  filesRead?: number;
  recordsScanned?: number;
  targetUserId?: string;
}

const SINCE = [
  ["15m", "۱۵ دقیقه‌ی اخیر"],
  ["2h", "۲ ساعت اخیر"],
  ["24h", "۲۴ ساعت اخیر"],
  ["3d", "۳ روز اخیر"],
  ["14d", "۱۴ روز اخیر"],
] as const;
const LEVELS = ["", "INFO", "WARN", "ERROR"] as const;

function summary(entry: TimelineEntry): string {
  const parts: string[] = [];
  if (entry.method && entry.path) parts.push(`${entry.method} ${entry.path}`);
  if (entry.statusCode) parts.push(`→ ${entry.statusCode}`);
  if (entry.durationMs !== undefined) parts.push(`${Math.round(entry.durationMs)}ms`);
  if (entry.errorCode) parts.push(`[${entry.errorCode}]`);
  return parts.length > 0 ? parts.join(" ") : entry.message;
}

export default function TimelineSection() {
  const [person, setPerson] = useState("");
  const [requestId, setRequestId] = useState("");
  const [event, setEvent] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("");
  const [since, setSince] = useState<(typeof SINCE)[number][0]>("24h");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LogsResponse | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    setOpen(null);
    try {
      const query = new URLSearchParams({ since, limit: "300" });
      if (person.trim()) query.set("user", person.trim());
      if (requestId.trim()) query.set("request", requestId.trim());
      if (event.trim()) query.set("event", event.trim());
      if (level) query.set("level", level);
      setResult(await adminFetch<LogsResponse>("GET", `/api/admin/logs?${query.toString()}`));
    } catch (err) {
      setResult(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-bold text-ink text-sm">تایم‌لاین فنی کاربر</h2>
      <p className="text-xs text-muted leading-relaxed">
        ایمیل یا شناسه‌ی حساب یک کاربر (یا شناسه‌ی درخواست) را بدهید تا ببینید سرور برایش چه کرده — از ورود تا همگام‌سازی. هیچ عنوان، مبلغ یا
        رمزی در این لاگ‌ها نیست؛ و خودِ جست‌وجو هم در لاگ ثبت می‌شود.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={person} onChange={(e) => setPerson(e.target.value)} dir="ltr" placeholder="ایمیل یا شناسه‌ی کاربر" aria-label="ایمیل یا شناسه‌ی کاربر" className="bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
        <input value={requestId} onChange={(e) => setRequestId(e.target.value)} dir="ltr" placeholder="شناسه‌ی درخواست (req_…)" aria-label="شناسه‌ی درخواست" className="bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
        <input value={event} onChange={(e) => setEvent(e.target.value)} dir="ltr" placeholder="رویداد، مثل SYNC_* یا AUTH_LOGIN_FAILED" aria-label="رویداد" className="bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <select value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])} dir="ltr" aria-label="حداقل سطح" className="flex-1 bg-surface rounded-xl border border-line px-2 py-2 text-sm">
            {LEVELS.map((value) => <option key={value} value={value}>{value === "" ? "همه‌ی سطح‌ها" : `${value} و بالاتر`}</option>)}
          </select>
          <select value={since} onChange={(e) => setSince(e.target.value as (typeof SINCE)[number][0])} aria-label="بازه‌ی زمانی" className="flex-1 bg-surface rounded-xl border border-line px-2 py-2 text-sm">
            {SINCE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <button type="button" onClick={search} disabled={busy || (!person.trim() && !requestId.trim() && !event.trim() && !level)} className="w-full bg-accent text-on-accent py-2.5 rounded-xl text-sm font-medium disabled:opacity-40">
        {busy ? "در حال جست‌وجو..." : "نمایش تایم‌لاین"}
      </button>
      {error && <p className="text-xs text-waste">{error}</p>}

      {result && !result.available && <p className="text-xs text-muted leading-relaxed bg-canvas rounded-xl p-3">{result.reason}</p>}
      {result?.available && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {result.records.length.toLocaleString("en-US")} رویداد{result.truncated ? " (فقط جدیدترین‌ها؛ فیلتر را دقیق‌تر کنید)" : ""}
            {result.targetUserId ? <> — حساب <span dir="ltr">{result.targetUserId}</span></> : null}
          </p>
          {result.records.length === 0 ? (
            <p className="text-xs text-muted">چیزی پیدا نشد.</p>
          ) : (
            <ol className="space-y-1 text-xs" dir="ltr">
              {result.records.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`} className="border-b border-line/60 pb-1">
                  <button type="button" onClick={() => setOpen(open === index ? null : index)} className="w-full text-left leading-relaxed" aria-expanded={open === index}>
                    <span className="text-muted">{clockTime(entry.timestamp)} </span>
                    <b className={levelTone(entry.level)}>{entry.level}</b> {entry.event}
                    <span className="text-muted"> {summary(entry)}</span>
                  </button>
                  {open === index && (
                    <pre className="mt-1 bg-canvas rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-ink">{JSON.stringify(entry, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
