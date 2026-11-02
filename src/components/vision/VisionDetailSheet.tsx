"use client";

import { useState } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { apiDelete, apiPatch, apiPost, fetcher } from "@/lib/apiClient";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import Sheet from "@/components/ui/Sheet";
import { TrashIcon } from "@/components/icons";
import VisionProgressBar from "@/components/vision/VisionProgressBar";
import { formatJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { VISION_STATUS_LABELS, type VisionDetailDto, type VisionItemDto } from "@/lib/schemas/vision";
import { formatPercent, formatVisionValue, parseVisionNumber } from "@/lib/visionFormat";

// Without a width, so a field that sets its own is not fighting a w-full for it.
const fieldClass = "bg-surface rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
const inputClass = `${fieldClass} w-full`;
const LIST_KEY = "/api/vision";

/** Whole days from now to a date (negative when it has passed). */
function daysUntil(date: string | Date): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

/**
 * One vision or goal in full: how far along it is, what counts toward it (what the person typed and
 * the finished «ثبت کار» tasks that point at it), the projects under it, and the actions on it.
 */
export default function VisionDetailSheet({
  itemId,
  allItems,
  onClose,
  onEdit,
  onAddGoal,
  onOpen,
  onDeleted,
}: {
  itemId: string;
  /** Every vision and goal, to list the goals under a vision. */
  allItems: VisionItemDto[];
  onClose: () => void;
  onEdit: (item: VisionItemDto) => void;
  onAddGoal: (visionId: string) => void;
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const detailKey = `${LIST_KEY}/${itemId}`;
  const { data, mutate } = useSWR<VisionDetailDto>(detailKey, fetcher);
  const { data: projectsData } = useSWR<{ projects: Array<{ id: string; name: string; visionItemId: string | null }> }>("/api/projects", fetcher);
  const [error, setError] = useState<string | null>(null);

  const item = data?.item;
  const goals = allItems.filter((i) => i.parentId === itemId);

  async function refresh() {
    await Promise.all([mutate(), mutateGlobal(LIST_KEY), mutateGlobal("/api/projects")]);
  }

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    }
  }

  if (!item) {
    return (
      <Sheet title="ویژن‌برد" onClose={onClose}>
        <p className="text-sm text-muted text-center py-6">{data === undefined ? "در حال بارگذاری..." : "این مورد پیدا نشد."}</p>
      </Sheet>
    );
  }

  const measured = item.targetValue !== null;
  const isGoal = item.parentId !== null;
  const unit = item.unit ?? "";
  const linkable = (projectsData?.projects ?? []).filter((p) => !p.visionItemId);

  return (
    <Sheet title={`${item.icon ? `${item.icon} ` : ""}${item.title}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-canvas text-muted">{isGoal ? "هدف" : "ویژن"} · {VISION_STATUS_LABELS[item.status]}</span>
            {item.ratio !== null && <span className="text-lg font-extrabold text-ink">{formatPercent(item.ratio)}</span>}
          </div>
          {item.ratio !== null && <VisionProgressBar ratio={item.ratio} color={item.color} />}
          {measured && item.current !== null && (
            <p className="text-sm text-ink">
              <span className="font-bold">{formatVisionValue(item.current)}</span> از <span className="font-bold">{formatVisionValue(item.targetValue as number)}</span> {unit}
              <span className="text-xs text-muted"> · شروع از {formatVisionValue(item.startValue)}</span>
            </p>
          )}
          {item.description && <p className="text-xs text-muted leading-relaxed">{item.description}</p>}
          {item.targetDate && (
            <p className="text-xs text-muted">
              تا {formatJalali(new Date(item.targetDate))}
              {item.status === "ACTIVE" && (daysUntil(item.targetDate) >= 0 ? ` — ${toPersianDigits(daysUntil(item.targetDate))} روز مانده` : ` — ${toPersianDigits(-daysUntil(item.targetDate))} روز از آن گذشته`)}
            </p>
          )}
          {item.ratio === null && !measured && <p className="text-xs text-muted">برای دیدن درصد پیشرفت، یک هدف با متر و معیار یا یک پروژه زیرش بگذار.</p>}
        </div>

        {error && <p className="text-xs text-waste">{error}</p>}

        {measured && <AddEntry item={item} onAdd={(body) => run(() => apiPost(`${LIST_KEY}/${item.id}/entries`, body), "ثبت انجام نشد.")} />}

        {measured && (
          <div>
            <p className="text-xs text-muted mb-1.5">آنچه به این هدف می‌شمارد ({toPersianDigits(data.entries.length)})</p>
            {data.entries.length === 0 ? (
              <p className="text-xs text-muted">هنوز چیزی ثبت نشده. هر وقت در «ثبت کار» این هدف را انتخاب کنی، کارِ انجام‌شده اینجا هم حساب می‌شود.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.entries.map((e, i) => (
                  <li key={e.id ?? `${e.taskId}-${i}`} className="flex items-center gap-2 py-2 text-sm">
                    <span className={`shrink-0 w-14 text-xs font-bold ${e.value < 0 ? "text-waste" : "text-accent"}`} dir="ltr">
                      {e.value > 0 ? "+" : ""}
                      {formatVisionValue(e.value)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-ink">{e.kind === "TASK" ? e.title : e.note || "ثبت دستی"}</span>
                      <span className="block text-[11px] text-muted">
                        {formatJalali(new Date(e.date))}
                        {e.kind === "TASK" && " · از «ثبت کار»"}
                      </span>
                    </span>
                    {e.kind === "MANUAL" && e.id && (
                      <button
                        type="button"
                        aria-label="حذف این ثبت"
                        onClick={() => {
                          if (confirm("این ثبت حذف شود؟")) void run(() => apiDelete(`${LIST_KEY}/${item.id}/entries/${e.id}`), "حذف انجام نشد.");
                        }}
                        className="shrink-0 text-muted hover:text-waste p-1"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isGoal && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted">هدف‌ها ({toPersianDigits(goals.length)})</p>
              <button type="button" onClick={() => onAddGoal(item.id)} className="text-xs text-accent">
                + هدف جدید
              </button>
            </div>
            {goals.length === 0 ? (
              <p className="text-xs text-muted">هنوز هدفی زیر این ویژن نیست.</p>
            ) : (
              <ul className="space-y-1.5">
                {goals.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => onOpen(g.id)} className="w-full text-right rounded-xl bg-canvas px-3 py-2">
                      <span className="flex items-center justify-between gap-2 text-sm text-ink">
                        <span className="truncate">{g.title}</span>
                        {g.ratio !== null && <span className="text-xs text-muted shrink-0">{formatPercent(g.ratio)}</span>}
                      </span>
                      {g.ratio !== null && <VisionProgressBar ratio={g.ratio} color={g.color} thin />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <p className="text-xs text-muted mb-1.5">پروژه‌های این {isGoal ? "هدف" : "ویژن"} ({toPersianDigits(data.projects.length)})</p>
          {data.projects.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {data.projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl bg-canvas px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2 text-sm text-ink">
                      <span className="truncate">{p.name}</span>
                      <span className="text-[11px] text-muted shrink-0">
                        {toPersianDigits(p.taskDone)} از {toPersianDigits(p.taskTotal)} کار
                      </span>
                    </span>
                    <VisionProgressBar ratio={p.taskTotal > 0 ? p.taskDone / p.taskTotal : 0} color={p.color} thin />
                  </span>
                  <button type="button" aria-label="برداشتن پروژه از زیر این مورد" onClick={() => void run(() => apiDelete(`${LIST_KEY}/${item.id}/projects/${p.id}`), "برداشتن انجام نشد.")} className="shrink-0 text-muted hover:text-waste text-lg leading-none px-1">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AddProject
            linkable={linkable}
            onLink={(projectId) => run(() => apiPost(`${LIST_KEY}/${item.id}/projects`, { projectId }), "افزودن پروژه انجام نشد.")}
            onCreate={(name) =>
              run(async () => {
                const { project } = await apiPost<{ project: { id: string } }>("/api/projects", { name });
                await apiPost(`${LIST_KEY}/${item.id}/projects`, { projectId: project.id });
              }, "ساخت پروژه انجام نشد.")
            }
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1 border-t border-line">
          <button type="button" onClick={() => onEdit(item)} className="rounded-xl bg-canvas text-ink px-3 py-2 text-xs">
            ویرایش
          </button>
          {item.status === "ACTIVE" ? (
            <button type="button" onClick={() => void run(() => apiPatch(`${LIST_KEY}/${item.id}`, { status: "ACHIEVED" }), "تغییر وضعیت انجام نشد.")} className="rounded-xl bg-accent-soft text-accent px-3 py-2 text-xs">
              به نتیجه رسیدم
            </button>
          ) : (
            <button type="button" onClick={() => void run(() => apiPatch(`${LIST_KEY}/${item.id}`, { status: "ACTIVE" }), "تغییر وضعیت انجام نشد.")} className="rounded-xl bg-canvas text-ink px-3 py-2 text-xs">
              دوباره در مسیر
            </button>
          )}
          {item.status !== "ARCHIVED" && (
            <button type="button" onClick={() => void run(() => apiPatch(`${LIST_KEY}/${item.id}`, { status: "ARCHIVED" }), "بایگانی انجام نشد.")} className="rounded-xl bg-canvas text-muted px-3 py-2 text-xs">
              بایگانی
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const what = isGoal ? "این هدف" : `این ویژن و ${goals.length > 0 ? "هدف‌های زیرش" : "همهٔ ثبت‌هایش"}`;
              if (!confirm(`${what} حذف شود؟ کارها و پروژه‌ها حذف نمی‌شوند، فقط از زیر آن برداشته می‌شوند.`)) return;
              void (async () => {
                if (await run(() => apiDelete(`${LIST_KEY}/${item.id}`), "حذف انجام نشد.")) onDeleted();
              })();
            }}
            className="rounded-xl text-waste px-3 py-2 text-xs mr-auto"
          >
            حذف
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** «ثبت پیشرفت»: a number, optionally on another day and with a note. */
function AddEntry({ item, onAdd }: { item: VisionItemDto; onAdd: (body: { value: number; date?: string; note?: string }) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState<Date | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseVisionNumber(text);
    if (value === null) return setFormError("یک عدد بنویس؛ مثلاً ۲ یا ۰٫۵.");
    setFormError(null);
    const ok = await onAdd({ value, ...(date ? { date: date.toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    if (ok) {
      setText("");
      setNote("");
      setDate(null);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-canvas p-3 space-y-2">
      <p className="text-xs text-muted">{item.mode === "ADD" ? `ثبت پیشرفت — به ${item.unit ?? "مجموع"} اضافه می‌شود` : `ثبت مقدار تازه — همین می‌شود مقدار فعلی`}</p>
      <div className="flex gap-2">
        <input dir="ltr" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={item.mode === "ADD" ? "۲" : "۸۵"} className={`${fieldClass} text-right w-28 shrink-0`} aria-label="مقدار" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" maxLength={500} className={`${fieldClass} flex-1 min-w-0`} />
        <button type="submit" className="shrink-0 rounded-xl bg-accent text-on-accent px-4 text-sm font-medium">
          ثبت
        </button>
      </div>
      {date ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <JalaliDateInput value={date} onChange={setDate} />
          </div>
          <button type="button" onClick={() => setDate(null)} className="text-xs text-muted">
            امروز
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setDate(new Date())} className="text-[11px] text-muted hover:text-ink">
          روز دیگری بود؟
        </button>
      )}
      {formError && <p className="text-xs text-waste">{formError}</p>}
    </form>
  );
}

/** Puts a project the person already has under this goal, or makes a new one there. */
function AddProject({
  linkable,
  onLink,
  onCreate,
}: {
  linkable: Array<{ id: string; name: string }>;
  onLink: (projectId: string) => Promise<boolean>;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted hover:text-ink">
        + پروژه
      </button>
    );
  }
  return (
    <div className="rounded-xl bg-canvas p-3 space-y-2">
      {linkable.length > 0 && (
        <select
          defaultValue=""
          onChange={async (e) => {
            if (e.target.value && (await onLink(e.target.value))) setOpen(false);
          }}
          className={inputClass}
          aria-label="پروژهٔ موجود"
        >
          <option value="">یکی از پروژه‌های موجود...</option>
          {linkable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="یا نام یک پروژهٔ تازه" maxLength={120} className={`${fieldClass} flex-1 min-w-0`} />
        <button
          type="button"
          onClick={async () => {
            if (name.trim() && (await onCreate(name.trim()))) {
              setName("");
              setOpen(false);
            }
          }}
          className="shrink-0 rounded-xl bg-accent text-on-accent px-4 text-sm font-medium"
        >
          ساخت
        </button>
      </div>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted">
        انصراف
      </button>
    </div>
  );
}
