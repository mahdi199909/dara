"use client";

// Email and SMS: the settings behind one-time codes, editable here instead of the server's .env.
// Secret fields (SMTP password, API keys) are write-only — the server only ever says whether they are
// set. Saving asks for the owner's password again; values are stored encrypted on the server.
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { adminPost, errorMessage } from "@/components/dashboard/adminApi";
import { adminFetch } from "@/components/admin/adminFetch";
import type { SettingView } from "@/lib/serverSettings";

interface MessagingStatus {
  fields: SettingView[];
  email: { configured: boolean };
  sms: { configured: boolean; provider: string | null };
  production: boolean;
}

const SOURCE_LABEL: Record<string, string> = { dashboard: "از داشبورد", env: "از فایل ‎.env سرور" };

function StatusBadge({ ok }: { ok: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${ok ? "bg-accent-soft text-accent" : "bg-amber-50 text-amber-800"}`}>{ok ? "فعال" : "راه‌اندازی نشده"}</span>;
}

function SettingsForm({ group, fields, onSaved }: { group: "email" | "sms"; fields: SettingView[]; onSaved: (fields: SettingView[]) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = fields.filter((f) => f.group === group);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: Record<string, string | null> = {};
    for (const f of mine) {
      if (cleared[f.key]) changes[f.key] = null;
      else if ((values[f.key] ?? "").trim() !== "" && values[f.key] !== (f.secret ? "" : f.value ?? "")) changes[f.key] = values[f.key].trim();
    }
    if (Object.keys(changes).length === 0) return setError("چیزی تغییر نکرده است.");
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await adminFetch<{ changed: string[]; fields: SettingView[] }>("PUT", "/api/admin/messaging", { password, values: changes });
      setMessage(`ذخیره شد (${res.changed.length} مورد).`);
      setValues({});
      setCleared({});
      setPassword("");
      onSaved(res.fields);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {mine.map((f) => (
        <div key={f.key} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-ink" htmlFor={f.key}>
              {f.label} <span className="text-muted" dir="ltr">({f.key})</span>
            </label>
            <span className="text-[11px] text-muted">
              {f.unreadable ? <span className="text-waste">ذخیره‌شده ولی قابل خواندن نیست — دوباره وارد کنید</span> : f.source ? SOURCE_LABEL[f.source] : "تنظیم نشده"}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <input
              id={f.key}
              type={f.secret ? "password" : "text"}
              dir="ltr"
              autoComplete={f.secret ? "new-password" : "off"}
              disabled={cleared[f.key]}
              value={values[f.key] ?? (f.secret ? "" : f.value ?? "")}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.secret ? (f.source ? "•••••••• (تنظیم شده؛ برای تغییر مقدار جدید بنویسید)" : "") : ""}
              className="flex-1 bg-surface rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-40"
            />
            {f.source === "dashboard" && (
              <label className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap">
                <input type="checkbox" checked={Boolean(cleared[f.key])} onChange={(e) => setCleared({ ...cleared, [f.key]: e.target.checked })} />
                پاک شود
              </label>
            )}
          </div>
        </div>
      ))}
      <div className="border-t border-line pt-3 space-y-2">
        <label className="block text-xs text-muted">برای ذخیره، رمز عبور خودتان را وارد کنید</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
        {error && <p className="text-xs text-waste">{error}</p>}
        {message && <p className="text-xs text-accent">{message}</p>}
        <button type="submit" disabled={busy || !password} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm disabled:opacity-40">
          {busy ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </div>
    </form>
  );
}

export default function MessagingPage() {
  const { data, error, mutate } = useSWR<MessagingStatus>("/api/admin/messaging", fetcher);
  const [busy, setBusy] = useState<"EMAIL" | "SMS" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function test(channel: "EMAIL" | "SMS") {
    setBusy(channel);
    setResult(null);
    try {
      const res = await adminPost<{ sentTo: string }>("/api/admin/messaging", { channel });
      setResult(`پیام آزمایشی به ${res.sentTo} فرستاده شد.`);
    } catch (err) {
      setResult(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const onSaved = () => void mutate();

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">ایمیل و پیامک</h1>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          کدهای تأیید، ورود با کد یکبار مصرف و بازیابی رمز از این دو راه می‌روند. مقدارهای این صفحه رمزنگاری‌شده روی سرور نگه داشته
          می‌شوند، رمزها و کلیدها هیچ‌وقت دوباره نمایش داده نمی‌شوند و مقدار داشبورد بر مقدار فایل ‎.env سرور مقدم است.
        </p>
      </div>
      {error && <p className="text-sm text-waste">{error.message}</p>}
      {data && (
        <>
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm">ایمیل (SMTP)</h2>
              <StatusBadge ok={data.email.configured} />
            </div>
            <SettingsForm group="email" fields={data.fields} onSaved={onSaved} />
          </Card>
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm">پیامک {data.sms.provider ? `(${data.sms.provider})` : ""}</h2>
              <StatusBadge ok={data.sms.configured} />
            </div>
            <p className="text-xs text-muted leading-relaxed">
              برای کاوه‌نگار: SMS_PROVIDER=kavenegar، کلید API و نام یک قالب «verify lookup» که ‎%token در آن کد است. برای sms.ir:
              SMS_PROVIDER=smsir، کلید API، شناسه‌ی قالب و نام پارامتر کد.
            </p>
            <SettingsForm group="sms" fields={data.fields} onSaved={onSaved} />
          </Card>
          {!data.production && <p className="text-xs text-muted bg-canvas rounded-xl p-3">این سرور در حالت توسعه است: وقتی سرویسی تنظیم نشده، کدها به‌جای ارسال در لاگ سرور نوشته می‌شوند.</p>}
        </>
      )}
      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-sm">ارسال پیام آزمایشی به خودتان</h2>
        <div className="flex gap-2">
          <button onClick={() => void test("EMAIL")} disabled={busy !== null} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm disabled:opacity-40">
            {busy === "EMAIL" ? "در حال ارسال..." : "ایمیل آزمایشی"}
          </button>
          <button onClick={() => void test("SMS")} disabled={busy !== null} className="rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-40">
            {busy === "SMS" ? "در حال ارسال..." : "پیامک آزمایشی"}
          </button>
        </div>
        {result && <p className="text-sm">{result}</p>}
      </Card>
    </div>
  );
}
