import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createBudgetSchema } from "@/lib/schemas/budgets";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    const budgets = await prisma.budget.findMany({
      where: { userId, deletedAt: null },
      include: { category: { select: { id: true, name: true, icon: true, color: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ budgets });
  } catch (err) {
    return handleApiError(err);
  }
}

// One cap per category (Budget.categoryId is @unique) — POST is deliberately an upsert keyed on
// categoryId, not a plain create: "set the budget for این دسته to X" is the only thing anyone
// asks for, and a person raising an existing cap should never have to find and PATCH it by id
// first. A category already belonging to someone else can never collide here — findFirst below
// scopes the existing-row lookup to this same userId before deciding create vs. update.
async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createBudgetSchema.parse(await req.json());

    const category = await prisma.category.findFirst({ where: { id: body.categoryId, userId, deletedAt: null } });
    if (!category) throw new ApiError("دسته‌بندی پیدا نشد.", 404);

    const existing = await prisma.budget.findFirst({ where: { categoryId: body.categoryId, userId, deletedAt: null } });

    const budget = await withTransaction(
      async () =>
        existing
          ? prisma.budget.update({ where: { id: existing.id }, data: { monthlyCap: body.monthlyCap } })
          : prisma.budget.create({ data: { userId, categoryId: body.categoryId, monthlyCap: body.monthlyCap } }),
      { operation: existing ? "BUDGET_UPDATE" : "BUDGET_CREATE", entityType: "Budget", entityId: existing?.id }
    );

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "Budget",
      entityId: budget.id,
      oldValue: existing ?? undefined,
      newValue: budget,
      ipAddress,
      userAgent,
    });

    // Always 200, not 201-on-create/200-on-update: this route is an upsert (see the comment
    // above), and the local dispatcher's registration only carries one fixed status per route —
    // keeping the two identical matters more here than a strict-REST status code would.
    return NextResponse.json({ budget });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/budgets", GET);
const loggedPOST = withApiLogging("POST", "/api/budgets", POST);
export { loggedGET as GET, loggedPOST as POST };
