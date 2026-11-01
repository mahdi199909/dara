"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { PlusIcon } from "@/components/icons";
import VisionDetailSheet from "@/components/vision/VisionDetailSheet";
import VisionItemForm from "@/components/vision/VisionItemForm";
import VisionProgressBar from "@/components/vision/VisionProgressBar";
import { toPersianDigits } from "@/lib/money";
import type { VisionItemDto } from "@/lib/schemas/vision";
import { formatPercent, formatVisionValue } from "@/lib/visionFormat";

type FormState = { kind: "vision" } | { kind: "goal"; parentId: string } | { kind: "edit"; item: VisionItemDto } | null;

export default function VisionPage() {
  const { data, mutate } = useSWR<{ items: VisionItemDto[] }>("/api/vision", fetcher);
  const items = useMemo(() => data?.items ?? [], [data]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visions = items.filter((i) => i.parentId === null);
  const active = visions.filter((v) => v.status !== "ARCHIVED");
  const archived = visions.filter((v) => v.status === "ARCHIVED");
  const goalsOf = (id: string) => items.filter((i) => i.parentId === id && i.status !== "ARCHIVED");

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">ویژن‌برد</h1>
          <p className="text-xs text-muted mt-1 leading-relaxed">آنچه می‌خواهی بسازی را بنویس؛ هر ویژن هدف‌هایی دارد و هر هدف متر و معیار خودت را.</p>
        </div>
        <button type="button" onClick={() => setForm({ kind: "vision" })} className="shrink-0 flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90">
          <PlusIcon className="w-4 h-4" />
          ویژن جدید
        </button>
      </div>

      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : active.length === 0 && archived.length === 0 ? (
        <Card className="p-5 space-y-2">
          <p className="text-sm text-ink font-medium">اینجا جای نوشتنِ چیزی است که می‌خواهی بسازی.</p>
          <p className="text-xs text-muted leading-relaxed">
            مثلاً ویژنِ «آزادی مالی» با هدفِ «خرید ۱۰ گرم طلا» و معیارِ «گرم». بعد از این، هر بار در «ثبت کار» همین هدف را انتخاب کنی، کارِ انجام‌شده خودکار به پیشرفتش اضافه می‌شود؛ و اگر خواستی پروژه‌ای زیر هدف می‌گذاری.
          </p>
          <button type="button" onClick={() => setForm({ kind: "vision" })} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium">
            اولین ویژن را بنویس
          </button>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((vision) => (
            <VisionCard key={vision.id} vision={vision} goals={goalsOf(vision.id)} onOpen={setDetailId} onAddGoal={(id) => setForm({ kind: "goal", parentId: id })} />
          ))}
          {archived.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs text-muted hover:text-ink">
                {showArchived ? "پنهان کردن" : "نمایش"} بایگانی ({toPersianDigits(archived.length)})
              </button>
              {showArchived && (
                <div className="space-y-3 mt-2 opacity-70">
                  {archived.map((vision) => (
                    <VisionCard key={vision.id} vision={vision} goals={goalsOf(vision.id)} onOpen={setDetailId} onAddGoal={(id) => setForm({ kind: "goal", parentId: id })} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {detailId && (
        <VisionDetailSheet
          itemId={detailId}
          allItems={items}
          onClose={() => setDetailId(null)}
          onEdit={(item) => setForm({ kind: "edit", item })}
          onAddGoal={(id) => setForm({ kind: "goal", parentId: id })}
          onOpen={setDetailId}
          onDeleted={() => {
            setDetailId(null);
            void mutate();
          }}
        />
      )}

      {form && (
        <VisionItemForm
          parentId={form.kind === "goal" ? form.parentId : undefined}
          item={form.kind === "edit" ? form.item : undefined}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            void mutate();
            // A brand-new item opens right away, so the next step (an entry, a goal) is one tap away.
            if (form.kind !== "edit") setDetailId(saved.id);
          }}
        />
      )}
    </div>
  );
}

function VisionCard({
  vision,
  goals,
  onOpen,
  onAddGoal,
}: {
  vision: VisionItemDto;
  goals: VisionItemDto[];
  onOpen: (id: string) => void;
  onAddGoal: (visionId: string) => void;
}) {
  return (
    <Card className="p-4 space-y-3 overflow-hidden" >
      <button type="button" onClick={() => onOpen(vision.id)} className="w-full text-right space-y-2" style={{ borderRight: `4px solid ${vision.color}`, paddingRight: 10 }}>
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {vision.icon && <span className="text-xl shrink-0">{vision.icon}</span>}
            <span className="font-bold text-ink truncate">{vision.title}</span>
            {vision.status === "ACHIEVED" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent shrink-0">محقق شد</span>}
          </span>
          {vision.ratio !== null && <span className="text-sm font-bold text-ink shrink-0">{formatPercent(vision.ratio)}</span>}
        </span>
        {vision.ratio !== null && <VisionProgressBar ratio={vision.ratio} color={vision.color} />}
        {vision.description && <span className="block text-xs text-muted leading-relaxed line-clamp-2">{vision.description}</span>}
      </button>

      {goals.length > 0 && (
        <ul className="space-y-1.5">
          {goals.map((goal) => (
            <li key={goal.id}>
              <button type="button" onClick={() => onOpen(goal.id)} className="w-full text-right rounded-xl bg-canvas px-3 py-2">
                <span className="flex items-center justify-between gap-2 text-sm text-ink">
                  <span className="truncate">
                    {goal.icon ? `${goal.icon} ` : ""}
                    {goal.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted" dir="ltr">
                    {goal.current !== null && goal.targetValue !== null ? `${formatVisionValue(goal.current)} / ${formatVisionValue(goal.targetValue)}${goal.unit ? ` ${goal.unit}` : ""}` : goal.ratio !== null ? formatPercent(goal.ratio) : ""}
                  </span>
                </span>
                {goal.ratio !== null && <VisionProgressBar ratio={goal.ratio} color={goal.color} thin />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => onAddGoal(vision.id)} className="text-xs text-accent">
        + هدف جدید زیر این ویژن
      </button>
    </Card>
  );
}
