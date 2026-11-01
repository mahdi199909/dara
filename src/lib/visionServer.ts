// The server's vision-board reads and writes, used by src/app/api/vision/**/route.ts and by the task routes
// (a task can count toward a goal). The phone's twin is src/local/repositories/vision.ts — same validation,
// same order, same 404 messages; the progress itself is worked out by src/lib/vision.ts on both sides.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/apiError";
import {
  computeVisionItems,
  contributionsOf,
  type VisionEntryRow,
  type VisionItemRow,
  type VisionProjectRow,
  type VisionTaskRow,
} from "@/lib/vision";
import {
  VISION_MESSAGES,
  type CreateVisionEntryInput,
  type CreateVisionItemInput,
  type UpdateVisionItemInput,
  type VisionDetailDto,
  type VisionEntryView,
  type VisionItemDto,
  type VisionProjectView,
} from "@/lib/schemas/vision";

const VISION_NOT_FOUND = VISION_MESSAGES.notFound;
const VISION_ENTRY_NOT_FOUND = VISION_MESSAGES.entryNotFound;
const VISION_PROJECT_NOT_FOUND = VISION_MESSAGES.projectNotFound;
const VISION_PARENT_MUST_BE_VISION = VISION_MESSAGES.parentMustBeVision;
const VISION_HAS_GOALS = VISION_MESSAGES.hasGoals;

interface LinkedProject extends VisionProjectView {
  visionItemId: string;
}

async function readLinkedProjects(userId: string): Promise<LinkedProject[]> {
  const projects = await prisma.project.findMany({
    where: { userId, deletedAt: null, visionItemId: { not: null } },
    select: { id: true, name: true, status: true, color: true, visionItemId: true },
  });
  if (projects.length === 0) return [];
  const tasks = await prisma.task.findMany({
    where: { userId, deletedAt: null, projectId: { in: projects.map((p) => p.id) } },
    select: { projectId: true, status: true },
  });
  return projects.map((p) => {
    const own = tasks.filter((t) => t.projectId === p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      color: p.color,
      visionItemId: p.visionItemId as string,
      taskTotal: own.length,
      taskDone: own.filter((t) => t.status === "DONE").length,
    };
  });
}

async function readAll(userId: string) {
  const [items, entries, tasks, projects] = await Promise.all([
    prisma.visionItem.findMany({ where: { userId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.visionEntry.findMany({ where: { userId, deletedAt: null } }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: "DONE", visionItemId: { not: null } },
      select: { id: true, title: true, visionItemId: true, visionValue: true, completedAt: true, dueDate: true, createdAt: true },
    }),
    readLinkedProjects(userId),
  ]);
  const itemRows: VisionItemRow[] = items;
  const entryRows: VisionEntryRow[] = entries;
  const taskRows: VisionTaskRow[] = tasks.map((t) => ({ ...t, visionItemId: t.visionItemId as string }));
  const projectRows: VisionProjectRow[] = projects.map((p) => ({ id: p.id, visionItemId: p.visionItemId, taskTotal: p.taskTotal, taskDone: p.taskDone }));
  return { itemRows, entryRows, taskRows, projects, projectRows };
}

export async function getOwnedVisionItem(userId: string, id: string) {
  const item = await prisma.visionItem.findFirst({ where: { id, userId, deletedAt: null } });
  if (!item) throw new ApiError(VISION_NOT_FOUND, 404);
  return item;
}

/** A task may only be linked to one of this person's own goals. */
export async function assertVisionItemOwned(userId: string, visionItemId: string): Promise<void> {
  await getOwnedVisionItem(userId, visionItemId);
}

/** Every vision and goal with its progress worked out, in the person's own order. */
export async function listVision(userId: string): Promise<VisionItemDto[]> {
  const all = await readAll(userId);
  return computeVisionItems(all.itemRows, all.entryRows, all.taskRows, all.projectRows);
}

async function oneVisionDto(userId: string, id: string): Promise<VisionItemDto> {
  const found = (await listVision(userId)).find((i) => i.id === id);
  if (!found) throw new ApiError(VISION_NOT_FOUND, 404);
  return found;
}

export async function getVisionDetail(userId: string, id: string): Promise<VisionDetailDto> {
  await getOwnedVisionItem(userId, id);
  const all = await readAll(userId);
  const item = computeVisionItems(all.itemRows, all.entryRows, all.taskRows, all.projectRows).find((i) => i.id === id)!;
  return {
    item,
    entries: contributionsOf(id, all.entryRows, all.taskRows),
    projects: all.projects.filter((p) => p.visionItemId === id).map(({ visionItemId: _unused, ...view }) => view),
  };
}

/** One level only: a goal goes under a vision, and a vision that has goals cannot itself go under another. */
async function assertParent(userId: string, parentId: string | null, selfId: string | null): Promise<void> {
  if (parentId === null) return;
  if (parentId === selfId) throw new ApiError(VISION_PARENT_MUST_BE_VISION, 400);
  const parent = await prisma.visionItem.findFirst({ where: { id: parentId, userId, deletedAt: null } });
  if (!parent) throw new ApiError(VISION_NOT_FOUND, 404);
  if (parent.parentId !== null) throw new ApiError(VISION_PARENT_MUST_BE_VISION, 400);
  if (selfId) {
    const hasGoals = await prisma.visionItem.count({ where: { userId, parentId: selfId, deletedAt: null } });
    if (hasGoals > 0) throw new ApiError(VISION_HAS_GOALS, 400);
  }
}

export async function createVisionItem(userId: string, input: CreateVisionItemInput): Promise<VisionItemDto> {
  const parentId = input.parentId ?? null;
  await assertParent(userId, parentId, null);
  const last = await prisma.visionItem.aggregate({ where: { userId, deletedAt: null, parentId }, _max: { sortOrder: true } });
  const created = await prisma.visionItem.create({
    data: {
      userId,
      parentId,
      title: input.title,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? "#3a8d80",
      unit: input.unit ?? null,
      startValue: input.startValue ?? 0,
      targetValue: input.targetValue ?? null,
      mode: input.mode ?? "ADD",
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });
  return oneVisionDto(userId, created.id);
}

export async function updateVisionItem(userId: string, id: string, input: UpdateVisionItemInput): Promise<VisionItemDto> {
  const existing = await getOwnedVisionItem(userId, id);
  if (input.parentId !== undefined) await assertParent(userId, input.parentId, id);

  await prisma.visionItem.update({
    where: { id },
    data: {
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.startValue !== undefined ? { startValue: input.startValue } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate ? new Date(input.targetDate) : null } : {}),
      ...(input.status !== undefined && input.status !== existing.status
        ? { status: input.status, achievedAt: input.status === "ACHIEVED" ? new Date() : null }
        : {}),
    },
  });
  return oneVisionDto(userId, id);
}

