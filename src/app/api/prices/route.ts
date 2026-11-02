import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/apiError";
import { clientIp } from "@/lib/clientIp";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { getPrices } from "@/lib/priceFeed";
import { LIMITS, hitLimits } from "@/lib/rateLimit";
import { getLogger } from "@/lib/observability/root";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const log = getLogger("prices", "route");

// Public on purpose (see PUBLIC_API_PATHS in src/middleware.ts): the asset basket asks this from the Android app too,
// including a phone that never signed in. It carries market prices only — nothing about any person — and answers
// from the server's own cache (src/lib/priceFeed.ts), so it never costs the market site a request per visitor.
export async function OPTIONS() {
  return corsPreflight();
}

async function GET(req: NextRequest) {
  try {
    const limit = hitLimits([[`prices:ip:${clientIp(req) ?? "unknown"}`, LIMITS.pricesPerIp]]);
    if (!limit.allowed) {
      log.warn("PRICE_RATE_LIMITED", { errorCode: "PRICE-002" });
      throw new ApiError("درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.", 429, "PRICE-002");
    }
    const prices = await getPrices();
    if (!prices) throw new ApiError("قیمت‌ها فعلاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.", 503, "PRICE-001");
    return withCors(NextResponse.json(prices, { headers: { "Cache-Control": "no-store" } }));
  } catch (err) {
    // The app reads this from another origin, so even an error needs the CORS headers or it looks like "offline".
    return withCors(handleApiError(err));
  }
}

const loggedGET = withApiLogging("GET", "/api/prices", GET);
export { loggedGET as GET };
