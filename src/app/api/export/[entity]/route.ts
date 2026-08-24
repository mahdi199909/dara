import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { toCsv } from "@/lib/csv";
import { formatJalali } from "@/lib/jalali";

export async function GET(_req: NextRequest, { params }: { params: { entity: string } }) {
  try {
    const userId = await requireUserId();

    let csv: string;
    let filename: string;

    switch (params.entity) {
      case "tasks": {
        const tasks = await prisma.task.findMany({
          where: { userId, deletedAt: null },
          include: { category: true, project: true },
          orderBy: { createdAt: "desc" },
        });
        csv = toCsv(
          tasks.map((t) => ({
            title: t.title,
            status: t.status,
            category: t.category?.name ?? "",
            project: t.project?.name ?? "",
            dueDate: t.dueDate ? formatJalali(t.dueDate) : "",
            completedAt: t.completedAt ? formatJalali(t.completedAt) : "",
          })),
          [
            { key: "title", header: "عنوان" },
            { key: "status", header: "وضعیت" },
            { key: "category", header: "دسته‌بندی" },
            { key: "project", header: "پروژه" },
            { key: "dueDate", header: "سررسید" },
            { key: "completedAt", header: "تاریخ انجام" },
          ]
        );
        filename = "tasks.csv";
        break;
      }
      case "activities": {
        const activities = await prisma.activity.findMany({
          where: { userId, deletedAt: null },
          include: { category: true, project: true },
          orderBy: { createdAt: "desc" },
        });
        csv = toCsv(
          activities.map((a) => ({
            title: a.title,
            category: a.category?.name ?? "",
            project: a.project?.name ?? "",
            durationMin: a.totalDurationMin,
            directCost: a.directCost,
            date: formatJalali(a.createdAt),
          })),
          [
            { key: "title", header: "عنوان" },
            { key: "category", header: "دسته‌بندی" },
            { key: "project", header: "پروژه" },
            { key: "durationMin", header: "مدت (دقیقه)" },
            { key: "directCost", header: "هزینه مستقیم" },
            { key: "date", header: "تاریخ" },
          ]
        );
        filename = "activities.csv";
        break;
      }
      case "transactions": {
        const transactions = await prisma.transaction.findMany({
          where: { userId, deletedAt: null },
          include: { category: true, account: true },
          orderBy: { date: "desc" },
        });
        csv = toCsv(
          transactions.map((t) => ({
            type: t.type,
            amount: t.amount,
            account: t.account.name,
            category: t.category?.name ?? "",
            description: t.description ?? "",
            date: formatJalali(t.date),
          })),
          [
            { key: "type", header: "نوع" },
            { key: "amount", header: "مبلغ" },
            { key: "account", header: "حساب" },
            { key: "category", header: "دسته‌بندی" },
            { key: "description", header: "توضیحات" },
            { key: "date", header: "تاریخ" },
          ]
        );
        filename = "transactions.csv";
        break;
      }
      case "assets": {
        const assets = await prisma.asset.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } });
        csv = toCsv(
          assets.map((a) => ({
            name: a.name,
            category: a.category ?? "",
            purchasePrice: a.purchasePrice,
            currentValue: a.currentValue,
            purchaseDate: formatJalali(a.purchaseDate),
          })),
          [
            { key: "name", header: "نام" },
            { key: "category", header: "دسته‌بندی" },
            { key: "purchasePrice", header: "قیمت خرید" },
            { key: "currentValue", header: "ارزش فعلی" },
            { key: "purchaseDate", header: "تاریخ خرید" },
          ]
        );
        filename = "assets.csv";
        break;
      }
      default:
        throw new ApiError("نوع خروجی پشتیبانی نمی‌شود.", 400);
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
