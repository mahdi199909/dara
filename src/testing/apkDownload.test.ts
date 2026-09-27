// The permanent APK link served from the server's own downloads folder (src/app/api/app/apk/route.ts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "parva-apk-"));
const file = path.join(dir, "parvaapp.apk");
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
type Handler = (req: NextRequest) => Promise<Response>;
let GET: Handler;
let HEAD: Handler;

beforeAll(async () => {
  writeFileSync(file, bytes);
  process.env.APK_FILE = file;
  ({ GET, HEAD } = (await import("@/app/api/app/apk/route")) as unknown as { GET: Handler; HEAD: Handler });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const req = (headers: Record<string, string> = {}, method = "GET") => new NextRequest("http://localhost/parvaapp.apk", { method, headers });

describe("the APK download", () => {
  it("serves the whole file as parvaapp.apk", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(res.headers.get("content-disposition")).toContain('filename="parvaapp.apk"');
    expect(res.headers.get("content-length")).toBe("1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("resumes an interrupted download from where it stopped", async () => {
    const res = await GET(req({ range: "bytes=600-" }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 600-999/1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(600))).toBe(true);
    const tail = await GET(req({ range: "bytes=-10" }));
    expect(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(990))).toBe(true);
    expect((await GET(req({ range: "bytes=5000-" }))).status).toBe(416);
  });

  it("answers HEAD and an unchanged ETag without a body", async () => {
    const head = await HEAD(req({}, "HEAD"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("1000");
    const etag = head.headers.get("etag")!;
    expect((await GET(req({ "if-none-match": etag }))).status).toBe(304);
  });

  it("falls back to the GitHub release when the server has no file", async () => {
    rmSync(file);
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("github.com/mahdi199909/dara/releases/latest/download/parvaapp.apk");
  });
});
