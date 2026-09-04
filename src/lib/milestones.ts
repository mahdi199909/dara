// Pure, dependency-free — safe to import from both server engines (reportEngine.ts,
// local/reportEngine.ts) and client components (assets/page.tsx) without pulling prisma or a
// SQLite driver into the browser bundle. The hour thresholds a category/project's accumulated
// time is measured against for UpgradeToast and the assets page's per-asset progress bars.
export const MILESTONE_HOURS = [10, 25, 50, 100, 250, 500];
export const MILESTONE_MINUTES = MILESTONE_HOURS.map((h) => h * 60);

/** The first threshold not yet reached, or null once past the highest one. */
export function nextMilestoneMinutes(totalMinutes: number): number | null {
  return MILESTONE_MINUTES.find((m) => m > totalMinutes) ?? null;
}
