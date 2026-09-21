// The rules of dragging a category around the list (Settings → دسته‌بندی‌ها). The list is a row per
// category: top-level ones, each followed by its sub-categories (one level only). Holding a category
// over a row shows where it would land — above the row, below it, or inside it — and letting go puts it
// there. This file decides, from where the pointer is, what the drop means (`resolveDropTarget`), what
// the list looks like afterwards (`planCategoryMove`), where to draw the insertion line
// (`dropIndicator`) and how to say it in words (`describeDrop`). No DOM, so it is tested directly.

export interface CategoryLite {
  id: string;
  name: string;
  parentCategoryId: string | null;
}

/** Where a dragged category would land. `end` is the gap after the last row; `nest` puts it inside a top-level one. */
export type DropTarget = { kind: "before" | "after" | "nest"; rowId: string } | { kind: "end" };

export interface CategoryGroup<T extends CategoryLite = CategoryLite> {
  top: T;
  children: T[];
}

/** The list as it is drawn: each top-level category with its sub-categories, in the order given. */
export function groupCategories<T extends CategoryLite>(categories: T[]): CategoryGroup<T>[] {
  const known = new Set(categories.map((c) => c.id));
  const groups: CategoryGroup<T>[] = categories.filter((c) => !c.parentCategoryId || !known.has(c.parentCategoryId)).map((top) => ({ top, children: [] }));
  const byTop = new Map(groups.map((g) => [g.top.id, g]));
  for (const c of categories) {
    if (c.parentCategoryId && byTop.has(c.parentCategoryId)) byTop.get(c.parentCategoryId)!.children.push(c);
  }
  return groups;
}

const flatten = (groups: CategoryGroup[]) => groups.flatMap((g) => [g.top.id, ...g.children.map((c) => c.id)]);

/** Fractions of a row's height: above the first only a "before" drop, below the second only an "after" one. */
const EDGE_TOP = 0.3;
const EDGE_BOTTOM = 0.7;

/**
 * What letting go here would mean. `rel` is how far down the hovered ROW the pointer is (0 top … 1
 * bottom); `groupRel` the same for the row's whole group, which is what moving a category that has
 * sub-categories of its own is judged by (it can only move between groups — a group cannot go inside one).
 */
export function resolveDropTarget(categories: CategoryLite[], dragId: string, rowId: string, rel: number, groupRel: number): DropTarget | null {
  const dragged = categories.find((c) => c.id === dragId);
  const row = categories.find((c) => c.id === rowId);
  if (!dragged || !row || dragId === rowId) return null;

  const groups = groupCategories(categories);
  const draggedGroup = groups.find((g) => g.top.id === dragId);

  if (draggedGroup && draggedGroup.children.length > 0) {
    const groupTop = row.parentCategoryId ?? row.id;
    if (groupTop === dragId) return null; // over its own sub-categories
    return { kind: groupRel < 0.5 ? "before" : "after", rowId: groupTop };
  }

  if (row.parentCategoryId) {
    // Between two sub-categories: the dragged one joins that group there.
    return { kind: rel < 0.5 ? "before" : "after", rowId };
  }

  const group = groups.find((g) => g.top.id === rowId)!;
  if (rel < EDGE_TOP) return { kind: "before", rowId };
  if (rel > EDGE_BOTTOM) {
    // Below a top-level row: after it if it stands alone, otherwise as the first of its sub-categories.
    const first = group.children.find((c) => c.id !== dragId);
    if (first) return { kind: "before", rowId: first.id };
    // A lone child hovering under its own parent is already there; taking it out to the top level is done
    // by dropping it above the next top-level row or in the end zone.
    return dragged.parentCategoryId === rowId ? null : { kind: "after", rowId };
  }
  return dragged.parentCategoryId === rowId ? null : { kind: "nest", rowId };
}

export interface CategoryMovePlan {
  /** The dragged category's parent afterwards (null = top-level). */
  parentCategoryId: string | null;
  /** Every category id in its new list order — what PATCH /api/categories/reorder takes. */
  orderedIds: string[];
  /** The parent changes, so the category itself needs a PATCH too. */
  changesParent: boolean;
  /** Nothing would change: dropped where it already is. */
  noop: boolean;
}

