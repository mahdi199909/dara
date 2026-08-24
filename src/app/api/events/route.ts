import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { expandOccurrences } from "@/lib/recurrence";
import { syncEventDirectCostTransaction, syncEventIncomeTransaction } from "@/lib/directCostSync";
import { RECURRENCE_FREQS, VALUE_TYPES } from "@/lib/types";

const createSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    allDay: z.boolean().optional(),
    location: z.string().max(200).optional(),
    categoryId: z.string().optional(),
    projectId: z.string().optional(),
    valueType: z.enum(VALUE_TYPES).optional(),
    directCost: z.number().int().min(0).optional(),
    incomeAmount: z.number().int().min(0).optional(),
    recurrenceFreq: z.enum(RECURRENCE_FREQS).optional(),
    recurrenceInterval: z.number().int().min(1).optional(),
    recurrenceUntil: z.string().datetime().nullable().optional(),
    recurrenceCount: z.number().int().min(1).max(500).nullable().optional(),
    reminderOffsets: z.array(z.number().int().min(0)).optional(),
  })
  .refine((b) => !(b.recurrenceUntil && b.recurrenceCount), {
    message: "پایان تکرار را یا با تاریخ یا با تعداد مشخص کنید، نه هر دو.",
  });

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!from || !to) {
      const events = await prisma.event.findMany({
        where: { userId, deletedAt: null },
        include: { category: true, reminders: true },
        orderBy: { startAt: "asc" },
      });
      return NextResponse.json({ events, occurrences: [], taskOccurrences: [] });
    }

    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);

    const [events, tasks] = await Promise.all([
      prisma.event.findMany({
        where: { userId, deletedAt: null, recurrenceParentId: null },
        include: { category: true, project: true, reminders: true },
      }),
      prisma.task.findMany({
        where: { userId, deletedAt: null, dueDate: { gte: rangeStart, lte: rangeEnd } },
        include: { category: true, project: true },
        orderBy: { dueDate: "asc" },
      }),
    ]);

    const completions = events.length
      ? await prisma.eventCompletion.findMany({
          where: { eventId: { in: events.map((e) => e.id) }, occurrenceDate: { gte: rangeStart, lte: rangeEnd } },
        })
      : [];
    const completedSet = new Set(completions.map((c) => `${c.eventId}|${c.occurrenceDate.getTime()}`));

    const occurrences = events.flatMap((event) =>
      expandOccurrences(event, rangeStart, rangeEnd).map((occ) => ({
        ...occ,
        event,
        isDone: completedSet.has(`${event.id}|${occ.startAt.getTime()}`),
      }))
    );

    occurrences.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    return NextResponse.json({ occurrences, taskOccurrences: tasks });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);

    const event = await prisma.event.create({
      data: {
        userId,
        title: body.title,
        description: body.description,
        startAt,
        endAt,
        allDay: body.allDay ?? false,
        location: body.location,
        categoryId: body.categoryId,
        projectId: body.projectId,
        valueType: body.valueType,
        directCost: body.directCost ?? 0,
        incomeAmount: body.incomeAmount ?? 0,
        recurrenceFreq: body.recurrenceFreq ?? "NONE",
        recurrenceInterval: body.recurrenceInterval ?? 1,
        recurrenceUntil: body.recurrenceUntil ? new Date(body.recurrenceUntil) : undefined,
        recurrenceCount: body.recurrenceCount,
      },
    });

    if (event.directCost > 0) await syncEventDirectCostTransaction(event.id);
    if (event.incomeAmount > 0) await syncEventIncomeTransaction(event.id);

    if (body.reminderOffsets?.length) {
      await prisma.reminder.createMany({
        data: body.reminderOffsets.map((offsetMinutes) => ({
          userId,
          targetType: "EVENT",
          eventId: event.id,
          title: `یادآوری: ${event.title}`,
          offsetMinutes,
          remindAt: new Date(startAt.getTime() - offsetMinutes * 60000),
        })),
      });
    }

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Event",
      entityId: event.id,
      newValue: event,
      ipAddress,
      userAgent,
    });

    const fresh = await prisma.event.findUnique({ where: { id: event.id }, include: { reminders: true } });
    return NextResponse.json({ event: fresh }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
