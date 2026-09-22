// The actual "write this to the database" step behind CaptureForm's submit button — pulled out
// so SmartCaptureConfirm (a lightweight "here's what I found, تأیید or اصلاح" card) can save
// exactly the same way the full form does, instead of a second hand-rolled copy of the task-vs-
// event branching that could quietly drift from it.
import { apiPost } from "./apiClient";
import { notifySaved } from "./savedToast";
import { refreshAllCaches } from "./refreshCaches";
import type { CaptureEntityType, ValueType } from "./types";

type FlowType = "COST" | "INCOME";

/** What was just submitted, for the Companion's immediate reaction (see Home's wiring) —
 * deliberately omits a "virtual asset" case, since that reaction already exists (UpgradeToast,
 * watching /api/virtual-assets/latest-effect) and would otherwise double up. */
export interface CaptureSummary {
  kind: "PRODUCTIVE" | "EXPENSE" | "WASTE";
  minutes?: number;
  amount?: number;
}

export interface SaveCaptureInput {
  title: string;
  entityType: CaptureEntityType;
  valueType: ValueType;
  categoryId: string | null;
  projectId: string | null;
  /** The picked category's own `kind` (PRODUCTIVE/NEUTRAL/WASTE), if the caller has it — feeds
   * the reaction summary below; a caller with no category picked just passes null. */
  categoryKind: string | null;
  day: Date;
  /** "HH:MM" (24h, ASCII digits) or "" — TimePicker's own value format. */
  startTime: string;
  endTime: string;
  flowType: FlowType;
  amount: number | undefined;
  /** True only once the person has seen an overlap warning and chosen to save anyway. */
  allowOverlap?: boolean;
}

function dayIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Plain ASCII "HH:MM", 24-hour — the same format TimePicker's own value uses, and what
 * SaveCaptureInput.startTime/endTime expect. */
export function hhmm(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Throws on failure — including an overlap refusal (see src/lib/overlapClient.ts's
 * `overlapRefusal(err)`), which the caller decides how to handle (CaptureForm shows
 * OverlapNotice inline; SmartCaptureConfirm falls back to opening that same full form). */
export async function saveCapture(input: SaveCaptureInput): Promise<CaptureSummary | undefined> {
  const amountNum = input.amount;
  const day10 = dayIso(input.day);

  if (input.entityType === "TASK") {
    const dueDate = new Date(`${day10}T00:00:00`);
    const startAt = input.startTime ? new Date(`${day10}T${input.startTime}:00`) : undefined;
    const endAt = input.endTime ? new Date(`${day10}T${input.endTime}:00`) : undefined;
    // Only when a time was actually entered — a bare day with no time isn't a strong enough
    // signal either way, and would wrongly mark every same-day task "done" once midnight passes.
    const referenceTime = endAt ?? startAt;
    const status = referenceTime ? (referenceTime < new Date() ? "DONE" : "TODO") : undefined;

    await apiPost("/api/tasks", {
      title: input.title,
      categoryId: input.categoryId ?? undefined,
      projectId: input.projectId ?? undefined,
      dueDate: dueDate.toISOString(),
      valueType: input.valueType,
      status,
      directCost: input.flowType === "COST" ? amountNum : undefined,
      incomeAmount: input.flowType === "INCOME" ? amountNum : undefined,
      startAt: startAt?.toISOString(),
      endAt: endAt?.toISOString(),
      allowOverlap: input.allowOverlap || undefined,
    });
  } else {
    let startAt: Date;
    let endAt: Date;
    let allDay: boolean;

    if (input.startTime) {
      startAt = new Date(`${day10}T${input.startTime}:00`);
      endAt = input.endTime ? new Date(`${day10}T${input.endTime}:00`) : new Date(startAt.getTime() + 60 * 60000);
      allDay = false;
    } else {
      startAt = new Date(`${day10}T00:00:00`);
      endAt = new Date(`${day10}T23:59:59`);
      allDay = true;
    }

    const { event } = await apiPost<{ event: { id: string } }>("/api/events", {
      title: input.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay,
      categoryId: input.categoryId ?? undefined,
      projectId: input.projectId ?? undefined,
      valueType: input.valueType,
      directCost: input.flowType === "COST" ? amountNum : undefined,
      incomeAmount: input.flowType === "INCOME" ? amountNum : undefined,
      allowOverlap: input.allowOverlap || undefined,
    });
    // Same "already happened" default as a Task, expressed the way events track completion —
    // a fresh EventCompletion row rather than a status field.
    if (input.startTime && endAt < new Date()) {
      await apiPost(`/api/events/${event.id}/complete`, { occurrenceDate: startAt.toISOString() });
    }
  }

  refreshAllCaches();
  notifySaved();

  const durationMin =
    input.startTime && input.endTime
      ? Math.round((new Date(`${day10}T${input.endTime}:00`).getTime() - new Date(`${day10}T${input.startTime}:00`).getTime()) / 60000)
      : undefined;

  if (input.flowType === "COST" && amountNum && amountNum > 0) return { kind: "EXPENSE", amount: amountNum };
  if (input.categoryKind === "WASTE") return { kind: "WASTE" };
  if (input.categoryKind === "PRODUCTIVE" && durationMin && durationMin > 0) return { kind: "PRODUCTIVE", minutes: durationMin };
  return undefined;
}
