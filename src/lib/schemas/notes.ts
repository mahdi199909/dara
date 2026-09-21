// Shared between src/app/api/notes/**/route.ts (web) and src/local/repositories/notes.ts
// (on-device) so both validate identically.
import { z } from "zod";
import { dayKeySchema } from "@/lib/schemas/day";

export const NOTE_MAX_LENGTH = 5000;

const contentSchema = z.string().trim().min(1, "متن نوت خالی است.").max(NOTE_MAX_LENGTH, `نوت حداکثر ${NOTE_MAX_LENGTH} نویسه می‌تواند باشد.`);

export const createNoteSchema = z.object({ day: dayKeySchema, content: contentSchema });
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({ day: dayKeySchema.optional(), content: contentSchema.optional() });
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/** `?day=` for one day, or `?from=&to=` (both included) for a stretch of days; neither = every note. */
export const noteQuerySchema = z
  .object({ day: dayKeySchema.optional(), from: dayKeySchema.optional(), to: dayKeySchema.optional() })
  .refine((q) => !(q.day && (q.from || q.to)), { message: "روز یا بازه را مشخص کنید، نه هر دو." })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "ابتدای بازه نباید بعد از انتهای آن باشد." });
export type NoteQuery = z.infer<typeof noteQuerySchema>;

/** What both sides return for a note. */
export interface NoteDto {
  id: string;
  day: string;
  content: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}
