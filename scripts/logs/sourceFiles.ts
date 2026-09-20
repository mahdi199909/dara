// Reads every TypeScript source file under src/ (the input of the logging docs generator). Shared by
// scripts/logs/generate-docs.ts and the test that keeps the generated documents honest.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceFile } from "../../src/lib/observability/docsGenerator";

export function readSourceFiles(root = process.cwd()): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push({ path: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
    }
  };
  walk(join(root, "src"));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
