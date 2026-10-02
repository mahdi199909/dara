"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { formatTime, weekdayNameFa } from "@/lib/jalali";
import { summarizeTimerSessions, type TimerSessionRow } from "@/lib/timerStats";
import { useCategories } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import CategoryChipPicker, { selectableCategories } from "@/components/CategoryChipPicker";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { dayKeyIso } from "@/lib/calendarGrid";
import { formatDuration, toPersianDigits } from "@/lib/money";
import {
  COUNTDOWN_PRESETS_MIN,
  POMODORO_PRESETS,
  elapsedMs,
  formatClock,
  isLongBreak,
  remainingMs,
  type PomodoroSettings,
  type TimerMode,
  type TimerState,
} from "@/lib/focusTimer";
import { DEFAULT_SESSION_TITLE, TIMER_HISTORY_KEY, focusTimer, readPrefs, useFocusTimer, useNow } from "@/lib/focusTimerStore";

const MODES: { value: TimerMode; label: string }[] = [
  { value: "POMODORO", label: "پومودورو" },
  { value: "COUNTDOWN", label: "تایمر" },
  { value: "STOPWATCH", label: "کرنومتر" },
];

const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";

export default function TimerPage() {
  const timer = useFocusTimer();
  // The setup reads this device's last choices from localStorage — only once mounted, so the first
  // render matches the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">زمان‌سنج</h1>
        <p className="text-xs text-muted mt-1">هر بار که کار تمام شود، با عنوان و دسته‌اش در کارهای انجام‌شدهٔ همان روز ثبت می‌شود.</p>
      </div>

      <Notices />

      {timer.state ? <RunningTimer state={timer.state} /> : mounted ? <TimerSetup /> : null}

      <TimerHistory />
    </div>
  );
}

function Notices() {
  const { lastSaved, message, saveError, pending } = useFocusTimer();
  if (!lastSaved && !message && !saveError && pending.length === 0) return null;
  return (
    <div className="space-y-2">
      {lastSaved && (
        <Card className="p-3 flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">✓</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink truncate">«{lastSaved.title}» ثبت شد</p>
            <p className="text-xs text-muted">{formatDuration(Math.round(lastSaved.durationMs / 60_000))} در کارهای انجام‌شدهٔ روز</p>
          </div>
          <Link href={`/calendar?day=${dayKeyIso(new Date(lastSaved.endAt))}`} className="text-xs text-accent shrink-0">
            دیدن روز
          </Link>
          <button type="button" onClick={() => focusTimer.dismissNotice()} className="text-muted text-sm px-1" aria-label="بستن">
            ×
          </button>
        </Card>
      )}
      {message && !lastSaved && <p className="text-sm text-ink bg-accent-soft rounded-xl px-3 py-2">{message}</p>}
      {(saveError || pending.length > 0) && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-signal-300 bg-signal-50 px-3 py-2">
          <p className="text-xs text-signal-700">
            {toPersianDigits(String(pending.length))} بلوک هنوز ثبت نشده{saveError ? ` — ${saveError}` : "…"}
          </p>
          <button type="button" onClick={() => focusTimer.retrySaving()} className="text-xs text-signal-700 font-medium shrink-0">
            تلاش دوباره
          </button>
        </div>
      )}
    </div>
  );
}

