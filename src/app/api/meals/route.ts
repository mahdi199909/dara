import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createMealSchema, mealsRangeSchema } from "@/lib/schemas/meals";
import { createMeal, listMeals } from "@/lib/mealsServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

// The athlete's meals for a stretch of days: GET /api/meals?from=YYYY-MM-DD&to=YYYY-MM-DD.
async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const range = mealsRangeSchema.parse({ from: searchParams.get("from") ?? undefined, to: searchParams.get("to") ?? undefined });
    return NextResponse.json({ meals: await listMeals(userId, range) });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createMealSchema.parse(await req.json());
    const meal = await withTransaction(async () => createMeal(userId, body), { operation: "MEAL_CREATE", entityType: "MealEntry" });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "MealEntry", entityId: meal.id, newValue: meal, ipAddress, userAgent });

    return NextResponse.json({ meal }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/meals", GET);
const loggedPOST = withApiLogging("POST", "/api/meals", POST);
export { loggedGET as GET, loggedPOST as POST };
