import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The permanent download link https://my.parvaapp.ir/parvaapp.apk (next.config.mjs rewrites it here).
// The APK is served from this server itself — a folder mounted into the container (docker-compose.yml:
// ./downloads → /app/downloads), which each release fills (DEPLOYMENT.md "Releasing a new Android APK") —
// so downloading does not depend on reaching GitHub from Iran, and the repository could be made private.
// Range requests are answered, so an interrupted download on a weak connection resumes instead of
// starting over. Only if the file is missing does it fall back to the GitHub release.
// Public (see src/middleware.ts): people download it before they have an account.
const APK_FILE = process.env.APK_FILE || "/app/downloads/parvaapp.apk";
const GITHUB_FALLBACK = "https://github.com/mahdi199909/dara/releases/latest/download/parvaapp.apk";

function baseHeaders(size: number, mtime: Date): Headers {
  return new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="parvaapp.apk"',
    "Accept-Ranges": "bytes",
    // A new release replaces the file under the same name: caches must check back every time.
    "Cache-Control": "no-cache",
    ETag: `"${size.toString(16)}-${Math.floor(mtime.getTime() / 1000).toString(16)}"`,
    "Last-Modified": mtime.toUTCString(),
  });
}

async function serve(req: NextRequest, withBody: boolean): Promise<Response> {
  let info;
  try {
    info = await stat(APK_FILE);
    if (!info.isFile() || info.size === 0) throw new Error("not a file");
  } catch {
    return NextResponse.redirect(GITHUB_FALLBACK, 307);
  }
  const size = info.size;
  const headers = baseHeaders(size, info.mtime);
  if (req.headers.get("if-none-match") === headers.get("ETag")) return new Response(null, { status: 304, headers });

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      // "bytes=-500": the last 500 bytes.
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  if (!withBody) return new Response(null, { status, headers });
  const body = Readable.toWeb(createReadStream(APK_FILE, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

async function GET(req: NextRequest) {
  return serve(req, true);
}

async function HEAD(req: NextRequest) {
  return serve(req, false);
}

const loggedGET = withApiLogging("GET", "/api/app/apk", GET);
const loggedHEAD = withApiLogging("HEAD", "/api/app/apk", HEAD);
export { loggedGET as GET, loggedHEAD as HEAD };
