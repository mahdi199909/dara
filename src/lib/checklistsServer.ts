// The server's checklist writes, used by src/app/api/checklists/**/route.ts. The phone's twin is
// src/local/repositories/checklists.ts; both follow the rules in src/lib/checklistTree.ts.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/apiError";
import { computeCheckChange, computeMove, computeMoveTo, computeRecheck, descendantIds, nextSortOrder, type TreeRow } from "@/lib/checklistTree";
import { planningColumns, resolveTreeRules } from "@/lib/checklistPlanning";
import type { ChecklistItemDto, ChecklistTreeNode, CreateChecklistItemInput, CreateChecklistItemsInput, CreateChecklistTreeInput, UpdateChecklistItemInput } from "@/lib/schemas/checklists";

const SELECT = {
  id: true,
  parentId: true,
  title: true,
  note: true,
  checked: true,
  checkedAt: true,
  sortOrder: true,
  durationMin: true,
  depType: true,
  depItemId: true,
  lagMin: true,
  linkedType: true,
  linkedId: true,
  linkedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const CHECKLIST_NOT_FOUND = "مورد چک‌لیست پیدا نشد.";

export async function listChecklistItems(userId: string): Promise<ChecklistItemDto[]> {
  return prisma.checklistItem.findMany({ where: { userId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: SELECT });
}

export async function getOwnedChecklistItem(userId: string, id: string) {
  const item = await prisma.checklistItem.findFirst({ where: { id, userId, deletedAt: null } });
  if (!item) throw new ApiError(CHECKLIST_NOT_FOUND, 404);
  return item;
}

async function treeRows(userId: string): Promise<TreeRow[]> {
  return prisma.checklistItem.findMany({ where: { userId, deletedAt: null }, select: { id: true, parentId: true, checked: true, sortOrder: true, createdAt: true } });
}

export async function createChecklistItem(userId: string, input: CreateChecklistItemInput): Promise<ChecklistItemDto> {
  const parentId = input.parentId ?? null;
  if (parentId) await getOwnedChecklistItem(userId, parentId);
  const rows = await treeRows(userId);
  const item = await prisma.checklistItem.create({
    data: { userId, parentId, title: input.title, note: input.note || null, sortOrder: nextSortOrder(rows, parentId) },
    select: SELECT,
  });
  // A new unticked item under a ticked one: the items above are no longer all done.
  if (parentId) await applyChange(computeRecheck(rows.concat({ ...item, checked: false }), parentId));
  return item;
}

export async function createChecklistItems(userId: string, input: CreateChecklistItemsInput): Promise<ChecklistItemDto[]> {
  await getOwnedChecklistItem(userId, input.parentId);
  const rows = await treeRows(userId);
  let order = nextSortOrder(rows, input.parentId);
  const created: ChecklistItemDto[] = [];
  for (const title of input.titles) {
    created.push(await prisma.checklistItem.create({ data: { userId, parentId: input.parentId, title, sortOrder: order++ }, select: SELECT }));
  }
  await applyChange(computeRecheck(rows.concat(created.map((c) => ({ ...c, checked: false }))), input.parentId));
  return created;
}

/** A whole nested list in one go (a ready-made checklist). Returns every created item, the top one first. */
export async function createChecklistTree(userId: string, input: CreateChecklistTreeInput): Promise<ChecklistItemDto[]> {
  const parentId = input.parentId ?? null;
  if (parentId) await getOwnedChecklistItem(userId, parentId);
  const rows = await treeRows(userId);
  const created: ChecklistItemDto[] = [];
  const named: { id: string; title: string; depType?: string | null; depTitle?: string | null }[] = [];
  const insert = async (node: ChecklistTreeNode, parent: string | null, sortOrder: number) => {
    const item = await prisma.checklistItem.create({
      data: { userId, parentId: parent, title: node.title, note: node.note || null, sortOrder, durationMin: node.durationMin ?? null, lagMin: node.lagMin ?? 0 },
      select: SELECT,
    });
    created.push(item);
    named.push({ id: item.id, title: node.title, depType: node.depType, depTitle: node.depTitle });
    let order = 0;
    for (const child of node.children ?? []) await insert(child, item.id, order++);
  };
  await insert(input.tree, parentId, nextSortOrder(rows, parentId));
  for (const rule of resolveTreeRules(named)) {
    const updated = await prisma.checklistItem.update({ where: { id: rule.id }, data: { depType: rule.depType, depItemId: rule.depItemId }, select: SELECT });
    created[created.findIndex((c) => c.id === rule.id)] = updated;
  }
  if (parentId) await applyChange(computeRecheck(await treeRows(userId), parentId));
  return created;
}

async function applyChange({ check, uncheck }: { check: string[]; uncheck: string[] }) {
  const at = new Date();
  if (check.length > 0) await prisma.checklistItem.updateMany({ where: { id: { in: check } }, data: { checked: true, checkedAt: at, updatedAt: at } });
  if (uncheck.length > 0) await prisma.checklistItem.updateMany({ where: { id: { in: uncheck } }, data: { checked: false, checkedAt: null, updatedAt: at } });
}

export async function updateChecklistItem(userId: string, id: string, input: UpdateChecklistItemInput): Promise<ChecklistItemDto> {
  await getOwnedChecklistItem(userId, id);
  const planning = planningColumns(await treeRows(userId), id, input, new Date());
  if (input.title !== undefined || input.note !== undefined || Object.keys(planning).length > 0) {
    await prisma.checklistItem.update({
      where: { id },
      data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.note !== undefined ? { note: input.note || null } : {}), ...planning },
    });
  }
  if (input.checked !== undefined) await applyChange(computeCheckChange(await treeRows(userId), id, input.checked));
  if (input.move || input.position !== undefined) {
    const at = new Date();
    const rows = await treeRows(userId);
    const changes = input.position !== undefined ? computeMoveTo(rows, id, input.position) : computeMove(rows, id, input.move!);
    for (const change of changes) {
      await prisma.checklistItem.update({ where: { id: change.id }, data: { sortOrder: change.sortOrder, updatedAt: at } });
    }
  }
  return prisma.checklistItem.findUniqueOrThrow({ where: { id }, select: SELECT });
}

/** Unticks the item and everything below it, so the list can be used again (a trip, a weekly routine). */
export async function resetChecklistItem(userId: string, id: string): Promise<{ reset: number }> {
  const existing = await getOwnedChecklistItem(userId, id);
  const rows = await treeRows(userId);
  const ids = [id, ...descendantIds(rows, id)].filter((target) => rows.find((r) => r.id === target)?.checked);
  if (ids.length > 0) await prisma.checklistItem.updateMany({ where: { id: { in: ids } }, data: { checked: false, checkedAt: null, updatedAt: new Date() } });
  // The items above it can no longer all be done.
  if (existing.parentId) await applyChange(computeRecheck(await treeRows(userId), existing.parentId));
  return { reset: ids.length };
}

/** Deletes the item with everything below it. Returns the ids that were deleted. */
export async function deleteChecklistItem(userId: string, id: string): Promise<string[]> {
  const existing = await getOwnedChecklistItem(userId, id);
  const rows = await treeRows(userId);
  const ids = [id, ...descendantIds(rows, id)];
  const at = new Date();
  await prisma.checklistItem.updateMany({ where: { id: { in: ids } }, data: { deletedAt: at, updatedAt: at } });
  // With it gone, the parent may now have only ticked children left.
  if (existing.parentId) await applyChange(computeRecheck(await treeRows(userId), existing.parentId));
  return ids;
}
