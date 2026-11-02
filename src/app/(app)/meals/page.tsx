"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import Sheet from "@/components/ui/Sheet";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { dayKeyIso, parseDayKey } from "@/lib/calendarGrid";
import { formatJalali, toJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { parseAmount } from "@/lib/habitMetrics";
import { notifySaved } from "@/lib/savedToast";
import { useModes } from "@/lib/useModes";
import { useMeals } from "@/lib/useMeals";
import {
  MEAL_KINDS,
  MEAL_KIND_LABELS,
  addMeal,
  burnedFromHabits,
  dayTotal,
  lastDays,
  mealsOfDay,
  meterOf,
  meterSentence,
  removeMeal,
  setTarget,
  suggestions,
  updateMeal,
  validateMeal,
  validateTarget,
  type MealEntry,
  type MealKind,
} from "@/lib/meals";

const number = (n: number) => Math.round(n).toLocaleString("fa-IR");

/**
 * «کالری‌شمار» (athlete mode): the day's meals, the total against the daily target the person chose, and the week. It
 * says how much is left or over and nothing more. Everything here is kept on this device only.
 */
export default function MealsPage() {
  const modes = useModes();
  const { data, save } = useMeals();
  const [day, setDay] = useState(() => dayKeyIso(new Date()));
  const [editing, setEditing] = useState<MealEntry | "new" | null>(null);
  const [settingTarget, setSettingTarget] = useState(false);

  const date = parseDayKey(day) ?? new Date();
  const today = dayKeyIso(new Date());
  const range = useMemo(() => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return `from=${start.toISOString()}&to=${new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999).toISOString()}`;
    // The day's key is what changes; the date is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);
  const athlete = modes.modes.includes("athlete");
  const { data: activity } = useSWR<{ items: any[] }>(athlete ? `/api/day-activity?${range}` : null, fetcher);

  if (modes.loaded && !athlete) {
    return (
      <div className="px-4 py-6 space-y-3">
        <h1 className="text-lg font-bold text-ink">کالری‌شمار</h1>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-ink">حالت ورزشکار خاموش است.</p>
          <p className="text-xs text-muted leading-relaxed">برای دیدن کالری‌شمار، از تنظیمات ← «حالت‌ها» حالت «ورزشکار» را روشن کن.</p>
          <Link href="/settings" className="inline-block text-sm text-accent">
            رفتن به تنظیمات
          </Link>
        </Card>
      </div>
    );
  }

  const meals = mealsOfDay(data, day);
  const meter = meterOf(dayTotal(data, day), data.target);
  const burned = burnedFromHabits(activity?.items);
  const week = lastDays(data, day, 7);

  function shiftDay(delta: number) {
    setDay(dayKeyIso(new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)));
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">کالری‌شمار</h1>
        <p className="text-xs text-muted mt-1 leading-relaxed">وعده‌ها و هدف روزانه فقط روی همین دستگاه ذخیره می‌شوند؛ به سرور نمی‌روند و در فایل پشتیبان نیستند.</p>
      </div>

      <div className="flex items-center justify-center gap-1">
        <button type="button" onClick={() => shiftDay(-1)} aria-label="روز قبل" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <span className="text-sm text-ink min-w-[10rem] text-center">{formatJalali(date, { withWeekday: true, long: true })}</span>
        <button type="button" onClick={() => shiftDay(1)} aria-label="روز بعد" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {day !== today && (
          <button type="button" onClick={() => setDay(today)} className="mr-2 text-xs text-accent border border-line rounded-full px-2.5 py-1 hover:border-accent">
            امروز
          </button>
        )}
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex items-end justify-between gap-2">
          <p className="text-3xl font-bold text-ink" data-testid="meter-total">
            {number(meter.total)}
            <span className="text-sm font-normal text-muted mr-1.5">کیلوکالری</span>
          </p>
          {meter.target !== null && <p className="text-xs text-muted">از {number(meter.target)}</p>}
        </div>
        <div className="h-2.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(meter.fill * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="کالری امروز نسبت به هدف">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(meter.fill * 100)}%`, backgroundColor: meter.state === "OVER" ? "rgb(var(--muted))" : "rgb(var(--accent))" }} />
        </div>
        <p className="text-sm text-ink" data-testid="meter-sentence">
          {meterSentence(meter, (n) => number(n))}
        </p>
        {burned > 0 && <p className="text-xs text-muted">سوزانده‌شده با عادت‌ها: {number(burned)} کیلوکالری (فقط برای اطلاع؛ از کالری امروز کم نمی‌شود).</p>}
        <button type="button" onClick={() => setSettingTarget(true)} className="text-xs text-accent">
          {data.target === null ? "هدف روزانه بگذار" : "تغییر هدف روزانه"}
        </button>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-xs text-muted">{meals.length > 0 ? `${toPersianDigits(meals.length)} وعده` : "وعده‌ای نوشته نشده"}</p>
          <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-1.5 rounded-xl hover:opacity-90">
            <PlusIcon className="w-4 h-4" />
            افزودن وعده
          </button>
        </div>
        {meals.length > 0 && (
          <ul className="divide-y divide-line mt-2">
            {meals.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setEditing(m)} className="w-full text-right flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{m.title}</span>
                    <span className="block text-[11px] text-muted">{MEAL_KIND_LABELS[m.kind]}</span>
                  </span>
                  <span className="text-sm text-ink shrink-0">{number(m.kcal)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-xs text-muted mb-2">۷ روز تا همین روز{data.target !== null ? " (خط، هدف روزانه)" : ""}</p>
        <WeekBars bars={week} target={data.target} />
      </Card>

      {editing && (
        <MealSheet
          meal={editing === "new" ? null : editing}
          day={day}
          onClose={() => setEditing(null)}
          onSave={(entry) => {
            save(editing === "new" ? addMeal(data, entry) : updateMeal(data, entry.id, { kind: entry.kind, title: entry.title, kcal: entry.kcal }));
            setEditing(null);
            notifySaved();
          }}
          onDelete={
            editing === "new"
              ? undefined
              : () => {
                  save(removeMeal(data, editing.id));
                  setEditing(null);
                  notifySaved("حذف شد");
                }
          }
          suggestionList={suggestions(data)}
        />
      )}

      {settingTarget && (
        <TargetSheet
          target={data.target}
          onClose={() => setSettingTarget(false)}
          onSave={(target) => {
            save(setTarget(data, target));
            setSettingTarget(false);
            notifySaved();
          }}
        />
      )}
    </div>
  );
}

function WeekBars({ bars, target }: { bars: ReturnType<typeof lastDays>; target: number | null }) {
  const width = 280;
  const height = 90;
  const base = 76;
  const step = width / bars.length;
  const tallest = Math.max(target ?? 0, ...bars.map((b) => b.total), 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="کالری هفت روز اخیر" style={{ direction: "ltr" }}>
      <line x1={0} y1={base} x2={width} y2={base} style={{ stroke: "rgb(var(--line))" }} strokeWidth={1} />
      {target !== null && <line x1={0} y1={base - (target / tallest) * (base - 8)} x2={width} y2={base - (target / tallest) * (base - 8)} strokeDasharray="4 3" style={{ stroke: "rgb(var(--muted))" }} strokeWidth={1} />}
      {bars.map((bar, i) => {
        const h = bar.height * (base - 8);
        const selectedDay = i === bars.length - 1;
        return (
          <g key={bar.day}>
            {bar.total > 0 && (
              <rect x={i * step + step * 0.22} y={base - h} width={step * 0.56} height={h} rx={3} style={{ fill: "rgb(var(--accent))", opacity: selectedDay ? 1 : 0.55 }}>
                <title>{`${formatJalali(parseDayKey(bar.day) ?? new Date(), { long: true })}: ${number(bar.total)}`}</title>
              </rect>
            )}
            <text x={i * step + step / 2} y={base + 13} fontSize={9} textAnchor="middle" style={{ fill: "rgb(var(--muted))" }}>
              {toPersianDigits(toJalali(parseDayKey(bar.day) ?? new Date()).jd)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MealSheet({
  meal,
  day,
  onClose,
  onSave,
  onDelete,
  suggestionList,
}: {
  meal: MealEntry | null;
  day: string;
  onClose: () => void;
  onSave: (entry: MealEntry) => void;
  onDelete?: () => void;
  suggestionList: ReturnType<typeof suggestions>;
}) {
  const [kind, setKind] = useState<MealKind>(meal?.kind ?? defaultKind());
  const [title, setTitle] = useState(meal?.title ?? "");
  const [kcal, setKcal] = useState(meal ? String(meal.kcal) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(kcal);
    const calories = amount === null ? NaN : Math.round(amount);
    const problem = validateMeal({ title, kcal: calories, kind });
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ id: meal?.id ?? crypto.randomUUID(), day: meal?.day ?? day, kind, title: title.trim(), kcal: calories });
  }

  return (
    <Sheet title={meal ? "ویرایش وعده" : "افزودن وعده"} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="وعده">
          {MEAL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`text-sm px-3 py-1.5 rounded-full border transition ${kind === k ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"}`}
            >
              {MEAL_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="چی خوردی؟ (مثلاً املت)"
          aria-label="اسم غذا"
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
        />
        <div className="flex items-center gap-2">
          <input
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            placeholder="کالری"
            aria-label="کالری"
            className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm text-right"
          />
          <span className="text-xs text-muted shrink-0">کیلوکالری</span>
        </div>

        {!meal && suggestionList.length > 0 && (
          <div>
            <p className="text-xs text-muted mb-1.5">قبلاً نوشته‌ای</p>
            <div className="flex flex-wrap gap-2">
              {suggestionList.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => {
                    setTitle(s.title);
                    setKcal(String(s.kcal));
                    setKind(s.kind);
                    setError(null);
                  }}
                  className="text-xs px-2.5 py-1 rounded-full border border-line text-ink hover:border-accent"
                >
                  {s.title} · {number(s.kcal)}
                </button>
              ))}
            </div>
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

function TargetSheet({ target, onClose, onSave }: { target: number | null; onClose: () => void; onSave: (target: number | null) => void }) {
  const [text, setText] = useState(target === null ? "" : String(target));
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim() === "") {
      onSave(null);
      return;
    }
    const amount = parseAmount(text);
    const value = amount === null ? NaN : Math.round(amount);
    const problem = validateTarget(value);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(value);
  }

  return (
    <Sheet title="هدف روزانه" onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3">
        <p className="text-xs text-muted leading-relaxed">چند کیلوکالری در روز برایت مناسب است؟ این عدد را خودت می‌گذاری؛ برنامه توصیه‌ای نمی‌کند. خالی بگذاری، هدف برداشته می‌شود.</p>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            placeholder="مثلاً ۲۲۰۰"
            aria-label="هدف روزانه"
            className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm text-right"
          />
          <span className="text-xs text-muted shrink-0">کیلوکالری</span>
        </div>
        {error && <p className="text-xs text-waste">{error}</p>}
        <button type="submit" className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90">
          ذخیره
        </button>
      </form>
    </Sheet>
  );
}

/** The meal that fits the hour: a new meal starts on the kind of the time of day it is written. */
function defaultKind(): MealKind {
  const hour = new Date().getHours();
  if (hour < 10) return "BREAKFAST";
  if (hour < 15) return "LUNCH";
  if (hour < 21) return "DINNER";
  return "SNACK";
}
