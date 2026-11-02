// Shared between src/app/api/basket/**/route.ts (web) and src/local/repositories/basket.ts (on-device) so both
// validate identically, and by the page for what /api/prices answers.
import { z } from "zod";
import { BASKET_ASSET_IDS } from "@/lib/basketCatalog";
import { BASKET_RANGES, MAX_BASKET_QUANTITY } from "@/lib/basket";

/** What the API answers when something is wrong — the same words on the web server and on the phone. */
export const BASKET_MESSAGES = {
  notFound: "این دارایی در سبد شما پیدا نشد.",
  alreadyInBasket: "این دارایی از قبل در سبد شما هست؛ مقدارش را ویرایش کنید.",
} as const;

const assetKey = z.enum(BASKET_ASSET_IDS, { message: "این دارایی در فهرست سبد نیست." });
const quantity = z
  .number({ message: "مقدار باید عدد باشد." })
  .finite("مقدار باید عدد باشد.")
  .positive("مقدار باید بیشتر از صفر باشد.")
  .max(MAX_BASKET_QUANTITY, "مقدار بیش از حد بزرگ است.");
const note = z.string().trim().max(200, "یادداشت حداکثر ۲۰۰ نویسه می‌تواند باشد.").nullable().optional();

export const createBasketHoldingSchema = z.object({ assetKey, quantity, note });
export type CreateBasketHoldingInput = z.infer<typeof createBasketHoldingSchema>;

// The asset itself cannot change: that is a different holding (delete this one, add the other).
export const updateBasketHoldingSchema = z.object({ quantity: quantity.optional(), note });
export type UpdateBasketHoldingInput = z.infer<typeof updateBasketHoldingSchema>;

/** Toman for one unit, by asset id — what the page hands over when it records the day's value. */
const priceMap = z
  .record(z.string().max(40), z.number().finite().positive().max(1e13))
  .refine((map) => Object.keys(map).length <= 100, "تعداد قیمت‌ها بیش از حد است.");

export const recordBasketSnapshotSchema = z.object({ prices: priceMap });
export type RecordBasketSnapshotInput = z.infer<typeof recordBasketSnapshotSchema>;

export const basketRangeSchema = z.enum(BASKET_RANGES).default("1m");

/** A holding as both sides return it. */
export interface BasketHoldingDto {
  id: string;
  assetKey: string;
  quantity: number;
  note: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** One day on the value chart. */
export interface BasketPointDto {
  date: string;
  totalValue: number;
}

/** What GET /api/prices answers (the server's own cached copy of the market; it holds nothing personal). */
export const pricesResponseSchema = z.object({
  prices: z.record(z.string(), z.number().finite().positive()),
  /** When the server last read the market. */
  fetchedAt: z.string(),
  /** How old that is as the server sees it — the phone's own clock is not trusted for this. */
  ageSeconds: z.number().min(0),
  source: z.string(),
});
export type PricesResponse = z.infer<typeof pricesResponseSchema>;
