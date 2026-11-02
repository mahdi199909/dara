// Shared between src/app/api/vision/**/route.ts (web) and src/local/repositories/vision.ts (on-device)
// so both validate identically.
import { z } from "zod";

export const VISION_STATUSES = ["ACTIVE", "ACHIEVED", "ARCHIVED"] as const;
export type VisionStatus = (typeof VISION_STATUSES)[number];
export const VISION_STATUS_LABELS: Record<VisionStatus, string> = { ACTIVE: "در مسیر", ACHIEVED: "محقق شد", ARCHIVED: "بایگانی" };

/**
 * How the progress entries of an item with a yardstick are read.
 * ADD: every entry is added to the starting value (grams of gold bought, pages read).
 * SET: the latest entry IS the current value (body weight, a savings balance).
 */
export const VISION_MODES = ["ADD", "SET"] as const;
export type VisionMode = (typeof VISION_MODES)[number];
export const VISION_MODE_LABELS: Record<VisionMode, string> = { ADD: "جمع می‌شود", SET: "آخرین مقدار" };

/** The colours a vision/goal can take (the first is the app's accent). */
export const VISION_COLORS = ["#3a8d80", "#c9a227", "#b0584a", "#5b7bd5", "#8a6ad9", "#d0709b", "#6a9b3e", "#d9843b"] as const;

/** What the API answers when something is wrong — the same words on the web server and on the phone. */
export const VISION_MESSAGES = {
  notFound: "این مورد در ویژن‌برد پیدا نشد.",
  entryNotFound: "این ثبت پیدا نشد.",
  projectNotFound: "پروژه پیدا نشد.",
  parentMustBeVision: "یک هدف را نمی‌شود زیر هدفِ دیگر گذاشت؛ آن را زیر یک ویژن بگذارید.",
  hasGoals: "این ویژن هدف‌های زیرمجموعه دارد و نمی‌تواند خودش زیرِ ویژنِ دیگری برود.",
} as const;

/** Wide enough for money in Toman (see MAX_MONEY_TOMAN), narrow enough that a typo cannot reach 1e300. */
const amount = z.number().finite().min(-1e15).max(1e15);
const title = z.string().trim().min(1, "عنوان خالی است.").max(120, "عنوان حداکثر ۱۲۰ نویسه می‌تواند باشد.");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "رنگ نامعتبر است.");

export const createVisionItemSchema = z.object({
  // A goal sits under a vision; leave it out for a vision. One level only (see assertParent in the repositories).
  parentId: z.string().nullable().optional(),
  title,
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
  color: color.optional(),
  // The person's own yardstick — all optional, so a vision can be plain words.
  unit: z.string().trim().max(40).nullable().optional(),
  startValue: amount.optional(),
  targetValue: amount.nullable().optional(),
  mode: z.enum(VISION_MODES).optional(),
  targetDate: z.string().datetime().nullable().optional(),
});
export type CreateVisionItemInput = z.infer<typeof createVisionItemSchema>;

export const updateVisionItemSchema = createVisionItemSchema.partial().extend({
  status: z.enum(VISION_STATUSES).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
export type UpdateVisionItemInput = z.infer<typeof updateVisionItemSchema>;

export const createVisionEntrySchema = z.object({
  value: amount,
  date: z.string().datetime().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CreateVisionEntryInput = z.infer<typeof createVisionEntrySchema>;

export const linkVisionProjectSchema = z.object({ projectId: z.string().min(1, "پروژه انتخاب نشده است.") });
export type LinkVisionProjectInput = z.infer<typeof linkVisionProjectSchema>;

/** A task's contribution toward a goal (e.g. 2 = two grams of gold), as accepted when a task is created or edited. */
export const visionAmount = amount;

/** What both sides return for a vision item, with its progress already worked out. */
export interface VisionItemDto {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  icon: string | null;
  color: string;
  status: VisionStatus;
  sortOrder: number;
  unit: string | null;
  startValue: number;
  targetValue: number | null;
  mode: VisionMode;
  targetDate: string | Date | null;
  achievedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** The yardstick's current value; null when the item has no target to measure against. */
  current: number | null;
  /** 0..1. From the yardstick when there is one, otherwise the average of the goals and projects under it; null when there is nothing to measure. */
  ratio: number | null;
  /** Hand-typed entries plus finished tasks that count toward it. */
  entryCount: number;
}

/** One line of a goal's history: something typed in by hand, or a finished task that counts toward it. */
export interface VisionEntryView {
  /** The VisionEntry id; null for a task. */
  id: string | null;
  kind: "MANUAL" | "TASK";
  value: number;
  date: string | Date;
  note: string | null;
  taskId: string | null;
  /** The task's title. */
  title: string | null;
}

/** A project linked to a goal, with how far its tasks have got. */
export interface VisionProjectView {
  id: string;
  name: string;
  status: string;
  color: string;
  taskTotal: number;
  taskDone: number;
}

export interface VisionDetailDto {
  item: VisionItemDto;
  entries: VisionEntryView[];
  projects: VisionProjectView[];
}
