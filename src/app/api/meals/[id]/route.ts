import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateMealSchema } from "@/lib/schemas/meals";
import { deleteMeal, getOwnedMeal, updateMeal } from "@/lib/mealsServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedMeal(userId, params.id);
    const body = updateMealSchema.parse(await req.json());
    const meal = await withTransaction(async () => updateMeal(userId, params.id, body), { operation: "MEAL_UPDATE", entityType: "MealEntry", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "MealEntry", entityId: params.id, oldValue: existing, newValue: meal, ipAddress, userAgent });

    return NextResponse.json({ meal });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedMeal(userId, params.id);
    const result = await withTransaction(async () => deleteMeal(userId, params.id), { operation: "MEAL_DELETE", entityType: "MealEntry", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "MealEntry", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/meals/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/meals/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
