"use client";

// Settings → اعلان‌ها و یادآورها. Shows, in plain words, everything that decides whether a reminder
// rings on this phone — the notification permission, the reminders channel, exact alarms, the
// battery restrictions that stop a closed app — each with the button that fixes it, and two test
// notifications: one now, one a minute from now to be received with the app closed (the situation
// that matters, and the one that fails on phones with an aggressive battery manager).
// Only shown inside the Android app.
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { toPersianDigits } from "@/lib/money";
import { APP_DISPLAY_NAME } from "@/lib/appVersion";
import { batteryBrandOf } from "@/lib/phoneBrand";
import { useNotificationStatus } from "@/components/native/useNotificationStatus";

function Row({ ok, title, detail, action }: { ok: boolean | null; title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 w-4 text-center text-sm font-bold ${ok === null ? "text-muted" : ok ? "text-accent" : "text-waste"}`} aria-hidden>
        {ok === null ? "•" : ok ? "✓" : "!"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink">{title}</p>
        {detail && <p className="text-xs text-muted leading-relaxed mt-0.5">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-accent text-on-accent hover:opacity-90 disabled:opacity-40">
      {children}
    </button>
  );
}

export default function NotificationsCard() {
  const { status, refresh } = useNotificationStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Not the Android app (or the plugin does not answer): there is nothing to show.
  if (!status || !status.available) return null;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "انجام نشد.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function turnOn() {
    const { enableNotifications } = await import("@/local/notificationStatus");
    const result = await enableNotifications();
    if (result === "settings") setMessage("در صفحه‌ی باز شده «اعلان‌ها» را روشن کنید و به برنامه برگردید.");
    else if (result === "denied") setError("اجازه داده نشد. هر زمان خواستید همین‌جا دوباره امتحان کنید.");
  }

  async function sendTest(delaySeconds: number) {
    const { sendTestNotification } = await import("@/local/nativeNotifications");
    await sendTestNotification({
      title: `${APP_DISPLAY_NAME} — اعلان آزمایشی`,
      body: "اگر این پیام را می‌بینید، اعلان‌ها روی این گوشی کار می‌کنند.",
      delaySeconds,
    });
    setMessage(
      delaySeconds <= 10
        ? "اعلان آزمایشی تا چند ثانیه‌ی دیگر نمایش داده می‌شود. اگر ندیدید، موارد بالا را بررسی کنید."
        : "اعلان آزمایشی برای یک دقیقه‌ی دیگر زمان‌بندی شد. برنامه را ببندید (از فهرست برنامه‌های اخیر هم پاک کنید) و منتظر بمانید. اگر نیامد، مانع از تنظیمات باتری گوشی است."
    );
  }

  const brand = batteryBrandOf(status.manufacturer);
  const permissionGranted = status.permission === "granted";
  const allowed = permissionGranted && !status.channelMuted;
  const couldBeBetter = allowed && (status.batteryUnrestricted === false || !status.exactAlarms);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-bold text-ink text-sm">اعلان‌ها و یادآورها</h2>
        <p className={`text-xs mt-1 leading-relaxed ${!allowed ? "text-waste" : couldBeBetter ? "text-muted" : "text-accent"}`}>
          {!allowed
            ? "چیزی مانع رسیدن اعلان‌هاست — موارد زیر را درست کنید."
            : couldBeBetter
              ? "اعلان‌ها روشن است، ولی برای رسیدن به‌موقع بهتر است موارد زیر هم درست شود."
              : "اعلان‌ها روشن است؛ یادآورها به موقع زنگ می‌خورند."}
        </p>
      </div>

      <div className="space-y-3">
        <Row
          ok={permissionGranted}
          title="اجازه‌ی اعلان"
          detail={
            permissionGranted
              ? "روشن است."
              : status.permission === "denied"
                ? "خاموش است؛ تا روشن نشود هیچ یادآوری‌ای زنگ نمی‌خورد. باید از تنظیمات گوشی روشنش کنید."
                : "هنوز اجازه‌ای داده نشده است."
          }
          action={
            !permissionGranted && (
              <ActionButton onClick={() => void run("enable", turnOn)} disabled={busy !== null}>
                روشن کردن
              </ActionButton>
            )
          }
        />

        {status.channelMuted && (
          <Row
            ok={false}
            title="کانال «یادآورها»"
            detail="در تنظیمات گوشی بی‌صدا یا بسته شده است؛ اعلان می‌رسد ولی دیده نمی‌شود."
            action={
              <ActionButton
                onClick={() =>
                  void run("channel", async () => {
                    (await import("@/local/notificationStatus")).openNotificationSettings();
                  })
                }
                disabled={busy !== null}
              >
                باز کردن تنظیمات
              </ActionButton>
            }
          />
        )}

        <Row
          ok={status.exactAlarms}
          title="زمان‌بندی دقیق"
          detail={status.exactAlarms ? "یادآورها سر همان دقیقه‌ی تعیین‌شده می‌رسند." : "بدون آن، گوشی ممکن است یادآورها را چند دقیقه دیرتر برساند."}
          action={
            !status.exactAlarms && (
              <ActionButton
                onClick={() =>
                  void run("exact", async () => {
                    const allowedNow = await (await import("@/local/notificationStatus")).allowExactAlarms();
                    if (!allowedNow) setMessage("«زمان‌بندی دقیق» هنوز روشن نشد. در صفحه‌ی «هشدارها و یادآورها» آن را برای برنامه روشن کنید.");
                  })
                }
                disabled={busy !== null}
              >
                اجازه دادن
              </ActionButton>
            )
          }
        />

        {status.batteryUnrestricted !== null && (
          <Row
            ok={status.batteryUnrestricted}
            title="صرفه‌جویی باتری"
            detail={
              status.batteryUnrestricted
                ? "برنامه از محدودیت باتری مستثنی است."
                : "صرفه‌جویی باتری می‌تواند وقتی برنامه بسته است اعلان‌ها را متوقف کند. برای برنامه «بدون محدودیت» را انتخاب کنید."
            }
            action={
              !status.batteryUnrestricted && (
                <ActionButton
                  onClick={() =>
                    void run("battery", async () => {
                      (await import("@/local/notificationStatus")).openBatterySettings();
                    })
                  }
                  disabled={busy !== null}
                >
                  تنظیمات باتری
                </ActionButton>
              )
            }
          />
        )}

        {brand && (
          <Row
            ok={null}
            title={`مدیریت باتری ${brand.name}`}
            detail={brand.advice}
            action={
              brand.hasAutostartScreen && (
                <ActionButton
                  onClick={() =>
                    void run("autostart", async () => {
                      (await import("@/local/notificationStatus")).openAutostartSettings();
                    })
                  }
                  disabled={busy !== null}
                >
                  باز کردن
                </ActionButton>
              )
            }
          />
        )}

        <Row ok={null} title={`${toPersianDigits(status.scheduled)} اعلان در صف گوشی`} detail="یادآورهایی که گوشی برای زنگ خوردن نگه داشته است." />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run("test-now", () => sendTest(3))}
          disabled={busy !== null}
          className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          {busy === "test-now" ? "در حال ارسال..." : "اعلان آزمایشی همین حالا"}
        </button>
        <button
          type="button"
          onClick={() => void run("test-later", () => sendTest(60))}
          disabled={busy !== null}
          className="rounded-xl border border-line text-ink px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-40"
        >
          {busy === "test-later" ? "در حال زمان‌بندی..." : "آزمایش با برنامه‌ی بسته (۱ دقیقه بعد)"}
        </button>
      </div>

      {message && <p className="text-xs text-accent leading-relaxed">{message}</p>}
      {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
    </Card>
  );
}
