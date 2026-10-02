// Shared between src/app/api/checklists/**/route.ts (web) and src/local/repositories/checklists.ts
// (on-device) so both validate identically.
import { z } from "zod";
import { DEP_TYPES } from "@/lib/checklistSchedule";

export const CHECKLIST_TITLE_MAX_LENGTH = 300;
export const CHECKLIST_NOTE_MAX_LENGTH = 2000;

const titleSchema = z.string().trim().min(1, "عنوان خالی است.").max(CHECKLIST_TITLE_MAX_LENGTH, `عنوان حداکثر ${CHECKLIST_TITLE_MAX_LENGTH} نویسه می‌تواند باشد.`);
const noteSchema = z.string().trim().max(CHECKLIST_NOTE_MAX_LENGTH, `توضیح حداکثر ${CHECKLIST_NOTE_MAX_LENGTH} نویسه می‌تواند باشد.`);

/** No parentId = a new list of its own; with one = an item (or sub-item) inside it. */
export const createChecklistItemSchema = z.object({
  parentId: z.string().min(1).nullish(),
  title: titleSchema,
  note: noteSchema.nullish(),
});
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;

/** Several items at once (one per line of a pasted list), all under the same parent. */
export const createChecklistItemsSchema = z.object({
  parentId: z.string().min(1),
  titles: z.array(titleSchema).min(1).max(200),
});
export type CreateChecklistItemsInput = z.infer<typeof createChecklistItemsSchema>;

/** A whole list at once, nested — what a ready-made checklist adds (src/lib/checklistTemplates.ts). */
export interface ChecklistTreeNode {
  title: string;
  note?: string | null;
  durationMin?: number | null;
  /** A planning rule pointing at another item of the same tree by its title (first match). */
  depType?: "AFTER" | "BEFORE" | "WITH" | null;
  depTitle?: string | null;
  lagMin?: number;
  children?: ChecklistTreeNode[];
}
export const CHECKLIST_TREE_MAX_ITEMS = 300;

/** A step takes from one minute to a week; a gap up to 90 days. */
const durationSchema = z.number().int().min(1, "مدت باید دست‌کم یک دقیقه باشد.").max(7 * 24 * 60, "مدت حداکثر یک هفته است.");
const lagSchema = z.number().int().min(0).max(90 * 24 * 60, "فاصله حداکثر ۹۰ روز است.");

/** What a step can be turned into (the same places an inbox item can go). */
export const CHECKLIST_LINK_TYPES = ["TASK", "EVENT", "TRANSACTION", "INSTALLMENT", "HABIT", "NOTE", "AUTO"] as const;
export type ChecklistLinkType = (typeof CHECKLIST_LINK_TYPES)[number];
export const CHECKLIST_TREE_MAX_DEPTH = 6;

const treeNodeSchema: z.ZodType<ChecklistTreeNode> = z.lazy(() =>
  z.object({
    title: titleSchema,
    note: noteSchema.nullish(),
    durationMin: durationSchema.nullish(),
    depType: z.enum(DEP_TYPES as [string, ...string[]]).nullish() as z.ZodType<"AFTER" | "BEFORE" | "WITH" | null | undefined>,
    depTitle: titleSchema.nullish(),
    lagMin: lagSchema.optional(),
    children: z.array(treeNodeSchema).max(CHECKLIST_TREE_MAX_ITEMS).optional(),
  })
);

function measure(node: ChecklistTreeNode, depth = 1): { count: number; depth: number } {
  return (node.children ?? []).reduce(
    (acc, child) => {
      const m = measure(child, depth + 1);
      return { count: acc.count + m.count, depth: Math.max(acc.depth, m.depth) };
    },
    { count: 1, depth }
  );
}

/** No parentId = the tree becomes a new list; with one, it is added under that item. */
export const createChecklistTreeSchema = z
  .object({ parentId: z.string().min(1).nullish(), tree: treeNodeSchema })
  .refine((v) => measure(v.tree).count <= CHECKLIST_TREE_MAX_ITEMS, { message: `حداکثر ${CHECKLIST_TREE_MAX_ITEMS} مورد در یک بار.` })
  .refine((v) => measure(v.tree).depth <= CHECKLIST_TREE_MAX_DEPTH, { message: `حداکثر ${CHECKLIST_TREE_MAX_DEPTH} سطح زیرمورد.` });
export type CreateChecklistTreeInput = z.infer<typeof createChecklistTreeSchema>;

export const updateChecklistItemSchema = z.object({
  title: titleSchema.optional(),
  note: noteSchema.nullish(),
  /** Ticking an item ticks everything under it; the items above follow (see computeCheckChange). */
  checked: z.boolean().optional(),
  /** Moves the item one place up or down among its siblings. */
  move: z.enum(["UP", "DOWN"]).optional(),
  /** Dragging: the item's new place among its siblings, 0 = first. */
  position: z.number().int().min(0).max(10_000).optional(),
  /** Planning (null clears): how long it takes, and when it happens relative to another item of the list. */
  durationMin: durationSchema.nullish(),
  depType: z.enum(DEP_TYPES as [string, ...string[]]).nullish(),
  depItemId: z.string().min(1).nullish(),
  lagMin: lagSchema.optional(),
  /** What it was turned into; null forgets the link. */
  linkedType: z.enum(CHECKLIST_LINK_TYPES).nullish(),
  linkedId: z.string().min(1).max(200).nullish(),
});
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

/** What both sides return for an item. The client builds the tree from the flat list. */
export interface ChecklistItemDto {
  id: string;
  parentId: string | null;
  title: string;
  note: string | null;
  checked: boolean;
  checkedAt: string | Date | null;
  sortOrder: number;
  durationMin: number | null;
  depType: string | null;
  depItemId: string | null;
  lagMin: number;
  linkedType: string | null;
  linkedId: string | null;
  linkedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
