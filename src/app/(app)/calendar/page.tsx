"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { toJalali, formatJalali, formatJalaliMonthYear, formatTime, weekdayNameFa } from "@/lib/jalali";
import { getJalaliMonthGrid, isSameDay, addJalaliMonths } from "@/lib/calendarGrid";
import { Card, EmptyState } from "@/components/ui/Card";
import { ChevronRightIcon, ChevronLeftIcon, PlusIcon, CheckSquareIcon } from "@/components/icons";
import EventFormModal from "@/components/calendar/EventFormModal";
import { toPersianDigits } from "@/lib/money";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const VIEWS = [
  { key: "month", label: "ماه" },
  { key: "week", label: "هفته" },
  { key: "day", label: "روز" },
  { key: "agenda", label: "برنامه" },
] as const;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function CalendarPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("month");
  const [cursor, setCursor] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editingEvent, setEditingEvent] = useState<any>(null);

  const { jy, jm } = toJalali(cursor);

  const range = useMemo(() => {
    if (view === "month") {
      const grid = getJalaliMonthGrid(jy, jm);
      return { from: grid[0], to: grid[grid.length - 1] };
    }
    if (view === "week") {
      const start = new Date(cursor);
      const daysSinceSaturday = (start.getDay() + 1) % 7;
      start.setDate(start.getDate() - daysSinceSaturday);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end };
    }
    if (view === "day") {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      return { from: start, to: end };
    }
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 86400000);
    return { from: start, to: end };
  }, [view, cursor, jy, jm]);

  const { data, mutate } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(
    `/api/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
    fetcher
  );

  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const occ of data?.occurrences ?? []) {
      const d = new Date(occ.startAt);
      const key = dayKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(occ);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return map;
  }, [data]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of data?.taskOccurrences ?? []) {
      if (!task.dueDate) continue;
      const key = dayKey(new Date(task.dueDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return map;
  }, [data]);

  function navigate(delta: number) {
    if (view === "month") {
      const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta);
      setCursor(getJalaliMonthGrid(ny, nm)[8]); // a day safely inside the new month
    } else if (view === "week") {
      setCursor(new Date(cursor.getTime() + delta * 7 * 86400000));
    } else {
      setCursor(new Date(cursor.getTime() + delta * 86400000));
    }
  }

  function openEdit(occ: any) {
    setEditingEvent(occ.event);
    setShowForm(true);
  }

  async function toggleDone(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutate();
  }

  function closeForm() {
    setShowForm(false);
    setEditingEvent(null);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-800">تقویم</h1>
        <button
          onClick={() => { setSelectedDay(cursor); setEditingEvent(null); setShowForm(true); }}
          className="flex items-center gap-1 text-sm bg-brand-600 text-white px-3 py-2 rounded-xl hover:bg-brand-700"
        >
          <PlusIcon className="w-4 h-4" />
          رویداد جدید
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`text-sm px-3.5 py-1.5 rounded-full transition ${
                view === v.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-500"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view !== "agenda" && (
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 min-w-[7rem] text-center">
              {view === "month" ? formatJalaliMonthYear(cursor) : formatJalali(cursor, { withWeekday: view === "day" })}
            </span>
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {view === "month" && (
        <Card className="p-3">
          <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-2">
            {WEEKDAY_HEADERS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {getJalaliMonthGrid(jy, jm).map((day) => {
              const { jm: dJm, jd } = toJalali(day);
              const inMonth = dJm === jm;
              const isToday = isSameDay(day, new Date());
              const events = occurrencesByDay.get(dayKey(day)) ?? [];
              const tasks = tasksByDay.get(dayKey(day)) ?? [];
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => { setSelectedDay(day); setCursor(day); setView("day"); }}
                  className={`aspect-square sm:aspect-auto sm:h-24 rounded-xl border p-1.5 text-right flex flex-col gap-1 ${
                    inMonth ? "bg-white border-gray-100" : "bg-gray-50 border-transparent text-gray-300"
                  } ${isToday ? "ring-2 ring-brand-400" : ""}`}
                >
                  <span className={`text-xs ${inMonth ? "text-gray-700" : "text-gray-300"}`}>{toPersianDigits(jd)}</span>
                  <div className="flex-1 overflow-hidden space-y-0.5 hidden sm:block">
                    {events.slice(0, 2).map((occ) => (
                      <div key={occ.occurrenceId} className="text-[10px] bg-brand-50 text-brand-700 rounded px-1 truncate">
                        {occ.event.title}
                      </div>
                    ))}
                    {tasks.slice(0, Math.max(0, 2 - events.length)).map((t) => (
                      <div key={t.id} className="text-[10px] bg-amber-50 text-amber-700 rounded px-1 truncate">
                        ☐ {t.title}
                      </div>
                    ))}
                    {events.length + tasks.length > 2 && (
                      <div className="text-[10px] text-gray-400">+{toPersianDigits(events.length + tasks.length - 2)}</div>
                    )}
                  </div>
                  {(events.length > 0 || tasks.length > 0) && (
                    <div className="sm:hidden flex gap-0.5 self-end">
                      {events.length > 0 && <div className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
                      {tasks.length > 0 && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {view === "week" && (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          {Array.from({ length: 7 }, (_, i) => {
            const day = new Date(range.from.getTime() + i * 86400000);
            const events = occurrencesByDay.get(dayKey(day)) ?? [];
            const tasks = tasksByDay.get(dayKey(day)) ?? [];
            return (
              <Card key={i} className="p-3">
                <p className="text-xs text-gray-400 mb-2">{weekdayNameFa(day)} {toPersianDigits(toJalali(day).jd)}</p>
                <div className="space-y-1.5">
                  {events.length === 0 && tasks.length === 0 ? (
                    <p className="text-xs text-gray-300">—</p>
                  ) : (
                    <>
                      {events.map((occ) => (
                        <button
                          key={occ.occurrenceId}
                          onClick={() => openEdit(occ)}
                          className="w-full text-right text-xs bg-brand-50 text-brand-700 rounded-lg px-2 py-1 hover:bg-brand-100"
                        >
                          {formatTime(new Date(occ.startAt))} · {occ.event.title}
                        </button>
                      ))}
                      {tasks.map((t) => (
                        <div key={t.id} className="text-xs bg-amber-50 text-amber-700 rounded-lg px-2 py-1">
                          ☐ {t.title}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <Card className="p-4">
          {(occurrencesByDay.get(dayKey(cursor)) ?? []).length === 0 && (tasksByDay.get(dayKey(cursor)) ?? []).length === 0 ? (
            <EmptyState message="رویداد یا کاری برای این روز ثبت نشده." />
          ) : (
            <ul className="space-y-2">
              {(occurrencesByDay.get(dayKey(cursor)) ?? []).map((occ) => (
                <li key={occ.occurrenceId} className="flex items-center gap-2 border-b border-gray-50 pb-2 last:border-0">
                  <button
                    onClick={() => toggleDone(occ)}
                    aria-label="تکمیل رویداد"
                    className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                      occ.isDone ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                    }`}
                  >
                    <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={() => openEdit(occ)}
                    className="flex-1 flex items-center gap-3 text-right hover:bg-gray-50 rounded-lg -mx-1 px-1 py-0.5"
                  >
                    <span className="text-sm text-gray-500 w-14 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                    <div>
                      <p className={`text-sm ${occ.isDone ? "text-gray-400 line-through" : "text-gray-800"}`}>{occ.event.title}</p>
                      {occ.event.category && <p className="text-xs text-gray-400">{occ.event.category.icon} {occ.event.category.name}</p>}
                    </div>
                  </button>
                </li>
              ))}
              {(tasksByDay.get(dayKey(cursor)) ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-gray-50 pb-2 last:border-0">
                  <span className="w-14 shrink-0 flex justify-center"><CheckSquareIcon className="w-4 h-4 text-amber-500" /></span>
                  <div>
                    <p className="text-sm text-gray-800">{t.title}</p>
                    {t.category && <p className="text-xs text-gray-400">{t.category.icon} {t.category.name}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === "agenda" && (
        <div className="space-y-3">
          {Array.from(occurrencesByDay.entries()).length === 0 && Array.from(tasksByDay.entries()).length === 0 ? (
            <EmptyState message="رویداد یا کاری در ۳۰ روز آینده ثبت نشده." />
          ) : (
            Array.from(new Set([...occurrencesByDay.keys(), ...tasksByDay.keys()]))
              .map((key) => {
                const events = occurrencesByDay.get(key) ?? [];
                const tasks = tasksByDay.get(key) ?? [];
                const anyDate = events[0]?.startAt ?? tasks[0]?.dueDate;
                return { key, events, tasks, anyDate: new Date(anyDate) };
              })
              .sort((a, b) => a.anyDate.getTime() - b.anyDate.getTime())
              .map(({ key, events, tasks, anyDate }) => (
                <Card key={key} className="p-4">
                  <p className="text-xs text-gray-400 mb-2">{formatJalali(anyDate, { withWeekday: true, long: true })}</p>
                  <ul className="space-y-1.5">
                    {events.map((occ) => (
                      <li key={occ.occurrenceId} className="flex items-center gap-2">
                        <button
                          onClick={() => toggleDone(occ)}
                          aria-label="تکمیل رویداد"
                          className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${
                            occ.isDone ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                          }`}
                        >
                          <CheckSquareIcon className="w-3 h-3" strokeWidth={3} />
                        </button>
                        <button onClick={() => openEdit(occ)} className="flex-1 flex items-center gap-3 text-sm text-right hover:bg-gray-50 rounded-lg -mx-1 px-1">
                          <span className="text-gray-400 w-14 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                          <span className={occ.isDone ? "text-gray-400 line-through" : "text-gray-800"}>{occ.event.title}</span>
                        </button>
                      </li>
                    ))}
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 text-sm">
                        <span className="w-14 shrink-0 flex"><CheckSquareIcon className="w-3.5 h-3.5 text-amber-500" /></span>
                        <span className="text-gray-800">{t.title}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))
          )}
        </div>
      )}

      {showForm && (
        <EventFormModal
          defaultDate={selectedDay ?? cursor}
          event={editingEvent}
          onClose={closeForm}
          onCreated={() => { closeForm(); mutate(); }}
          onDeleted={() => { closeForm(); mutate(); }}
        />
      )}
    </div>
  );
}
