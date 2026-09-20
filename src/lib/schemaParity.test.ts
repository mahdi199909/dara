// prisma/schema.prisma (SQLite: development, the tests, and — as migrations — the phone) and
// prisma/schema.postgresql.prisma (production) are two files that must describe the same models; the
// second says so in its header, and until now nothing enforced it. A column added to one and forgotten in
// the other would fail only on the server, at container start.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

/** Model name → its field lines, comments and spacing removed. */
function models(file: string): Map<string, string[]> {
  const text = readFileSync(path.join(ROOT, "prisma", file), "utf8").replace(/\r\n/g, "\n");
  const result = new Map<string, string[]>();
  for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    result.set(
      match[1],
      match[2]
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    );
  }
  return result;
}

describe("the two Prisma schemas", () => {
  const sqlite = models("schema.prisma");
  const postgres = models("schema.postgresql.prisma");

  it("define the same set of models", () => {
    expect(sqlite.size).toBeGreaterThan(20);
    expect([...postgres.keys()].sort()).toEqual([...sqlite.keys()].sort());
  });

  it("give every model the same fields, types and attributes", () => {
    for (const [name, fields] of sqlite) expect(postgres.get(name), `model ${name} differs between schema.prisma and schema.postgresql.prisma`).toEqual(fields);
  });
});
