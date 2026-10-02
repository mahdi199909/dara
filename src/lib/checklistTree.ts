// The rules of the checklist tree, shared by the server's routes and the phone's repository so both
// answer the same way. Items are stored flat (id + parentId); a top-level item is a list.
//
// The one rule worth knowing: an item that has sub-items is ticked exactly when all of them are.
// Ticking it ticks everything below it; unticking it unticks everything below it; ticking or
// unticking an item moves every item above it to match its children.

export interface TreeRow {
  id: string;
  parentId: string | null;
  checked: boolean;
  sortOrder: number;
  createdAt: string | Date;
}

export interface TreeNode<T extends TreeRow> {
  item: T;
  children: TreeNode<T>[];
}

function time(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

/** Siblings in their saved order (oldest first when two share a place). */
export function compareSiblings(a: TreeRow, b: TreeRow): number {
  return a.sortOrder - b.sortOrder || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id);
}

function childrenIndex<T extends TreeRow>(rows: T[]): Map<string | null, T[]> {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    // An item whose parent is gone (deleted on another device before this one synced) shows as a list of its own.
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) list.sort(compareSiblings);
  return byParent;
}

/** The lists (top-level items), each with its items nested beneath it. */
export function buildTree<T extends TreeRow>(rows: T[]): TreeNode<T>[] {
  const byParent = childrenIndex(rows);
  const seen = new Set<string>();
  const build = (parent: string | null): TreeNode<T>[] =>
    (byParent.get(parent) ?? [])
      .filter((item) => !seen.has(item.id) && seen.add(item.id))
      .map((item) => ({ item, children: build(item.id) }));
  return build(null);
}

/** Every id under `id` (not including it). */
export function descendantIds(rows: TreeRow[], id: string): string[] {
  const byParent = childrenIndex(rows);
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>([id]);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** The ids above `id`, nearest first. */
export function ancestorIds(rows: TreeRow[], id: string): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current && byId.has(current) && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = byId.get(current)!.parentId;
  }
  return out;
}

/** The top-level list an item belongs to (itself when it is one). */
export function rootIdOf(rows: TreeRow[], id: string): string {
  const above = ancestorIds(rows, id);
  return above.length > 0 ? above[above.length - 1] : id;
}

/**
 * Which items change when `id` is ticked (`checked` true) or unticked: the item and everything below
 * it take the new state, then each item above it is ticked exactly when all its children are.
 * Returns only the items whose state actually changes.
 */
export function computeCheckChange(rows: TreeRow[], id: string, checked: boolean): { check: string[]; uncheck: string[] } {
  const state = new Map(rows.map((r) => [r.id, r.checked]));
  if (!state.has(id)) return { check: [], uncheck: [] };
  const byParent = childrenIndex(rows);
  for (const target of [id, ...descendantIds(rows, id)]) state.set(target, checked);
  for (const parent of ancestorIds(rows, id)) {
    const children = byParent.get(parent) ?? [];
    state.set(parent, children.length > 0 && children.every((c) => state.get(c.id)));
  }
  const check: string[] = [];
  const uncheck: string[] = [];
  for (const row of rows) {
    const next = state.get(row.id)!;
    if (next !== row.checked) (next ? check : uncheck).push(row.id);
  }
  return { check, uncheck };
}

/**
 * After an item was added under `id`, or one of its children deleted: `id` and every item above it
 * that has children is ticked exactly when all its children are. Items without children keep their state.
 */
export function computeRecheck(rows: TreeRow[], id: string): { check: string[]; uncheck: string[] } {
  const byParent = childrenIndex(rows);
  const state = new Map(rows.map((r) => [r.id, r.checked]));
  if (!state.has(id)) return { check: [], uncheck: [] };
  for (const node of [id, ...ancestorIds(rows, id)]) {
    const children = byParent.get(node) ?? [];
    if (children.length > 0) state.set(node, children.every((c) => state.get(c.id)));
  }
  const check: string[] = [];
  const uncheck: string[] = [];
  for (const row of rows) {
    const next = state.get(row.id)!;
    if (next !== row.checked) (next ? check : uncheck).push(row.id);
  }
  return { check, uncheck };
}

/** Ticked / all among the items under `id` that have no sub-items of their own (the actual things to do). */
export function progressOf(rows: TreeRow[], id: string): { done: number; total: number } {
  const byParent = childrenIndex(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let done = 0;
  let total = 0;
  for (const d of descendantIds(rows, id)) {
    if ((byParent.get(d) ?? []).length > 0) continue;
    total++;
    if (byId.get(d)!.checked) done++;
  }
  return { done, total };
}

/**
 * The new sortOrder of every sibling after moving `id` one place up or down — the whole group is
 * renumbered 0..n-1 so items created with the same order (two devices) get distinct places.
 */
export function computeMove(rows: TreeRow[], id: string, direction: "UP" | "DOWN"): Array<{ id: string; sortOrder: number }> {
  const index = siblingsOf(rows, id).findIndex((s) => s.id === id);
  return index < 0 ? [] : computeMoveTo(rows, id, direction === "UP" ? index - 1 : index + 1);
}

function siblingsOf(rows: TreeRow[], id: string): TreeRow[] {
  const row = rows.find((r) => r.id === id);
  if (!row) return [];
  const ids = new Set(rows.map((r) => r.id));
  const parentOf = (r: TreeRow) => (r.parentId && ids.has(r.parentId) ? r.parentId : null);
  return rows.filter((r) => parentOf(r) === parentOf(row)).sort(compareSiblings);
}

/**
 * Dragging: the item takes place `position` (0 = first) among its siblings; the whole group is
 * renumbered 0..n-1. Out-of-range positions are clamped; the same place changes nothing.
 */
export function computeMoveTo(rows: TreeRow[], id: string, position: number): Array<{ id: string; sortOrder: number }> {
  const siblings = siblingsOf(rows, id);
  const index = siblings.findIndex((s) => s.id === id);
  if (index < 0) return [];
  const target = Math.max(0, Math.min(siblings.length - 1, Math.round(position)));
  if (target === index) return [];
  const [moved] = siblings.splice(index, 1);
  siblings.splice(target, 0, moved);
  return siblings.map((s, i) => ({ id: s.id, sortOrder: i })).filter((s) => rows.find((r) => r.id === s.id)!.sortOrder !== s.sortOrder);
}

/** The place a new item takes among `parentId`'s children: after the last one. */
export function nextSortOrder(rows: TreeRow[], parentId: string | null): number {
  const siblings = rows.filter((r) => (r.parentId ?? null) === parentId);
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.sortOrder)) + 1;
}
