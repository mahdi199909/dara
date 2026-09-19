import { describe, expect, it } from "vitest";
import { classifySyncError } from "./syncRunner";
import { SyncHttpError } from "./sync";

describe("classifySyncError — what a person is told when a sync fails", () => {
  it("a missing/expired session says to log in again, not 'check your internet'", () => {
    const f = classifySyncError(new SyncHttpError(401, "push", ""));
    expect(f.kind).toBe("auth");
    expect(f.message).toContain("وارد شوید");
    expect(classifySyncError(new SyncHttpError(403, "pull", "")).kind).toBe("auth");
  });

  it("the proxy refusing a big request is named for what it is", () => {
    const f = classifySyncError(new SyncHttpError(413, "push", "<html>413 Request Entity Too Large</html>"));
    expect(f.kind).toBe("too-large");
    expect(f.status).toBe(413);
    expect(f.message).not.toMatch(/اینترنت/);
  });

  it("a server error is described as temporary, with its status", () => {
    const f = classifySyncError(new SyncHttpError(502, "pull", ""));
    expect(f.kind).toBe("server");
    expect(f.status).toBe(502);
    expect(f.message).toContain("502");
  });

  it("only a genuine fetch failure is reported as a connectivity problem", () => {
    expect(classifySyncError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifySyncError(new Error("boom")).kind).toBe("unknown");
    expect(classifySyncError(new Error("boom")).message).toContain("boom");
  });
});
