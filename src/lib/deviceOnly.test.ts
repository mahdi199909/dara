// The promise made to the person about the monthly cycle (and, in the same spirit, the athlete's meals): it stays on
// this device. These checks read the source and fail if anything of it could reach the network, the database, the sync
// or a backup file — so the promise cannot be broken by a change somebody makes later without noticing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NETWORK = /apiClient|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|syncWithServer|apiPost|apiPatch|apiPut|apiDelete|\/api\//;

describe("the monthly cycle stays on the device", () => {
  const files = ["src/lib/cycle.ts", "src/lib/useCycle.ts", "src/lib/deviceStore.ts", "src/app/(app)/cycle/page.tsx"];

  it.each(files)("%s never talks to the network or the API", (file) => {
    expect(read(file)).not.toMatch(NETWORK);
  });

  it("is kept only in localStorage, under one key", () => {
    expect(read("src/lib/deviceStore.ts")).toMatch(/localStorage/);
    expect(read("src/lib/cycle.ts")).toMatch(/parva\.cycle\.v1/);
  });

  it("is unknown to the database, the sync, the backup and the erasure code", () => {
    const places = ["prisma/schema.prisma", "prisma/schema.postgresql.prisma", "src/lib/syncTables.ts", "src/local/dataExport.ts", "src/lib/backupLabels.ts", "src/local/generatedSchema.ts"];
    for (const place of places) {
      expect(read(place), place).not.toMatch(/model\s+(Cycle|Period|Menstru)|"(Cycle|Period)\w*"|parva\.cycle/i);
    }
  });

  it("is not part of the Settings columns that sync (only the gender and the on/off modes are)", () => {
    const profile = read("src/lib/profileSync.ts");
    expect(profile).toMatch(/"gender"/);
    expect(profile).not.toMatch(/cycle/i);
  });
});

describe("the athlete's meals stay on the device", () => {
  it.each(["src/lib/meals.ts", "src/lib/useMeals.ts"])("%s never talks to the network or the API", (file) => {
    expect(read(file)).not.toMatch(NETWORK);
  });

  it("the page only reads what habits burned (a GET through the shared fetcher) and never writes anything to the API", () => {
    const page = read("src/app/(app)/meals/page.tsx");
    expect(page).not.toMatch(/apiPost|apiPatch|apiPut|apiDelete|\bfetch\s*\(|sendBeacon/);
    expect(page).toMatch(/\/api\/day-activity/);
  });

  it("is unknown to the database, the sync and the backup", () => {
    const places = ["prisma/schema.prisma", "prisma/schema.postgresql.prisma", "src/lib/syncTables.ts", "src/local/dataExport.ts", "src/lib/backupLabels.ts", "src/local/generatedSchema.ts"];
    for (const place of places) {
      expect(read(place), place).not.toMatch(/model\s+Meal|"Meal\w*"|parva\.meals/i);
    }
  });
});
