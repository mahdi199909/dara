// On-device port of src/app/api/export/[entity]/route.ts. Returns the CSV as a plain string
// (not an HTTP Response with Content-Disposition, since there's no download prompt on
// Android the same way — actually saving/sharing this string as a file on-device is a native
// Capacitor Filesystem/Share concern, deferred to Phase 6's packaging work; this function's
// job stops at "produce the correct CSV text," which is the part worth testing now).
import { ApiError } from "@/lib/apiErrorBase";
import { toCsv } from "@/lib/csv";
import { formatJalali } from "@/lib/jalali";
import type { LocalDb } from "../db";
import { fetchByIds } from "../relations";

export type ExportEntity = "tasks" | "activities" | "transactions" | "assets";

export function exportCsv(db: LocalDb, userId: string, entity: string): { csv: string; filename: string } {
  switch (entity as ExportEntity) {
    case "tasks": {
      const tasks = db.all<{ title: string; status: string; categoryId: string | null; projectId: string | null; dueDate: string | null; completedAt: string | null }>(
        `SELECT "title","status","categoryId","projectId","dueDate","completedAt" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`,
        [userId]
      );
      const categoryById = fetchByIds<{ id: string; name: string }>(db, "Category", tasks.map((t) => t.categoryId));
      const projectById = fetchByIds<{ id: string; name: string }>(db, "Project", tasks.map((t) => t.projectId));
      const csv = toCsv(
        tasks.map((t) => ({
          title: t.title,
          status: t.status,
          category: (t.categoryId && categoryById.get(t.categoryId)?.name) ?? "",
          project: (t.projectId && projectById.get(t.projectId)?.name) ?? "",
          dueDate: t.dueDate ? formatJalali(new Date(t.dueDate)) : "",
          completedAt: t.completedAt ? formatJalali(new Date(t.completedAt)) : "",
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
      return { csv, filename: "tasks.csv" };
    }
    case "activities": {
      const activities = db.all<{ title: string; categoryId: string | null; projectId: string | null; totalDurationMin: number; directCost: number; createdAt: string }>(
        `SELECT "title","categoryId","projectId","totalDurationMin","directCost","createdAt" FROM "Activity" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`,
        [userId]
      );
      const categoryById = fetchByIds<{ id: string; name: string }>(db, "Category", activities.map((a) => a.categoryId));
      const projectById = fetchByIds<{ id: string; name: string }>(db, "Project", activities.map((a) => a.projectId));
      const csv = toCsv(
        activities.map((a) => ({
          title: a.title,
          category: (a.categoryId && categoryById.get(a.categoryId)?.name) ?? "",
          project: (a.projectId && projectById.get(a.projectId)?.name) ?? "",
          durationMin: a.totalDurationMin,
          directCost: a.directCost,
          date: formatJalali(new Date(a.createdAt)),
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
      return { csv, filename: "activities.csv" };
    }
    case "transactions": {
      const transactions = db.all<{ type: string; amount: number; accountId: string; categoryId: string | null; description: string | null; date: string }>(
        `SELECT "type","amount","accountId","categoryId","description","date" FROM "Transaction" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "date" DESC`,
        [userId]
      );
      const categoryById = fetchByIds<{ id: string; name: string }>(db, "Category", transactions.map((t) => t.categoryId));
      const accountById = fetchByIds<{ id: string; name: string }>(db, "FinanceAccount", transactions.map((t) => t.accountId));
      const csv = toCsv(
        transactions.map((t) => ({
          type: t.type,
          amount: t.amount,
          account: accountById.get(t.accountId)?.name ?? "",
          category: (t.categoryId && categoryById.get(t.categoryId)?.name) ?? "",
          description: t.description ?? "",
          date: formatJalali(new Date(t.date)),
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
      return { csv, filename: "transactions.csv" };
    }
    case "assets": {
      const assets = db.all<{ name: string; category: string | null; purchasePrice: number; currentValue: number; purchaseDate: string }>(
        `SELECT "name","category","purchasePrice","currentValue","purchaseDate" FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`,
        [userId]
      );
      const csv = toCsv(
        assets.map((a) => ({
          name: a.name,
          category: a.category ?? "",
          purchasePrice: a.purchasePrice,
          currentValue: a.currentValue,
          purchaseDate: formatJalali(new Date(a.purchaseDate)),
        })),
        [
          { key: "name", header: "نام" },
          { key: "category", header: "دسته‌بندی" },
          { key: "purchasePrice", header: "قیمت خرید" },
          { key: "currentValue", header: "ارزش فعلی" },
          { key: "purchaseDate", header: "تاریخ خرید" },
        ]
      );
      return { csv, filename: "assets.csv" };
    }
    default:
      throw new ApiError("نوع خروجی پشتیبانی نمی‌شود.", 400);
  }
}
