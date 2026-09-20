"use client";

import { useState } from "react";
import { mutate as mutateGlobal } from "swr";
import { Card } from "@/components/ui/Card";
import { validateExportFile, type DataExportFile } from "@/local/dataExport";
import { backupFileName, browserBackupApi, exportServerBackup, importBackupToServer, reportBackupToServer, restorableCounts, type WebImportResult } from "@/lib/webBackup";
import { TABLE_LABELS_FA } from "@/lib/backupLabels";
import { parseIcs, type ParsedIcsEvent } from "@/lib/icsParser";
import { formatJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { APP_NAME } from "@/lib/appVersion";

const CSV_EXPORTS: Array<{ entity: string; label: string }> = [
  { entity: "tasks", label: "کارها" },
  { entity: "activities", label: "فعالیت‌ها" },
  { entity: "transactions", label: "تراکنش‌ها" },
  { entity: "assets", label: "دارایی‌ها" },
];

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** After a restore, every screen that cached a list has to look again. */
function refreshEverything() {
  void mutateGlobal(() => true);
}

/**
 * Backup for the web app — the counterpart of the phone's backup tab, in the same file format:
 * a file downloaded here restores on the Android app and the other way round (see
 * src/lib/webBackup.ts). The account's data already lives on the server and syncs to the phone by
 * itself; a backup file is an independent copy kept on your own device.
 */
export default function WebBackupTab() {
  const api = browserBackupApi();

  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [pending, setPending] = useState<{ file: DataExportFile; counts: Array<{ table: string; count: number }> } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<WebImportResult | null>(null);

  const [icsPreview, setIcsPreview] = useState<ParsedIcsEvent[] | null>(null);
  const [icsError, setIcsError] = useState<string | null>(null);
  const [icsImporting, setIcsImporting] = useState(false);
  const [icsResult, setIcsResult] = useState<{ added: number; skipped: number } | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const file = await exportServerBackup(api);
      const name = backupFileName();
      downloadJson(name, file);
      void reportBackupToServer(api, { kind: "export", tables: file.tables });
      const total = restorableCounts(file.tables).reduce((sum, t) => sum + t.count, 0);
      setExportMessage(`فایل پشتیبان ساخته شد (${name}) — ${toPersianDigits(total)} مورد. آن را جای امنی نگه دارید؛ روی وب و اپلیکیشن اندروید قابل بازیابی است.`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "ساخت فایل پشتیبان با خطا مواجه شد.");
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!picked) return;
    setImportError(null);
    setResult(null);
    setPending(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await picked.text());
      } catch {
        setImportError("فایل انتخاب‌شده یک JSON معتبر نیست.");
        return;
      }
      const validated = validateExportFile(parsed);
      if (!validated.ok) {
        setImportError(validated.error);
        return;
      }
      const counts = restorableCounts(validated.file.tables);
      if (counts.length === 0) {
        setImportError("این فایل هیچ داده‌ای برای وارد کردن ندارد.");
        return;
      }
      setPending({ file: validated.file, counts });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "خواندن فایل با خطا مواجه شد.");
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setImporting(true);
    setImportError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const outcome = await importBackupToServer(api, pending.file, { onProgress: (done, total) => setProgress({ done, total }) });
      void reportBackupToServer(api, { kind: "import", result: outcome });
      setResult(outcome);
      setPending(null);
      refreshEverything();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "وارد کردن اطلاعات با خطا مواجه شد.");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function handleIcsSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setIcsError(null);
    setIcsResult(null);
    setIcsPreview(null);
    try {
      const events = parseIcs(await picked.text());
      if (events.length === 0) {
        setIcsError("هیچ رویدادی توی این فایل پیدا نشد — فایل .ics معتبری از گوگل‌کلندر انتخاب کنید.");
        return;
      }
      setIcsPreview(events);
    } catch (err) {
      setIcsError(err instanceof Error ? err.message : "خواندن فایل با خطا مواجه شد.");
    }
  }

  async function confirmIcsImport() {
    if (!icsPreview) return;
    setIcsImporting(true);
    setIcsError(null);
    try {
      // Same title + same start already exists → treat it as imported already, so re-importing the same file is safe.
      const existing: Array<{ title: string; startAt: string }> = (await api.get("/api/events"))?.events ?? [];
      const seen = new Set(existing.map((ev) => `${ev.title}|${new Date(ev.startAt).toISOString()}`));
      let added = 0;
      let skipped = 0;
      for (const ev of icsPreview) {
        if (seen.has(`${ev.title}|${ev.startAt.toISOString()}`)) {
          skipped++;
          continue;
        }
        await api.post("/api/events", {
          title: ev.title,
          description: ev.description ?? undefined,
          startAt: ev.startAt.toISOString(),
          endAt: ev.endAt.toISOString(),
          allDay: ev.allDay,
          recurrenceFreq: ev.recurrenceFreq !== "NONE" ? ev.recurrenceFreq : undefined,
          recurrenceInterval: ev.recurrenceFreq !== "NONE" ? ev.recurrenceInterval : undefined,
          recurrenceUntil: ev.recurrenceUntil ? ev.recurrenceUntil.toISOString() : undefined,
          recurrenceCount: ev.recurrenceCount ?? undefined,
        });
        added++;
      }
      setIcsResult({ added, skipped });
      setIcsPreview(null);
      refreshEverything();
    } catch (err) {
      setIcsError(err instanceof Error ? err.message : "وارد کردن رویدادها با خطا مواجه شد.");
    } finally {
      setIcsImporting(false);
    }
  }

  const storedTables = result ? Object.keys(result.stored) : [];

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-2">
        <h2 className="font-bold text-ink text-sm">اطلاعات شما کجا نگهداری می‌شود؟</h2>
        <p className="text-xs text-muted leading-relaxed">
          هر چیزی که اینجا ثبت می‌کنید روی سرور {APP_NAME} ذخیره می‌شود و با همین حساب، خودکار با اپلیکیشن اندروید همگام می‌شود. فایل پشتیبان یک نسخه‌ی
          جداگانه روی دستگاه خودتان است — برای اطمینان بیشتر، یا برای انتقال به یک حساب دیگر.
        </p>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">خروجی گرفتن از همه اطلاعات</h2>
        <p className="text-xs text-muted leading-relaxed">
          یک فایل شامل تمام اطلاعات حساب شما (کارها، فعالیت‌ها، تراکنش‌ها، عادت‌ها، رویدادها و ...) دانلود می‌شود. همین فایل را می‌توان در اپلیکیشن اندروید هم وارد کرد.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          {exporting ? "در حال ساخت فایل..." : "دانلود فایل پشتیبان"}
        </button>
        {exportMessage && <p className="text-xs text-accent">{exportMessage}</p>}
        {exportError && <p className="text-xs text-waste">{exportError}</p>}
        <div className="pt-2 border-t border-line">
          <p className="text-xs text-muted mb-2">خروجی جدول‌ها (CSV) برای اکسل:</p>
          <div className="flex flex-wrap gap-2">
            {CSV_EXPORTS.map((c) => (
              <a key={c.entity} href={`/api/export/${c.entity}`} download className="text-xs rounded-lg bg-canvas text-ink px-3 py-1.5 hover:bg-line">
                {c.label}
              </a>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">وارد کردن اطلاعات از فایل پشتیبان</h2>
        <p className="text-xs text-muted leading-relaxed">
          فایل پشتیبانی که از این برنامه یا از اپلیکیشن اندروید ساخته‌اید را انتخاب کنید. اطلاعات جدید اضافه می‌شود و اگر نسخه‌ی جدیدتری از یک مورد
          در فایل باشد جایگزین می‌شود؛ هیچ چیزی حذف نمی‌شود.
        </p>
        <label className="inline-block rounded-xl bg-canvas text-ink px-4 py-2 text-sm font-medium cursor-pointer hover:bg-line">
          انتخاب فایل پشتیبان
          <input type="file" accept="application/json,.json" onChange={handleFileSelected} className="hidden" />
        </label>
        {importError && <p className="text-xs text-waste">{importError}</p>}

        {pending && (
          <div className="rounded-xl bg-accent-soft border border-accent p-4 space-y-3">
            <p className="text-sm text-accent">این فایل شامل موارد زیر است — آنچه از قبل در حساب شما وجود داشته باشد تکراری اضافه نمی‌شود:</p>
            <ul className="text-xs text-ink space-y-1">
              {pending.counts.map(({ table, count }) => (
                <li key={table} className="flex items-center justify-between">
                  <span>{TABLE_LABELS_FA[table] ?? table}</span>
                  <span className="font-medium" dir="ltr">
                    {count.toLocaleString("fa-IR")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmImport}
                disabled={importing}
                className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {importing ? (progress && progress.total > 0 ? `در حال وارد کردن... ${toPersianDigits(progress.done)} از ${toPersianDigits(progress.total)}` : "در حال وارد کردن...") : "تأیید و وارد کردن"}
              </button>
              <button type="button" onClick={() => setPending(null)} disabled={importing} className="flex-1 rounded-xl bg-canvas text-ink py-2 text-sm">
                انصراف
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-xl bg-canvas border border-line p-4 space-y-2">
            <p className="text-sm text-ink font-medium">نتیجه وارد کردن اطلاعات:</p>
            {storedTables.length === 0 && result.rejected.length === 0 ? (
              <p className="text-xs text-muted">هیچ داده‌ی جدیدی برای اضافه کردن پیدا نشد — همه‌ی موارد این فایل از قبل در حساب شما بودند.</p>
            ) : (
              <ul className="text-xs text-ink space-y-1">
                {storedTables.map((table) => (
                  <li key={table}>
                    <span>{TABLE_LABELS_FA[table] ?? table}: </span>
                    <span className="text-accent">{result.stored[table].toLocaleString("fa-IR")} مورد اضافه یا به‌روز شد</span>
                  </li>
                ))}
              </ul>
            )}
            {result.unchanged > 0 && <p className="text-xs text-muted">{result.unchanged.toLocaleString("fa-IR")} مورد از قبل (با همین نسخه یا جدیدتر) در حساب بود.</p>}
            {result.rejected.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-waste">{result.rejected.length.toLocaleString("fa-IR")} مورد پذیرفته نشد:</p>
                <ul className="text-[11px] text-waste space-y-0.5 max-h-32 overflow-y-auto">
                  {result.rejected.slice(0, 8).map((r, i) => (
                    <li key={i}>
                      {TABLE_LABELS_FA[r.table] ?? r.table}: {r.reason}
                    </li>
                  ))}
                  {result.rejected.length > 8 && <li>و {toPersianDigits(result.rejected.length - 8)} مورد دیگر...</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">وارد کردن رویدادها از گوگل‌کلندر</h2>
        <p className="text-xs text-muted leading-relaxed">
          از گوگل‌کلندر (تنظیمات ← Import &amp; export ← Export) یک فایل با پسوند .ics بگیرید و اینجا انتخاب کنید. رویدادهای تکرارشونده ساده (روزانه،
          هفتگی، ماهانه، سالانه) هم پشتیبانی می‌شوند. این کار فقط رویداد اضافه می‌کند — چیزی را جایگزین یا حذف نمی‌کند.
        </p>
        <label className="inline-block rounded-xl bg-canvas text-ink px-4 py-2 text-sm font-medium cursor-pointer hover:bg-line">
          انتخاب فایل .ics
          <input type="file" accept=".ics,text/calendar" onChange={handleIcsSelected} className="hidden" />
        </label>
        {icsError && <p className="text-xs text-waste">{icsError}</p>}

        {icsPreview && (
          <div className="rounded-xl bg-accent-soft border border-accent p-4 space-y-3">
            <p className="text-sm text-accent">
              {toPersianDigits(icsPreview.length)} رویداد توی این فایل پیدا شد. مواردی که از قبل با همین عنوان و زمان در حساب شما وجود داشته باشند نادیده گرفته می‌شوند.
            </p>
            <ul className="text-xs text-ink space-y-1 max-h-40 overflow-y-auto">
              {icsPreview.slice(0, 8).map((ev, i) => (
                <li key={i} className="truncate">
                  {ev.title} — {formatJalali(ev.startAt)}
                </li>
              ))}
              {icsPreview.length > 8 && <li className="text-muted">و {toPersianDigits(icsPreview.length - 8)} مورد دیگر...</li>}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmIcsImport}
                disabled={icsImporting}
                className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {icsImporting ? "در حال وارد کردن..." : "تأیید و وارد کردن"}
              </button>
              <button type="button" onClick={() => setIcsPreview(null)} disabled={icsImporting} className="flex-1 rounded-xl bg-canvas text-ink py-2 text-sm">
                انصراف
              </button>
            </div>
          </div>
        )}

        {icsResult && (
          <p className="text-xs text-ink">
            {icsResult.added.toLocaleString("fa-IR")} رویداد اضافه شد
            {icsResult.skipped > 0 && ` و ${icsResult.skipped.toLocaleString("fa-IR")} رویداد از قبل وجود داشت`}.
          </p>
        )}
      </Card>
    </div>
  );
}
