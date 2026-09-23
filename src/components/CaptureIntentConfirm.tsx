"use client";

import { useEffect, useMemo, useState } from "react";
import { fetcher, apiPost } from "@/lib/apiClient";
import { runSteps } from "@/lib/captureSteps";
import { loadSnapshot, resolveCapture, snapshotNeeds, type CaptureSnapshot } from "@/lib/captureResolve";
import type { CaptureIntent } from "@/lib/captureIntent";
import { refreshCaptureCaches } from "@/lib/refreshCaches";
import { notifySaved } from "@/lib/savedToast";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { XIcon } from "./icons";

const DONE_MESSAGE: Partial<Record<CaptureIntent["kind"], string>> = {
  REMINDER: "یادآوری ساخته شد",
  INSTALLMENT_PLAN: "طرح قسط ساخته شد",
  INSTALLMENT_PAY: "قسط پرداخت شد",
  HABIT_CHECKIN: "عادت امروز ثبت شد",
  HABIT_CREATE: "عادت ساخته شد",
  NOTE: "یادداشت ذخیره شد",
  SAVINGS_GOAL: "هدف ساخته شد",
  PROJECT_CREATE: "پروژه ساخته شد",
  BUDGET: "بودجه ثبت شد",
};

/**
 * The "این ثبت بشه؟" card for a line that is not a plain entry — an installment plan, a payment, a
 * habit, a note, a goal ... (src/lib/captureIntent.ts). It shows what the words were taken to mean,
 * having found what they point at among the person's own data, and only تأیید writes anything. A wrong
 * guess costs one tap: «فقط یک کار ساده» reads the same line as an ordinary entry instead.
 */
export default function CaptureIntentConfirm({
  intent,
  onDone,
  onAsEntry,
  onCancel,
}: {
  intent: CaptureIntent;
  onDone: () => void;
  onAsEntry: () => void;
  onCancel: () => void;
}) {
  const { format } = useCurrencyUnit();
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    let cancelled = false;
    loadSnapshot(snapshotNeeds(intent), (url) => fetcher(url)).then(
      (loaded) => !cancelled && setSnapshot(loaded),
      () => !cancelled && setError("خواندن اطلاعات انجام نشد. دوباره تلاش کن.")
    );
    return () => {
      cancelled = true;
    };
  }, [intent]);

  const resolution = useMemo(() => (snapshot ? resolveCapture(intent, snapshot, now) : null), [intent, snapshot, now]);

  async function handleConfirm() {
    if (!resolution) return;
    setSaving(true);
    setError(null);
    try {
      await runSteps(resolution.steps, (call) => (call.method === "GET" ? fetcher(call.url) : apiPost(call.url, call.body)));
      refreshCaptureCaches();
      notifySaved(DONE_MESSAGE[intent.kind]);
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "ثبت انجام نشد. دوباره تلاش کن.");
    } finally {
      setSaving(false);
    }
  }

  const blocked = !resolution || Boolean(resolution.problem) || Boolean(resolution.alreadyDone);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onCancel}>
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-ink">این ثبت بشه؟</h2>
          <button onClick={onCancel} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 pt-2 space-y-3">
          {!resolution && !error && <p className="text-sm text-muted">در حال بررسی...</p>}

          {resolution && (
            <>
              <p className="text-base font-bold text-ink">{resolution.title}</p>
              {resolution.details.length > 0 && (
                <dl className="space-y-1.5 text-sm">
                  {resolution.details.map((detail) => (
                    <div key={detail.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted shrink-0">{detail.label}</dt>
                      <dd className="text-ink font-medium text-left min-w-0 break-words">
                        {detail.money !== undefined ? format(detail.money, { withSuffix: true }) : detail.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {resolution.problem && <p className="text-sm text-waste">{resolution.problem}</p>}
              {resolution.alreadyDone && <p className="text-sm text-muted">{resolution.alreadyDone}</p>}
            </>
          )}

          {error && <p className="text-sm text-waste">{error}</p>}
        </div>

        <div className="p-5 pt-0 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAsEntry}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-canvas text-ink text-sm font-medium disabled:opacity-40"
            >
              فقط یک کار ساده
            </button>
            {resolution?.alreadyDone ? (
              <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-xl bg-accent text-on-accent text-sm font-medium">
                باشه
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={saving || blocked}
                className="flex-1 py-3 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-40"
              >
                {saving ? "در حال ثبت..." : "تأیید"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
