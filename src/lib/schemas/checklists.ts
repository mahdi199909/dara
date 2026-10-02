// Shared between src/app/api/checklists/**/route.ts (web) and src/local/repositories/checklists.ts
// (on-device) so both validate identically.
import { z } from "zod";

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
  children?: ChecklistTreeNode[];
}
export const CHECKLIST_TREE_MAX_ITEMS = 300;
export const CHECKLIST_TREE_MAX_DEPTH = 6;

const treeNodeSchema: z.ZodType<ChecklistTreeNode> = z.lazy(() =>
  z.object({ title: titleSchema, note: noteSchema.nullish(), children: z.array(treeNodeSchema).max(CHECKLIST_TREE_MAX_ITEMS).optional() })
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
  createdAt: string | Date;
  updatedAt: string | Date;
}
