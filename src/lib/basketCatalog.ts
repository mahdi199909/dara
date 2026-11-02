// The assets a basket can hold: the main currencies and metals people here keep savings in. Shared by the page,
// the server's price feed and the phone, so an asset id means the same thing everywhere — it is what a holding
// stores. Which row of the price feed prices each id lives next to the feed (src/lib/priceFeed.ts), not here.
export type BasketKind = "CURRENCY" | "METAL";

export interface BasketAsset {
  id: string;
  name: string;
  kind: BasketKind;
  /** What one unit of the quantity is called: "دلار", "گرم", "عدد". */
  unit: string;
  icon: string;
}

export const BASKET_KIND_LABELS: Record<BasketKind, string> = { CURRENCY: "ارزها", METAL: "طلا، سکه و نقره" };

export const BASKET_ASSETS: readonly BasketAsset[] = [
  { id: "usd", name: "دلار آمریکا", kind: "CURRENCY", unit: "دلار", icon: "💵" },
  { id: "eur", name: "یورو", kind: "CURRENCY", unit: "یورو", icon: "💶" },
  { id: "gbp", name: "پوند انگلیس", kind: "CURRENCY", unit: "پوند", icon: "💷" },
  { id: "aed", name: "درهم امارات", kind: "CURRENCY", unit: "درهم", icon: "💱" },
  { id: "try", name: "لیر ترکیه", kind: "CURRENCY", unit: "لیر", icon: "💱" },
  { id: "gold18", name: "طلای ۱۸ عیار", kind: "METAL", unit: "گرم", icon: "🥇" },
  { id: "gold24", name: "طلای ۲۴ عیار", kind: "METAL", unit: "گرم", icon: "🥇" },
  { id: "coin_emami", name: "سکه امامی", kind: "METAL", unit: "عدد", icon: "🪙" },
  { id: "coin_bahar", name: "سکه بهار آزادی", kind: "METAL", unit: "عدد", icon: "🪙" },
  { id: "coin_half", name: "نیم‌سکه", kind: "METAL", unit: "عدد", icon: "🪙" },
  { id: "coin_quarter", name: "ربع‌سکه", kind: "METAL", unit: "عدد", icon: "🪙" },
  { id: "coin_gram", name: "سکه گرمی", kind: "METAL", unit: "عدد", icon: "🪙" },
  { id: "silver999", name: "نقره ۹۹۹", kind: "METAL", unit: "گرم", icon: "🥈" },
];

const BY_ID = new Map(BASKET_ASSETS.map((asset) => [asset.id, asset]));

export const BASKET_ASSET_IDS = BASKET_ASSETS.map((asset) => asset.id) as [string, ...string[]];

/** The catalog entry for an id, or undefined for one this build does not know (a newer app's asset, say). */
export function basketAssetById(id: string): BasketAsset | undefined {
  return BY_ID.get(id);
}