function TimerSetup() {
  const prefs = readPrefs();
  const { categories } = useCategories();
  const [mode, setMode] = useState<TimerMode>(prefs.mode);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [countdownMin, setCountdownMin] = useState(String(prefs.countdownMin));
  const [pomodoro, setPomodoro] = useState<PomodoroSettings>(prefs.pomodoro);
  const presetIndex = POMODORO_PRESETS.findIndex((p) => p.settings.workMin === pomodoro.workMin && p.settings.breakMin === pomodoro.breakMin);
  const [customPomodoro, setCustomPomodoro] = useState(presetIndex < 0);

  const minutes = Number(countdownMin);
  const valid =
    mode === "COUNTDOWN" ? Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60 : mode === "POMODORO" ? pomodoro.workMin >= 1 && pomodoro.breakMin >= 1 && pomodoro.longBreakMin >= 1 : true;

  function start() {
    if (!valid) return;
    focusTimer.start({ mode, title, categoryId, countdownMin: mode === "COUNTDOWN" ? minutes : undefined, pomodoro: mode === "POMODORO" ? pomodoro : undefined });
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={`rounded-lg py-2 text-sm transition ${mode === m.value ? "bg-surface text-ink font-medium shadow-card" : "text-muted"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "POMODORO" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">تمرکز / استراحت (دقیقه) — بعد از هر چهار بلوک، استراحت بلند</p>
          <div className="flex flex-wrap gap-2">
            {POMODORO_PRESETS.map((p) => {
              const active = !customPomodoro && p.settings.workMin === pomodoro.workMin && p.settings.breakMin === pomodoro.breakMin;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setPomodoro(p.settings);
                    setCustomPomodoro(false);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-sm ${active ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}
                >
                  {p.label}
                </button>
              );
            })}
            <button type="button" onClick={() => setCustomPomodoro(true)} className={`px-3.5 py-1.5 rounded-full text-sm ${customPomodoro ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}>
              دلخواه
            </button>
          </div>
          {customPomodoro && (
            <div className="grid grid-cols-3 gap-2">
              <MinutesField label="تمرکز" value={pomodoro.workMin} onChange={(v) => setPomodoro({ ...pomodoro, workMin: v })} />
              <MinutesField label="استراحت" value={pomodoro.breakMin} onChange={(v) => setPomodoro({ ...pomodoro, breakMin: v })} />
              <MinutesField label="استراحت بلند" value={pomodoro.longBreakMin} onChange={(v) => setPomodoro({ ...pomodoro, longBreakMin: v })} />
            </div>
          )}
        </div>
      )}

      {mode === "COUNTDOWN" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">چند دقیقه؟</p>
          <div className="flex flex-wrap gap-2">
            {COUNTDOWN_PRESETS_MIN.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCountdownMin(String(m))}
                className={`px-3 py-1.5 rounded-full text-sm ${Number(countdownMin) === m ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}
              >
                {toPersianDigits(String(m))}
              </button>
            ))}
          </div>
          <input type="number" inputMode="numeric" min={1} value={countdownMin} onChange={(e) => setCountdownMin(e.target.value)} className={inputClass} placeholder="زمان دلخواه به دقیقه" />
        </div>
      )}

      {mode === "STOPWATCH" && <p className="text-xs text-muted">از صفر می‌شمارد تا وقتی «پایان» را بزنی.</p>}

      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="روی چه کاری کار می‌کنی؟ (اختیاری)" className={inputClass} />
      <div>
        <p className="text-xs text-muted mb-1.5">دسته‌بندی (اختیاری)</p>
        <CategoryChipPicker categories={selectableCategories(categories)} selectedId={categoryId} allowClear onPick={(c) => setCategoryId(c?.id ?? null)} />
      </div>

      <button type="button" disabled={!valid} onClick={start} className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent text-on-accent py-3 text-base font-medium disabled:opacity-40">
        <PlayIcon className="w-5 h-5" />
        شروع
      </button>
    </Card>
  );
}

function MinutesField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={600}
        value={value || ""}
        onChange={(e) => onChange(Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))}
        className={`${inputClass} mt-0.5 text-center`}
      />
    </label>
  );
}

function phaseLabel(state: TimerState): string {
  if (state.mode === "STOPWATCH") return "کرنومتر";
  if (state.mode === "COUNTDOWN") return "تایمر";
  if (state.phase === "BREAK") return isLongBreak(state) ? "استراحت بلند" : "استراحت";
  return `بلوک ${toPersianDigits(String(state.blocksDone + 1))} — تمرکز`;
}

function RunningTimer({ state }: { state: TimerState }) {
  const now = useNow(true);
  const { categories } = useCategories();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(state.title);
  const [categoryId, setCategoryId] = useState<string | null>(state.categoryId);

  const at = now || Date.now();
  const remaining = remainingMs(state, at);
  const elapsed = elapsedMs(state, at);
  const shown = remaining ?? elapsed;
  const progress = state.targetMs ? Math.min(1, elapsed / state.targetMs) : (elapsed % 3_600_000) / 3_600_000;
  const waitingForNextBlock = state.mode === "POMODORO" && state.phase === "WORK" && !state.running && state.accumulatedMs === 0;
  const onBreak = state.phase === "BREAK";
  const category = categories.find((c: { id: string }) => c.id === state.categoryId);

  const R = 88;
  const C = 2 * Math.PI * R;

  return (
    <Card className="p-5 space-y-5">
      <div className="text-center space-y-1">
        <p className={`text-xs font-medium ${onBreak ? "text-accent" : "text-muted"}`}>{phaseLabel(state)}</p>
        {editing ? (
          <div className="space-y-2 text-right">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={DEFAULT_SESSION_TITLE} className={inputClass} />
            <CategoryChipPicker categories={selectableCategories(categories)} selectedId={categoryId} allowClear onPick={(c) => setCategoryId(c?.id ?? null)} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  focusTimer.relabel(title, categoryId);
                  setEditing(false);
                }}
                className="flex-1 rounded-lg bg-accent text-on-accent py-1.5 text-sm"
              >
                ذخیره
              </button>
              <button type="button" onClick={() => setEditing(false)} className="px-3 rounded-lg bg-canvas text-muted text-sm">
                انصراف
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-base font-bold text-ink">
            {state.title || DEFAULT_SESSION_TITLE}
            {category && <span className="text-xs font-normal text-muted"> · {category.icon} {category.name}</span>}
            <span className="text-xs font-normal text-accent mr-1.5">ویرایش</span>
          </button>
        )}
      </div>

      <div className="relative mx-auto w-56 h-56">
        <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeWidth="8" className="text-line" />
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            className={onBreak ? "text-signal-500" : "text-accent"}
            style={{ transition: "stroke-dashoffset 0.5s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold text-ink tabular-nums" dir="ltr">
            {formatClock(shown)}
          </span>
          {!state.running && !waitingForNextBlock && <span className="text-xs text-muted mt-1">متوقف</span>}
        </div>
      </div>

      {waitingForNextBlock ? (
        <div className="space-y-2">
          <button type="button" onClick={() => focusTimer.resume()} className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent text-on-accent py-3 font-medium">
            <PlayIcon className="w-5 h-5" />
            شروع بلوک بعد
          </button>
          <button type="button" onClick={() => focusTimer.discard()} className="w-full rounded-xl bg-canvas text-muted py-2.5 text-sm">
            پایان پومودورو
          </button>
        </div>
      ) : onBreak ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => focusTimer.skipBreak()} className="rounded-xl bg-accent text-on-accent py-3 text-sm font-medium">
            رد کردن استراحت
          </button>
          <button type="button" onClick={() => focusTimer.discard()} className="rounded-xl bg-canvas text-muted py-3 text-sm">
            پایان پومودورو
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => (state.running ? focusTimer.pause() : focusTimer.resume())}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface py-3 text-sm text-ink"
            >
              {state.running ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
              {state.running ? "توقف" : "ادامه"}
            </button>
            <button type="button" onClick={() => focusTimer.finish()} className="rounded-xl bg-accent text-on-accent py-3 text-sm font-medium">
              پایان و ثبت
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (confirm("زمان‌سنج بدون ثبت متوقف شود؟")) focusTimer.discard();
            }}
            className="w-full rounded-xl text-muted py-2 text-xs"
          >
            لغو بدون ثبت
          </button>
        </div>
      )}
    </Card>
  );
}

/** What the timer saved: today, the last seven days as bars, and the latest sessions. */
function TimerHistory() {
  const { data } = useSWR<{ tasks: TimerSessionRow[] }>(TIMER_HISTORY_KEY, fetcher);
  if (!data) return null;
  const stats = summarizeTimerSessions(data.tasks, new Date());
  if (stats.recent.length === 0) return null;
  const max = Math.max(1, ...stats.days.map((d) => d.minutes));

  return (
    <Card className="p-4 space-y-4">
      <h2 className="text-sm font-bold text-ink">سابقهٔ زمان‌سنج</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-canvas py-2">
          <p className="text-[11px] text-muted">امروز</p>
          <p className="text-sm font-bold text-ink">{formatDuration(stats.todayMin)}</p>
        </div>
        <div className="rounded-xl bg-canvas py-2">
          <p className="text-[11px] text-muted">جلسه‌های امروز</p>
          <p className="text-sm font-bold text-ink">{toPersianDigits(String(stats.todaySessions))}</p>
        </div>
        <div className="rounded-xl bg-canvas py-2">
          <p className="text-[11px] text-muted">۷ روز اخیر</p>
          <p className="text-sm font-bold text-ink">{formatDuration(stats.weekMin)}</p>
        </div>
      </div>

      <div className="flex items-end gap-1.5 h-24" aria-label="زمان هر روز در هفتهٔ اخیر">
        {stats.days.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <div
              title={formatDuration(d.minutes)}
              className={`w-full rounded-t-md ${d.isToday ? "bg-accent" : "bg-accent/40"}`}
              style={{ height: `${Math.max(d.minutes > 0 ? 6 : 2, (d.minutes / max) * 100)}%` }}
            />
            <span className="text-[10px] text-muted">{weekdayNameFa(new Date(`${d.day}T12:00:00`)).slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <ul className="divide-y divide-line">
        {stats.recent.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">{r.title}</p>
              <p className="text-[11px] text-muted">
                {weekdayNameFa(r.endAt)} {formatTime(r.endAt)}
                {r.category ? ` · ${r.category}` : ""}
              </p>
            </div>
            <span className="text-xs text-muted shrink-0">{formatDuration(r.minutes)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
