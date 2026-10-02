// The planning fields of a checklist item (duration, rule, gap, link) as both the server and the phone
// write them: one place that checks a rule's target and turns an update into the columns to set.
import { ApiError } from "@/lib/apiErrorBase";
import { rootIdOf, type TreeRow } from "@/lib/checklistTree";
import { dependencyCandidates } from "@/lib/checklistSchedule";
import type { UpdateChecklistItemInput } from "@/lib/schemas/checklists";

export interface PlanningColumns {
  durationMin?: number | null;
  depType?: string | null;
  depItemId?: string | null;
  lagMin?: number;
  linkedType?: string | null;
  linkedId?: string | null;
  linkedAt?: Date | null;
}

/**
 * The columns an update sets. A rule needs both a type and a target; its target must be another item
 * of the same list — not the item itself, one of its sub-items or one of its own groups (each would be
 * waiting on itself). Clearing either half clears the rule.
 */
export function planningColumns(rows: TreeRow[], id: string, input: UpdateChecklistItemInput, now: Date): PlanningColumns {
  const out: PlanningColumns = {};
  if (input.durationMin !== undefined) out.durationMin = input.durationMin ?? null;
  if (input.lagMin !== undefined) out.lagMin = input.lagMin;
  if (input.depType !== undefined || input.depItemId !== undefined) {
    const type = input.depType ?? null;
    const target = input.depItemId ?? null;
    if (type && target) {
      const root = rootIdOf(rows, id);
      const allowed = dependencyCandidates(
        rows.map((r) => ({ id: r.id, parentId: r.parentId, title: "" })),
        root,
        id
      );
      if (!allowed.some((r) => r.id === target)) throw new ApiError("این مورد نمی‌تواند به آن مورد وابسته باشد (باید مورد دیگری از همین چک‌لیست باشد، نه خودش یا گروه خودش).", 400);
      out.depType = type;
      out.depItemId = target;
    } else {
      out.depType = null;
      out.depItemId = null;
    }
  }
  if (input.linkedType !== undefined) {
    out.linkedType = input.linkedType ?? null;
    out.linkedId = input.linkedType ? (input.linkedId ?? null) : null;
    out.linkedAt = input.linkedType ? now : null;
  }
  return out;
}

/** Tree nodes name their rule's target by title; after creating them, this finds each target's id. */
export function resolveTreeRules(created: { id: string; title: string; depType?: string | null; depTitle?: string | null }[]): { id: string; depType: string; depItemId: string }[] {
  const out: { id: string; depType: string; depItemId: string }[] = [];
  for (const node of created) {
    if (!node.depType || !node.depTitle) continue;
    const target = created.find((c) => c.title === node.depTitle && c.id !== node.id);
    if (target) out.push({ id: node.id, depType: node.depType, depItemId: target.id });
  }
  return out;
}
