import { describe, expect, it } from "vitest";
import { PLACEHOLDER_NAME, isSettingsPristine, shouldAdoptName, shouldAdoptSettings } from "./profileSync";

const created = "2026-01-01T00:00:00.000Z";

describe("isSettingsPristine", () => {
  it("is true only for a row nobody has edited since it was created", () => {
    expect(isSettingsPristine(created, created)).toBe(true);
    expect(isSettingsPristine(created, "2026-01-01T00:00:00.001Z")).toBe(true); // within a millisecond of slack
    expect(isSettingsPristine(created, "2026-01-01T00:00:05.000Z")).toBe(false);
  });
});

describe("shouldAdoptSettings", () => {
  const untouched = { createdAt: "2026-09-19T10:00:00.000Z", stamp: "2026-09-19T10:00:00.000Z" };
  const edited = (stamp: string) => ({ createdAt: created, stamp });

  it("never adopts settings that are themselves just factory defaults", () => {
    expect(shouldAdoptSettings(edited("2026-02-01T00:00:00.000Z"), untouched)).toBe(false);
    expect(shouldAdoptSettings(null, untouched)).toBe(false);
  });

  it("real settings replace a factory-default row even though the default's timestamp is NEWER (a fresh install must not win)", () => {
    expect(shouldAdoptSettings(untouched, edited("2026-05-01T00:00:00.000Z"))).toBe(true);
  });

  it("between two edited rows the later edit wins; ties keep what's there", () => {
    expect(shouldAdoptSettings(edited("2026-05-01T00:00:00.000Z"), edited("2026-06-01T00:00:00.000Z"))).toBe(true);
    expect(shouldAdoptSettings(edited("2026-06-01T00:00:00.000Z"), edited("2026-05-01T00:00:00.000Z"))).toBe(false);
    expect(shouldAdoptSettings(edited("2026-06-01T00:00:00.000Z"), edited("2026-06-01T00:00:00.000Z"))).toBe(false);
  });

  it("adopts into a database that has no settings row yet", () => {
    expect(shouldAdoptSettings(null, edited("2026-05-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("shouldAdoptName", () => {
  it("never adopts the placeholder or an empty name", () => {
    expect(shouldAdoptName({ value: "مهدی", stamp: created }, { value: PLACEHOLDER_NAME, stamp: "2027-01-01T00:00:00.000Z" })).toBe(false);
    expect(shouldAdoptName({ value: "مهدی", stamp: created }, { value: "", stamp: "2027-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("a real name replaces the placeholder regardless of timestamps", () => {
    expect(shouldAdoptName({ value: PLACEHOLDER_NAME, stamp: "2026-09-19T10:00:00.000Z" }, { value: "مهدی", stamp: created })).toBe(true);
  });

  it("between two real names the later edit wins", () => {
    expect(shouldAdoptName({ value: "الف", stamp: "2026-01-01T00:00:00.000Z" }, { value: "ب", stamp: "2026-02-01T00:00:00.000Z" })).toBe(true);
    expect(shouldAdoptName({ value: "الف", stamp: "2026-03-01T00:00:00.000Z" }, { value: "ب", stamp: "2026-02-01T00:00:00.000Z" })).toBe(false);
  });
});
