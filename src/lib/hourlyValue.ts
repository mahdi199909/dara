export interface HourlyValueInput {
  monthlyIncome?: number | null;
  workingHoursMonth?: number | null;
  hourlyValueOverride?: number | null;
}

/**
 * Computes the user's hourly value in Toman.
 * Override always wins when set; otherwise derived from monthlyIncome / workingHoursMonth.
 * Returns 0 when there isn't enough information (time-cost calculations then simply contribute 0).
 */
export function computeHourlyValue(input: HourlyValueInput): number {
  if (input.hourlyValueOverride && input.hourlyValueOverride > 0) {
    return Math.round(input.hourlyValueOverride);
  }
  if (input.monthlyIncome && input.workingHoursMonth && input.workingHoursMonth > 0) {
    return Math.round(input.monthlyIncome / input.workingHoursMonth);
  }
  return 0;
}
