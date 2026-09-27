"use client";

// Whether sign-in codes can reach people, and a test message to the owner's own address or phone.
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { adminPost, errorMessage } from "@/components/dashboard/adminApi";

interface MessagingStatus {
  email: { configured: boolean; host: string | null; from: string | null };
  sms: { configured: boolean; provider: string | null };
  production: boolean;
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted" dir="auto">
          {detail}
        </p>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs ${ok ? "bg-accent-soft text-accent" : "bg-amber-50 text-amber-800"}`}>{ok ? "فعال" : "راه‌اندازی نشده"}</span>
    </div>
  );
}

export default function MessagingPage() {
  const { data, error } = useSWR<MessagingStatus>("/api/admin/messaging", fetcher);
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

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">ایمیل و پیامک</h1>
        <p className="text-sm text-muted mt-1">کدهای تأیید، ورود با کد یکبار مصرف و بازیابی رمز از این دو راه می‌روند.</p>
      </div>
      {error && <p className="text-sm text-waste">{error.message}</p>}
      {data && (
        <Card className="p-5 divide-y divide-line">
          <Row label="ایمیل (SMTP)" ok={data.email.configured} detail={data.email.configured ? `${data.email.host} — فرستنده: ${data.email.from}` : "SMTP_HOST و SMTP_FROM (و SMTP_USER / SMTP_PASS) در فایل ‎.env سرور"} />
          <Row label="پیامک" ok={data.sms.configured} detail={data.sms.configured ? `سرویس: ${data.sms.provider}` : "SMS_PROVIDER=kavenegar یا smsir، به‌همراه کلید و قالب کد تأیید در ‎.env سرور"} />
        </Card>
      )}
      {data && !data.production && (
        <p className="text-xs text-muted bg-canvas rounded-xl p-3">
          این سرور در حالت توسعه است: وقتی سرویسی تنظیم نشده، کدها به‌جای ارسال در لاگ سرور نوشته می‌شوند.
        </p>
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
