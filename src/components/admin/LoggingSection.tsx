"use client";

// Dynamic debugging for the owner (see src/lib/observability/server/adminLogging.ts): turn a part of the server up to
// DEBUG for a few minutes — or one person's requests — without a deployment, and put everything back in one click.
// A verbose level always expires; every change is written to the audit trail.
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { adminFetch, clockTime, errorText, levelTone } from "./adminFetch";

interface LoggingState {
  base: string;
  configuredBase: string;
  baseExpiresAt: string | null;
  overrides: Array<{ scope: string; level: string; expiresAt: string | null; configured: boolean }>;
  users: Array<{ userId: string; level: string; expiresAt: string | null }>;
}
interface LoggingResponse {
  state: LoggingState;
  levels: string[];
  scopes: string[];
  limits: { defaultTtlMinutes: number; maxTtlMinutes: number };
}

const KIND_LABELS = { scope: "یک بخش (مثل SYNC)", base: "کل سرور", user: "یک کاربر (شناسه‌ی حساب)" } as const;
type Kind = keyof typeof KIND_LABELS;

function until(expiresAt: string | null, configured?: boolean): string {
  if (expiresAt) return `تا ساعت ${clockTime(expiresAt)}`;
  return configured ? "تنظیم محیط" : "تا ری‌استارت بعدی";
}

