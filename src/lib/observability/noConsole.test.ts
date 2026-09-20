// A guard, not a feature test: application code logs through getLogger(), never through raw
// console.* (which has no level, no context, no redaction and no way to be routed or sampled).
// The only places allowed to touch the console are the logging subsystem itself (the console sink
// and its last-resort fallback) and tests. A deliberate exception elsewhere needs a
// `// console-ok: <reason>` comment on the same line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ALLOWED_DIRS = [join(SRC, "lib", "observability"), join(SRC, "testing")];
const CONSOLE_CALL = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|table|dir)\b/;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (ALLOWED_DIRS.includes(path)) continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      yield path;
    }
  }
}

describe("no raw console in application code", () => {
  it("uses getLogger() everywhere outside the logging subsystem", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          if (line.includes("console-ok")) return;
          if (CONSOLE_CALL.test(line)) offenders.push(`${relative(process.cwd(), file).split(sep).join("/")}:${index + 1}  ${code.slice(0, 90)}`);
        });
    }
    expect(offenders, `Use getLogger("module", "component") from "@/lib/observability" instead of console.*:\n${offenders.join("\n")}`).toEqual([]);
  });
});
