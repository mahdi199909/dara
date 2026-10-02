// Shared between src/app/api/inbox/**/route.ts (web) and src/local/repositories/inbox.ts
// (on-device) so both validate identically.
import { z } from "zod";

export const INBOX_MAX_LENGTH = 5000;

/** 0 = عادی, 1 = مهم, 2 = فوری. Listed highest first. */
export const INBOX_PRIORITIES = [0, 1, 2] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];
export const INBOX_PRIORITY_LABELS: Record<InboxPriority, string> = { 0: "عادی", 1: "مهم", 2: "فوری" };

/** Where an item went when it was decided on. AUTO = read by smart capture (src/lib/captureIntent.ts), which decided what the line was. */
export const INBOX_DESTINATIONS = ["AUTO", "TASK", "EVENT", "TRANSACTION", "INSTALLMENT", "CHECKLIST", "NOTE", "HABIT"] as const;
export type InboxDestination = (typeof INBOX_DESTINATIONS)[number];

const contentSchema = z.string().trim().min(1, "متن خالی است.").max(INBOX_MAX_LENGTH, `متن حداکثر ${INBOX_MAX_LENGTH} نویسه می‌تواند باشد.`);
const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const createInboxItemSchema = z.object({ content: contentSchema, priority: prioritySchema.optional() });
export type CreateInboxItemInput = z.infer<typeof createInboxItemSchema>;

export const updateInboxItemSchema = z.object({ content: contentSchema.optional(), priority: prioritySchema.optional() });
export type UpdateInboxItemInput = z.infer<typeof updateInboxItemSchema>;

export const processInboxItemSchema = z.object({ to: z.enum(INBOX_DESTINATIONS) });
export type ProcessInboxItemInput = z.infer<typeof processInboxItemSchema>;

/** What both sides return for an item. */
export interface InboxItemDto {
  id: string;
  content: string;
  priority: InboxPriority;
  createdAt: string | Date;
  updatedAt: string | Date;
}