export default function LoggingSection() {
  const [data, setData] = useState<LoggingResponse | null>(null);
  const [kind, setKind] = useState<Kind>("scope");
  const [key, setKey] = useState("SYNC");
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState("DEBUG");
  const [ttl, setTtl] = useState("30");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<LoggingResponse>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setData(await work());
      setMessage(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const load = () => run(() => adminFetch<LoggingResponse>("GET", "/api/admin/logging"), "بارگذاری شد.");
  const clear = (query: string) => run(() => adminFetch<LoggingResponse>("DELETE", `/api/admin/logging?${query}`), "برگردانده شد.");
  const apply = () => {
    const ttlMinutes = ttl.trim() === "" ? undefined : Number(ttl);
    const body = kind === "base" ? { kind, level, ttlMinutes } : kind === "user" ? { kind, userId: userId.trim(), level, ttlMinutes } : { kind, key: key.trim(), level, ttlMinutes };
    return run(() => adminFetch<LoggingResponse>("PUT", "/api/admin/logging", body), "اعمال شد.");
  };

  const state = data?.state;
  const verbose = level === "TRACE" || level === "DEBUG";

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-bold text-ink text-sm">سطح لاگ سرور (بدون دیپلوی)</h2>
      <p className="text-xs text-muted leading-relaxed">
        برای دیدن جزئیات یک بخش (مثلاً همگام‌سازی) آن را چند دقیقه روی DEBUG ببرید؛ بخش‌های دیگر همان‌طور می‌مانند. سطح‌های DEBUG و TRACE
        خودکار پس از مدت تعیین‌شده (پیش‌فرض ۳۰ دقیقه، حداکثر ۲۴ ساعت) برمی‌گردند. هر تغییر در تاریخچه‌ی مدیریت ثبت می‌شود.
      </p>

      {!data ? (
        <button type="button" onClick={load} disabled={busy} className="bg-canvas text-ink px-4 py-2 rounded-xl text-sm disabled:opacity-40">
          {busy ? "در حال بارگذاری..." : "بارگذاری تنظیمات فعلی"}
        </button>
      ) : (
        <div className="space-y-4">
          {state && (
            <div className="space-y-2 bg-canvas rounded-xl p-3 text-xs" dir="rtl">
              <p className="text-ink">
                سطح کلی: <b dir="ltr" className={levelTone(state.base)}>{state.base}</b>
                {state.base !== state.configuredBase && <span className="text-muted"> (تنظیم اصلی: <span dir="ltr">{state.configuredBase}</span>{state.baseExpiresAt ? `، برمی‌گردد ${until(state.baseExpiresAt)}` : ""})</span>}
              </p>
              {state.overrides.length === 0 && state.users.length === 0 && <p className="text-muted">هیچ استثنایی برای بخش یا کاربر تنظیم نشده.</p>}
              <ul className="space-y-1">
                {state.overrides.map((rule) => (
                  <li key={rule.scope} className="flex items-center justify-between gap-2">
                    <span>
                      <b dir="ltr">{rule.scope}</b> ← <b dir="ltr" className={levelTone(rule.level)}>{rule.level}</b> <span className="text-muted">({until(rule.expiresAt, rule.configured)})</span>
                    </span>
                    {!rule.configured && (
                      <button type="button" onClick={() => clear(`scope=${encodeURIComponent(rule.scope)}`)} disabled={busy} className="text-accent disabled:opacity-40">
                        برگردان
                      </button>
                    )}
                  </li>
                ))}
                {state.users.map((rule) => (
                  <li key={rule.userId} className="flex items-center justify-between gap-2">
                    <span>
                      کاربر <b dir="ltr">{rule.userId}</b> ← <b dir="ltr" className={levelTone(rule.level)}>{rule.level}</b> <span className="text-muted">({until(rule.expiresAt)})</span>
                    </span>
                    <button type="button" onClick={() => clear(`user=${encodeURIComponent(rule.userId)}`)} disabled={busy} className="text-accent disabled:opacity-40">
                      برگردان
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 border-t border-line pt-3">
            <div>
              <label className="block text-xs text-muted mb-1" htmlFor="log-kind">چه چیزی؟</label>
              <select id="log-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm">
                {(Object.keys(KIND_LABELS) as Kind[]).map((value) => (
                  <option key={value} value={value}>{KIND_LABELS[value]}</option>
                ))}
              </select>
            </div>
            {kind === "scope" && (
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="log-scope">نام بخش (SYNC، AUTH، TASK، REPORT، DB …)</label>
                <input id="log-scope" list="log-scopes" value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
                <datalist id="log-scopes">{data.scopes.map((scope) => <option key={scope} value={scope} />)}</datalist>
              </div>
            )}
            {kind === "user" && (
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="log-user">شناسه‌ی حساب کاربر</label>
                <input id="log-user" value={userId} onChange={(e) => setUserId(e.target.value)} dir="ltr" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
              </div>
            )}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1" htmlFor="log-level">سطح</label>
                <select id="log-level" value={level} onChange={(e) => setLevel(e.target.value)} dir="ltr" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm">
                  {data.levels.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-xs text-muted mb-1" htmlFor="log-ttl">مدت (دقیقه)</label>
                <input id="log-ttl" type="number" min={1} max={data.limits.maxTtlMinutes} value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder={verbose ? String(data.limits.defaultTtlMinutes) : "دائمی"} dir="ltr" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm text-center" />
              </div>
            </div>
            {verbose && <p className="text-xs text-muted">سطح {level} همیشه محدود به زمان است؛ اگر خالی بگذارید {data.limits.defaultTtlMinutes} دقیقه می‌شود.</p>}

            {error && <p className="text-xs text-waste">{error}</p>}
            {message && <p className="text-xs text-accent">{message}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={apply} disabled={busy || (kind === "user" && !userId.trim()) || (kind === "scope" && !key.trim())} className="flex-1 bg-accent text-on-accent py-2.5 rounded-xl text-sm font-medium disabled:opacity-40">
                {busy ? "در حال اعمال..." : "اعمال"}
              </button>
              <button type="button" onClick={() => clear("all=1")} disabled={busy} className="bg-canvas text-ink px-4 py-2.5 rounded-xl text-sm disabled:opacity-40">
                همه را به تنظیم اصلی برگردان
              </button>
            </div>
          </div>
        </div>
      )}
      {!data && error && <p className="text-xs text-waste">{error}</p>}
    </Card>
  );
}
