import { describe, expect, it, beforeEach } from "vitest";
import { resetLocalDbForTests } from "@/local/db";
import { createNodeSqliteDriver } from "@/local/drivers/nodeSqlite";
import { dispatchLocal, setLocalDbDriverForTests } from "./localDispatcher";

describe("localDispatcher", () => {
  beforeEach(() => {
    resetLocalDbForTests();
    setLocalDbDriverForTests(createNodeSqliteDriver(":memory:"));
  });

  it("creates and lists a task with the same JSON shape the web route returns", () => {
    const created = dispatchLocal("POST", "/api/tasks", { title: "خرید نان" });
    expect(created.status).toBe(201);
    const task = (created.json as any).task;
    expect(task.title).toBe("خرید نان");
    expect(task.status).toBe("TODO");

    const listed = dispatchLocal("GET", "/api/tasks");
    expect(listed.status).toBe(200);
    expect((listed.json as any).tasks).toHaveLength(1);
  });

  it("filters list queries via the querystring", () => {
    dispatchLocal("POST", "/api/tasks", { title: "الف", status: "DONE" });
    dispatchLocal("POST", "/api/tasks", { title: "ب", status: "TODO" });

    const done = dispatchLocal("GET", "/api/tasks?status=DONE");
    expect((done.json as any).tasks.map((t: any) => t.title)).toEqual(["الف"]);
  });

  it("routes :id params and PATCH/DELETE correctly", () => {
    const created = dispatchLocal("POST", "/api/tasks", { title: "کار" });
    const id = (created.json as any).task.id;

    const patched = dispatchLocal("PATCH", `/api/tasks/${id}`, { status: "DONE" });
    expect((patched.json as any).task.status).toBe("DONE");

    const deleted = dispatchLocal("DELETE", `/api/tasks/${id}`);
    expect((deleted.json as any).ok).toBe(true);
    expect((dispatchLocal("GET", "/api/tasks").json as any).tasks).toHaveLength(0);
  });

  it("maps validation errors to a 400 with the same error shape as handleApiError", () => {
    const res = dispatchLocal("POST", "/api/tasks", { title: "" });
    expect(res.status).toBe(400);
    expect((res.json as any).error).toBe("اطلاعات ارسالی نامعتبر است.");
  });

  it("maps a not-found ApiError to its declared status", () => {
    const res = dispatchLocal("PATCH", "/api/tasks/does-not-exist", { title: "x" });
    expect(res.status).toBe(404);
    expect((res.json as any).error).toBe("کار پیدا نشد.");
  });

  it("returns 404 for an unregistered route instead of throwing", () => {
    const res = dispatchLocal("GET", "/api/not-a-real-route");
    expect(res.status).toBe(404);
  });
});