/** The list after the drop, or null when the drop is not allowed. */
export function planCategoryMove(categories: CategoryLite[], dragId: string, target: DropTarget): CategoryMovePlan | null {
  const dragged = categories.find((c) => c.id === dragId);
  if (!dragged) return null;
  const before = groupCategories(categories);
  const beforeOrder = flatten(before);

  const ownGroup = before.find((g) => g.top.id === dragId);
  const isGroup = !!ownGroup && ownGroup.children.length > 0;
  if (isGroup && target.kind !== "end" && (target.kind === "nest" || categories.find((c) => c.id === target.rowId)?.parentCategoryId)) return null;

  // Take the dragged category (with its sub-categories, if it has any) out of the list.
  const groups: CategoryGroup[] = before
    .filter((g) => g.top.id !== dragId)
    .map((g) => ({ top: g.top, children: g.children.filter((c) => c.id !== dragId) }));
  const moved: CategoryGroup = isGroup ? ownGroup! : { top: dragged, children: [] };
  let parentCategoryId: string | null = null;

  if (target.kind === "end") {
    groups.push(moved);
  } else {
    const row = categories.find((c) => c.id === target.rowId);
    if (!row || row.id === dragId) return null;

    if (target.kind === "nest") {
      const group = groups.find((g) => g.top.id === row.id);
      if (!group) return null; // only a top-level category can hold sub-categories
      group.children.push(dragged);
      parentCategoryId = row.id;
    } else if (row.parentCategoryId) {
      const group = groups.find((g) => g.top.id === row.parentCategoryId);
      if (!group) return null;
      const at = group.children.findIndex((c) => c.id === row.id);
      group.children.splice(target.kind === "before" ? at : at + 1, 0, dragged);
      parentCategoryId = row.parentCategoryId;
    } else {
      const at = groups.findIndex((g) => g.top.id === row.id);
      if (at < 0) return null;
      groups.splice(target.kind === "before" ? at : at + 1, 0, moved);
    }
  }

  const orderedIds = flatten(groups);
  const changesParent = (dragged.parentCategoryId ?? null) !== parentCategoryId;
  const noop = !changesParent && orderedIds.every((id, i) => id === beforeOrder[i]);
  return { parentCategoryId, orderedIds, changesParent, noop };
}

/** The row to draw the insertion line on, and which of its edges. `nest` has no line (the row itself is lit). */
export function dropIndicator(categories: CategoryLite[], target: DropTarget): { rowId: string; edge: "top" | "bottom" } | null {
  const rows = flatten(groupCategories(categories));
  if (target.kind === "end") return rows.length ? { rowId: rows[rows.length - 1], edge: "bottom" } : null;
  if (target.kind === "nest") return null;
  if (target.kind === "before") return { rowId: target.rowId, edge: "top" };
  const group = groupCategories(categories).find((g) => g.top.id === target.rowId);
  const last = group?.children.length ? group.children[group.children.length - 1].id : target.rowId;
  return { rowId: last, edge: "bottom" };
}

/** "بین «الف» و «ب»" — where the category would fall, in words. */
export function describeDrop(categories: CategoryLite[], dragId: string, target: DropTarget): string | null {
  const plan = planCategoryMove(categories, dragId, target);
  if (!plan) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  if (target.kind === "nest") return `داخل «${byId.get(target.rowId)?.name}»`;

  const between = (prev?: string, next?: string) => (prev && next ? `بین «${prev}» و «${next}»` : prev ? `بعد از «${prev}»` : next ? `قبل از «${next}»` : "در فهرست");

  // The list as it will be, so the neighbours named are the ones the person will actually see next to it.
  const after = plan.orderedIds.map((id) => ({ ...byId.get(id)!, parentCategoryId: id === dragId ? plan.parentCategoryId : byId.get(id)!.parentCategoryId }));
  const groups = groupCategories(after);

  if (plan.parentCategoryId) {
    const group = groups.find((g) => g.top.id === plan.parentCategoryId)!;
    const at = group.children.findIndex((c) => c.id === dragId);
    const where = group.children.length === 1 ? "" : between(group.children[at - 1]?.name, group.children[at + 1]?.name);
    return `${where ? `${where} ` : ""}(زیرمجموعهٔ «${group.top.name}»)`.trim();
  }
  const at = groups.findIndex((g) => g.top.id === dragId);
  return between(groups[at - 1]?.top.name, groups[at + 1]?.top.name);
}