/** Deleting a vision takes its goals with it; the tasks and projects that pointed at any of them are simply unlinked. */
export async function deleteVisionItem(userId: string, id: string): Promise<{ ok: true }> {
  await getOwnedVisionItem(userId, id);
  const goals = await prisma.visionItem.findMany({ where: { userId, parentId: id, deletedAt: null }, select: { id: true } });
  const ids = [id, ...goals.map((g) => g.id)];
  const now = new Date();
  await prisma.visionItem.updateMany({ where: { userId, id: { in: ids } }, data: { deletedAt: now, updatedAt: now } });
  await prisma.visionEntry.updateMany({ where: { userId, itemId: { in: ids }, deletedAt: null }, data: { deletedAt: now, updatedAt: now } });
  await prisma.task.updateMany({ where: { userId, visionItemId: { in: ids } }, data: { visionItemId: null, visionValue: null, updatedAt: now } });
  await prisma.project.updateMany({ where: { userId, visionItemId: { in: ids } }, data: { visionItemId: null, updatedAt: now } });
  return { ok: true };
}

function entryView(row: { id: string; value: number; date: Date; note: string | null }): VisionEntryView {
  return { id: row.id, kind: "MANUAL", value: row.value, date: row.date, note: row.note, taskId: null, title: null };
}

export async function addVisionEntry(userId: string, id: string, input: CreateVisionEntryInput): Promise<VisionEntryView> {
  await getOwnedVisionItem(userId, id);
  const entry = await prisma.visionEntry.create({
    data: { userId, itemId: id, value: input.value, date: input.date ? new Date(input.date) : new Date(), note: input.note ?? null },
  });
  return entryView(entry);
}

export async function getOwnedVisionEntry(userId: string, id: string, entryId: string) {
  const entry = await prisma.visionEntry.findFirst({ where: { id: entryId, itemId: id, userId, deletedAt: null } });
  if (!entry) throw new ApiError(VISION_ENTRY_NOT_FOUND, 404);
  return entry;
}

export async function deleteVisionEntry(userId: string, id: string, entryId: string): Promise<{ ok: true }> {
  await getOwnedVisionEntry(userId, id, entryId);
  const now = new Date();
  await prisma.visionEntry.update({ where: { id: entryId }, data: { deletedAt: now } });
  return { ok: true };
}

/** Puts an existing project under a goal. Returns the project as it was and as it is now (for the history entry). */
export async function linkVisionProject(userId: string, id: string, projectId: string) {
  await getOwnedVisionItem(userId, id);
  const before = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null } });
  if (!before) throw new ApiError(VISION_PROJECT_NOT_FOUND, 404);
  const after = await prisma.project.update({ where: { id: projectId }, data: { visionItemId: id } });
  return { before, after };
}

export async function unlinkVisionProject(userId: string, id: string, projectId: string) {
  await getOwnedVisionItem(userId, id);
  const before = await prisma.project.findFirst({ where: { id: projectId, userId, visionItemId: id, deletedAt: null } });
  if (!before) throw new ApiError(VISION_PROJECT_NOT_FOUND, 404);
  const after = await prisma.project.update({ where: { id: projectId }, data: { visionItemId: null } });
  return { before, after };
}
