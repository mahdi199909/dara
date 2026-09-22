// "اگر خرجِ این دسته را ۲۰٪ کم کنی، ظرفِ یک سال چقدر بیشتر پس‌انداز می‌شود؟" — a pure projection
// over a category's REAL spend in the currently selected report period (reportEngine.ts's
// expenseByCategory), annualized by the real length of that period. Deliberately a projection, not
// a plan: it says "اگر" (if), never "باید" (must) — see the reports-engine honesty rule already
// used elsewhere (hiddenCost, narrative) of careful, non-prescriptive language.
export interface CategorySpendForWhatIf {
  categoryId: string;
  name: string;
  amount: number; // this period's real spend in this category
}

export interface WhatIfResult {
  categoryId: string;
  name: string;
  periodSpend: number;
  reductionPct: number;
  periodSavings: number; // periodSpend scaled by reductionPct
  annualizedSavings: number; // periodSavings extrapolated to a 365-day year from the real period length
}

export function simulateSpendReduction(category: CategorySpendForWhatIf, reductionPct: number, periodDays: number): WhatIfResult {
  // useCurrencyUnit().format() expects an integer Toman amount (see its own doc comment) — Toman
  // has no smaller unit, so a fractional result here would otherwise leak through as a raw decimal.
  const periodSavings = Math.round(category.amount * (reductionPct / 100));
  const annualizedSavings = periodDays > 0 ? Math.round((periodSavings / periodDays) * 365) : 0;
  return {
    categoryId: category.categoryId,
    name: category.name,
    periodSpend: category.amount,
    reductionPct,
    periodSavings,
    annualizedSavings,
  };
}
