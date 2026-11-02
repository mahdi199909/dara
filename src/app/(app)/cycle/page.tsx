"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import Sheet from "@/components/ui/Sheet";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { addJalaliMonths, dayKeyIso, getJalaliMonthGrid, parseDayKey } from "@/lib/calendarGrid";
import { formatJalali, formatJalaliMonthYear, toJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { notifySaved } from "@/lib/savedToast";
import { cycleAvailable } from "@/lib/modes";
import { useModes } from "@/lib/useModes";
import { clearCycleData, useCycle } from "@/lib/useCycle";
import { PHASE_LABELS, addDays, addPeriod, cycleStatus, daysBetween, monthMarks, removePeriod, updatePeriod, validatePeriod, type CycleData, type Period } from "@/lib/cycle";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const shortDate = (key: string) => formatJalali(parseDayKey(key) ?? new Date(), { long: true });

/**
 * «چرخهٔ ماهانه»: the periods the person writes down, the next one expected from their own dates, and a calendar. It
 * is offered only to an account whose gender is «زن», once the section is switched on in Settings, and everything in it
 * stays on this device. The expectation is an estimate and says so.
 */
export default function CyclePage() {
  const modes = useModes();
  const { data, save } = useCycle();
  const [cursor, setCursor] = useState(() => new Date());
  const [editing, setEditing] = useState<Period | "new" | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const todayKey = dayKeyIso(new Date());
  const status = useMemo(() => cycleStatus(data, todayKey), [data, todayKey]);
  const { jy, jm } = toJalali(cursor);
  const grid = useMemo(() => getJalaliMonthGrid(jy, jm), [jy, jm]);
  const marks = useMemo(
    () =>
      monthMarks(
        data,
        status,
        grid.map((d) => dayKeyIso(d)),
        todayKey
      ),
    [data, status, grid, todayKey]
  );

  if (modes.loaded && !cycleAvailable(modes)) {
    return (
      <div className="px-4 py-6 space-y-3">
        <h1 className="text-lg font-bold text-ink">چرخهٔ ماهانه</h1>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-ink">{modes.gender === "FEMALE" ? "این بخش خاموش است." : "این بخش برای حساب‌هایی است که در تنظیمات جنسیت «زن» انتخاب شده."}</p>
          <p className="text-xs text-muted leading-relaxed">
            {modes.gender === "FEMALE" ? "از تنظیمات ← «حالت‌ها» «چرخهٔ ماهانه» را روشن کن؛ دادهٔ آن فقط روی همین دستگاه می‌ماند." : "اگر می‌خواهی، از تنظیمات ← «حالت‌ها» جنسیتت را انتخاب کن؛ گفتنش اختیاری است."}
          </p>
          <Link href="/settings" className="inline-block text-sm text-accent">
            رفتن به تنظیمات
          </Link>
        </Card>
      </div>
    );
  }

  function commit(next: CycleData, message?: string) {
    save(next);
    notifySaved(message);
  }

  function startToday() {
    const candidate = { start: todayKey, end: null };
    const problem = validatePeriod(data, candidate, todayKey);
    if (problem) {
      setActionError(problem);
      return;
    }
    setActionError(null);
    commit(addPeriod(data, { id: crypto.randomUUID(), ...candidate }));
  }

  function endToday() {
    if (!status.openPeriod) return;
    const problem = validatePeriod(data, { id: status.openPeriod.id, start: status.openPeriod.start, end: todayKey }, todayKey);
    if (problem) {
      setActionError(problem);
      return;
    }
    setActionError(null);
    commit(updatePeriod(data, status.openPeriod.id, { end: todayKey }));
  }

  function moveMonth(delta: number) {
    const next = addJalaliMonths(jy, jm, delta);
    setCursor(getJalaliMonthGrid(next.jy, next.jm)[8]);
  }

  const nextRange =
    status.nextStart && status.phase !== "PERIOD"
      ? `${shortDate(status.nextStart)} (بین ${shortDate(addDays(status.nextStart, -status.spread))} تا ${shortDate(addDays(status.nextStart, status.spread))})`
      : null;
  const history = [...data.periods].reverse();

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">چرخهٔ ماهانه</h1>
        <p className="text-xs text-muted mt-1 leading-relaxed">فقط روی همین دستگاه ذخیره می‌شود: به سرور نمی‌رود، با حساب همگام نمی‌شود و در فایل پشتیبان نیست.</p>
      </div>

      <Card className="p-5 space-y-3">
        {status.phase === null ? (
          <>
            <p className="text-sm text-ink">هنوز قاعدگی‌ای ننوشته‌ای.</p>
            <p className="text-xs text-muted leading-relaxed">با نوشتن روز شروعِ قاعدگی، برنامه از تاریخ‌های خودت طول چرخه را حساب می‌کند و زمان احتمالی بعدی را می‌گوید. اگر قبلاً شروع شده، «ثبت قاعدگی قبلی» را بزن.</p>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold text-ink" data-testid="cycle-headline">
              {status.inPeriod ? `روز ${toPersianDigits(status.periodDay!)} قاعدگی` : status.cycleDay ? `روز ${toPersianDigits(status.cycleDay)} چرخه` : "چرخه"}
            </p>
            <p className="text-sm text-muted">{PHASE_LABELS[status.phase]}</p>
            {nextRange && (
              <p className="text-sm text-ink">
                قاعدگی بعدی: {nextRange}
                {status.daysToNext !== null && status.daysToNext >= 0 ? ` · ${status.daysToNext === 0 ? "امروز" : `${toPersianDigits(status.daysToNext)} روز دیگر`}` : ""}
              </p>
            )}
            <p className="text-xs text-muted">
              میانگین چرخه {toPersianDigits(status.averageCycle.days)} روز{status.averageCycle.learned ? "" : " (فرض اولیه)"} · میانگین قاعدگی {toPersianDigits(status.averagePeriod.days)} روز
              {status.averagePeriod.learned ? "" : " (فرض اولیه)"}
            </p>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {status.openPeriod ? (
            <button type="button" onClick={endToday} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90">
              امروز تمام شد
            </button>
          ) : (
            <button type="button" onClick={startToday} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90">
              امروز شروع شد
            </button>
          )}
          <button type="button" onClick={() => setEditing("new")} className="rounded-xl border border-line px-4 py-2 text-sm text-ink hover:border-accent">
            ثبت قاعدگی قبلی
          </button>
        </div>
        {actionError && <p className="text-xs text-waste">{actionError}</p>}
        <p className="text-[11px] text-muted leading-relaxed">این‌ها تخمینی از تاریخ‌هایی است که خودت نوشته‌ای؛ جای توصیهٔ پزشکی نیست و برای پیشگیری یا برنامه‌ریزی بارداری به کار نمی‌رود.</p>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-center gap-1 mb-2">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="ماه قبل" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <span className="text-sm text-ink min-w-[7rem] text-center">{formatJalaliMonthYear(cursor)}</span>
          <button type="button" onClick={() => moveMonth(1)} aria-label="ماه بعد" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-muted mb-2">
          {WEEKDAY_HEADERS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const { jm: dayJm, jd } = toJalali(day);
            const inMonth = dayJm === jm;
            const key = dayKeyIso(day);
            const mark = inMonth ? marks[key] : undefined;
            return (
              <div
                key={day.toISOString()}
                data-mark={mark ?? ""}
                className={`aspect-square sm:aspect-auto sm:h-12 rounded-xl border flex items-center justify-center text-xs ${
                  !inMonth ? "bg-canvas border-transparent text-muted" : mark === "PERIOD" ? "border-accent-soft text-accent font-bold" : mark === "EXPECTED" ? "border-dashed border-accent text-ink" : "bg-surface border-line text-ink"
                } ${key === todayKey && inMonth ? "ring-1 ring-ink" : ""}`}
                style={mark === "PERIOD" ? { backgroundColor: "rgb(var(--accent) / 0.25)" } : undefined}
              >
                {toPersianDigits(jd)}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: "rgb(var(--accent) / 0.25)" }} /> روزهای قاعدگی
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded border border-dashed border-accent" /> بازهٔ احتمالی قاعدگی بعدی
          </span>
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-xs text-muted">{history.length > 0 ? `${toPersianDigits(history.length)} قاعدگی ثبت‌شده` : "تاریخچه خالی است"}</p>
          <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1 text-xs text-accent">
            <PlusIcon className="w-3.5 h-3.5" />
            افزودن
          </button>
        </div>
        {history.length > 0 && (
          <ul className="divide-y divide-line mt-2">
            {history.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setEditing(p)} className="w-full text-right flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-ink">
                    {shortDate(p.start)}
                    {p.end ? ` تا ${shortDate(p.end)}` : " تا امروز"}
                  </span>
                  <span className="text-xs text-muted shrink-0">{p.end ? `${toPersianDigits(daysBetween(p.start, p.end) + 1)} روز` : "ادامه دارد"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.periods.length > 0 && (
        <div className="text-center">
          {confirmingClear ? (
            <span className="text-xs text-muted">
              همهٔ تاریخچهٔ این بخش از این دستگاه پاک شود؟{" "}
              <button
                type="button"
                className="text-waste mx-1"
                onClick={() => {
                  clearCycleData();
                  setConfirmingClear(false);
                  notifySaved("پاک شد");
                }}
              >
                بله، پاک کن
              </button>
              <button type="button" className="text-accent" onClick={() => setConfirmingClear(false)}>
                نه
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingClear(true)} className="text-xs text-muted hover:text-waste">
              پاک‌کردن همهٔ دادهٔ این بخش
            </button>
          )}
        </div>
      )}

      {editing && (
        <PeriodSheet
          period={editing === "new" ? null : editing}
          todayKey={todayKey}
          validate={(candidate) => validatePeriod(data, candidate, todayKey)}
          onClose={() => setEditing(null)}
          onSave={(candidate) => {
            commit(editing === "new" ? addPeriod(data, { id: crypto.randomUUID(), ...candidate }) : updatePeriod(data, editing.id, candidate));
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : () => {
                  commit(removePeriod(data, editing.id), "حذف شد");
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

function PeriodSheet({
  period,
  todayKey,
  validate,
  onClose,
  onSave,
  onDelete,
}: {
  period: Period | null;
  todayKey: string;
  validate: (candidate: { id?: string; start: string; end: string | null }) => string | null;
  onClose: () => void;
  onSave: (candidate: { start: string; end: string | null }) => void;
  onDelete?: () => void;
}) {
  const [start, setStart] = useState<Date>(() => parseDayKey(period?.start ?? todayKey) ?? new Date());
  const [ongoing, setOngoing] = useState(period ? period.end === null : false);
  const [end, setEnd] = useState<Date>(() => parseDayKey(period?.end ?? todayKey) ?? new Date());
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const candidate = { start: dayKeyIso(start), end: ongoing ? null : dayKeyIso(end) };
    const problem = validate({ id: period?.id, ...candidate });
    if (problem) {
      setError(problem);
      return;
    }
    onSave(candidate);
  }

  return (
    <Sheet title={period ? "ویرایش قاعدگی" : "ثبت قاعدگی"} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3">
        <div>
          <label className="text-xs text-muted mb-1.5 block">روز شروع</label>
          <JalaliDateInput
            value={start}
            onChange={(d) => {
              setStart(d);
              setError(null);
            }}
          />
        </div>
        <label className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2.5">
          <span className="text-sm text-ink">هنوز ادامه دارد</span>
          <input
            type="checkbox"
            checked={ongoing}
            onChange={(e) => {
              setOngoing(e.target.checked);
              setError(null);
            }}
            className="w-4 h-4 accent-accent"
          />
        </label>
        {!ongoing && (
          <div>
            <label className="text-xs text-muted mb-1.5 block">روز پایان</label>
            <JalaliDateInput
              value={end}
              onChange={(d) => {
                setEnd(d);
                setError(null);
              }}
            />
          </div>
        )}
        {error && <p className="text-xs text-waste">{error}</p>}
        <div className="flex gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} className="px-4 rounded-xl border border-line text-muted text-sm hover:text-waste">
              حذف
            </button>
          )}
          <button type="submit" className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90">
            ذخیره
          </button>
        </div>
      </form>
    </Sheet>
  );
}
