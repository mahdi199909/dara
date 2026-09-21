// Makes the diagnostic report and hands it to the share sheet (Telegram, e-mail, a file manager … — the person
// chooses). Android only: the log file it reads exists only there. Nothing is uploaded by the app itself.
import { metrics } from "../core/metrics";
import { getLogger, getRootCore } from "../root";
import { getClientLogging } from "./install";
import { buildDiagnosticReport, type DiagnosticReport } from "./diagnostics";
import { getSyncStatus } from "../../syncStatus";

const log = getLogger("backup", "diagnostics");

/** How many of the newest records go into the report (the size limit may cut it shorter). */
const REPORT_RECORDS = 3000;

export class DiagnosticsUnavailableError extends Error {
  constructor() {
    super("گزارش تشخیصی فقط در برنامه‌ی اندروید در دسترس است.");
    this.name = "DiagnosticsUnavailableError";
  }
}

/** Builds the report from what the phone has written down so far (the queue is written out first). */
export async function collectDiagnosticReport(): Promise<DiagnosticReport> {
  const logging = getClientLogging();
  if (!logging) throw new DiagnosticsUnavailableError();

  await logging.flush();
  const records = await logging.sink.readRecent(REPORT_RECORDS);
  const context = getRootCore().currentContext();
  const last = getSyncStatus().last;

  return buildDiagnosticReport({
    app: {
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      build: process.env.NEXT_PUBLIC_BUILD_NUMBER,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? "production",
      platform: "android",
    },
    device: { deviceId: context.deviceId, osVersion: context.osVersion, tz: context.tz, sessionId: context.sessionId, userId: context.userId ?? null },
    logging: { level: process.env.NEXT_PUBLIC_LOG_LEVEL ?? "INFO", file: logging.sink.stats(), queue: logging.batching.stats() as unknown as Record<string, unknown> },
    sync: last
      ? {
          ok: last.ok,
          syncId: last.syncId,
          finishedAt: last.finishedAt,
          kind: last.error?.kind,
          status: last.error?.status,
          pushedCount: last.pushedCount,
          pulledCount: last.pulledCount,
          rejectedCount: last.rejectedCount,
          durationMs: last.durationMs,
        }
      : undefined,
    metrics: metrics.snapshot(),
    records,
  });
}

/** Builds the report, writes it to the app's cache and opens the share sheet. Returns what was made. */
export async function shareDiagnosticReport(): Promise<DiagnosticReport> {
  const startedAt = performance.now();
  try {
    const report = await collectDiagnosticReport();
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    // The app's own cache folder, as the backup export does: always there, and the file's real destination is whatever the share sheet picks.
    await Filesystem.writeFile({ path: report.fileName, data: report.json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: report.fileName, directory: Directory.Cache });
    log.info("EXPORT_COMPLETED", { layer: "local", kind: "diagnostic-report", recordCount: report.recordCount, fileSize: report.bytes, omittedForSize: report.omittedForSize, durationMs: performance.now() - startedAt });
    await Share.share({ title: "گزارش تشخیصی", dialogTitle: "ارسال گزارش تشخیصی", files: [uri] });
    return report;
  } catch (error) {
    if (!(error instanceof DiagnosticsUnavailableError)) log.error("EXPORT_FAILED", { error, layer: "local", kind: "diagnostic-report", errorCode: "SYS-001" });
    throw error;
  }
}
