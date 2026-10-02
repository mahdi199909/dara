// The server's inbox reads and writes, used by src/app/api/inbox/**/route.ts. The phone's twin is
// src/local/repositories/inbox.ts — same validation, same order, same 404 message.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/apiError";
import type { CreateInboxItemInput, InboxDestination, InboxItemDto, InboxPriority, UpdateInboxItemInput } from "@/lib/schemas/inbox";

export const INBOX_NOT_FOUND = "این مورد در صندوق ورودی پیدا نشد.";

function toDto(row: { id: string; content: string; priority: number; createdAt: Date; updatedAt: Date }): InboxItemDto {
  return { id: row.id, content: row.content, priority: row.priority as InboxPriority, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** What is still waiting for a decision: most urgent first, then oldest first. */
export async function listInboxItems(userId: string): Promise<InboxItemDto[]> {
  const rows = await prisma.inboxItem.findMany({
    where: { userId, deletedAt: null, processedAt: null },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
}

export async function getOwnedInboxItem(userId: string, id: string) {
  const item = await prisma.inboxItem.findFirst({ where: { id, userId, deletedAt: null, processedAt: null } });
  if (!item) throw new ApiError(INBOX_NOT_FOUND, 404);
  return item;
}

export async function createInboxItem(userId: string, input: CreateInboxItemInput): Promise<InboxItemDto> {
  return toDto(await prisma.inboxItem.create({ data: { userId, content: input.content, priority: input.priority ?? 0 } }));
}

export async function updateInboxItem(userId: string, id: string, input: UpdateInboxItemInput): Promise<InboxItemDto> {
  await getOwnedInboxItem(userId, id);
  return toDto(
    await prisma.inboxItem.update({
      where: { id },
      data: { ...(input.content !== undefined ? { content: input.content } : {}), ...(input.priority !== undefined ? { priority: input.priority } : {}) },
    })
  );
}

/** The item was turned into something else (a task, an event…): it leaves the inbox for good. */
export async function processInboxItem(userId: string, id: string, to: InboxDestination): Promise<{ ok: true }> {
  await getOwnedInboxItem(userId, id);
  await prisma.inboxItem.update({ where: { id }, data: { processedAt: new Date(), processedTo: to } });
  return { ok: true };
}

export async function deleteInboxItem(userId: string, id: string): Promise<{ ok: true }> {
  await getOwnedInboxItem(userId, id);
  await prisma.inboxItem.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
