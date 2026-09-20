// Regenerates the reference documents that come straight from the registries:
//   doc/logging/events.md       (src/lib/observability/core/events.ts)
//   doc/logging/error-codes.md  (src/lib/observability/core/errorCodes.ts)
//
//   npx tsx scripts/logs/generate-docs.ts
//
// A vitest (src/lib/observability/docs.test.ts) runs the same generator and fails when these
// files are out of date, so the documentation cannot silently drift from the code.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderErrorCodesDoc, renderEventsDoc, findUsages } from "../../src/lib/observability/docsGenerator";
import { readSourceFiles } from "./sourceFiles";

const usage = findUsages(readSourceFiles());
const dir = join(process.cwd(), "doc", "logging");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "events.md"), renderEventsDoc(usage.events));
writeFileSync(join(dir, "error-codes.md"), renderErrorCodesDoc(usage.codes));
console.log(`doc/logging/events.md (${usage.events.size} events emitted by code) and error-codes.md (${usage.codes.size} codes emitted) regenerated`);
