import { describe, expect, it } from "vitest";
import { NO_MODES, cycleAvailable, isGender, isMode, isModesText, navItemVisible, parseModes, serializeModes, withMode, type ModeState } from "./modes";
import { updateSettingsSchema } from "./schemas/settings";
import { MORE_NAV_ITEMS } from "./navConfig";

describe("parseModes / serializeModes", () => {
  it("reads the words in the canonical order, dropping unknown words and repeats", () => {
    expect(parseModes("timeBoxing,athlete")).toEqual(["athlete", "timeBoxing"]);
    expect(parseModes("athlete, athlete ,flying,,timeBlocking")).toEqual(["athlete", "timeBlocking"]);
    expect(parseModes("")).toEqual([]);
    expect(parseModes(null)).toEqual([]);
    expect(parseModes(undefined)).toEqual([]);
  });

  it("writes them back in that order, and null for none", () => {
    expect(serializeModes(["timeBoxing", "athlete"])).toBe("athlete,timeBoxing");
    expect(serializeModes([])).toBeNull();
    expect(parseModes(serializeModes(["timeBlocking"]))).toEqual(["timeBlocking"]);
  });

  it("switches one on or off without disturbing the others", () => {
    expect(withMode(["athlete"], "timeBoxing", true)).toEqual(["athlete", "timeBoxing"]);
    expect(withMode(["athlete", "timeBoxing"], "athlete", false)).toEqual(["timeBoxing"]);
    expect(withMode(["athlete"], "athlete", true)).toEqual(["athlete"]);
    expect(withMode([], "athlete", false)).toEqual([]);
  });
});

describe("what is a mode and a gender", () => {
  it("knows its words", () => {
    expect(isMode("athlete")).toBe(true);
    expect(isMode("cycle")).toBe(false);
    expect(isMode(3)).toBe(false);
    expect(isGender("FEMALE")).toBe(true);
    expect(isGender("female")).toBe(false);
    expect(isGender(null)).toBe(false);
  });

  it("accepts a text of modes only when every word is one", () => {
    expect(isModesText("athlete,timeBoxing")).toBe(true);
    expect(isModesText("")).toBe(true);
    expect(isModesText("athlete,cycle")).toBe(false);
    expect(isModesText("nonsense")).toBe(false);
  });
});

describe("the menu", () => {
  const state = (over: Partial<ModeState> = {}): ModeState => ({ ...NO_MODES, ...over });

  it("shows an entry with no condition to everyone", () => {
    expect(navItemVisible(undefined, state())).toBe(true);
    expect(navItemVisible([], state())).toBe(true);
  });

  it("shows a mode's entry only while the mode is on, and an entry for several when any one is", () => {
    expect(navItemVisible(["athlete"], state())).toBe(false);
    expect(navItemVisible(["athlete"], state({ modes: ["athlete"] }))).toBe(true);
    expect(navItemVisible(["timeBlocking", "timeBoxing"], state({ modes: ["timeBoxing"] }))).toBe(true);
    expect(navItemVisible(["timeBlocking", "timeBoxing"], state({ modes: ["athlete"] }))).toBe(false);
  });

  it("offers the monthly cycle only to a woman who switched it on", () => {
    expect(cycleAvailable({ gender: "FEMALE", cycleOn: true })).toBe(true);
    expect(cycleAvailable({ gender: "FEMALE", cycleOn: false })).toBe(false);
    expect(cycleAvailable({ gender: "MALE", cycleOn: true })).toBe(false);
    expect(cycleAvailable({ gender: null, cycleOn: true })).toBe(false);
    expect(navItemVisible(["cycle"], state({ gender: "FEMALE", cycleOn: true }))).toBe(true);
    expect(navItemVisible(["cycle"], state({ gender: "MALE", cycleOn: true }))).toBe(false);
  });
});

describe("the settings body", () => {
  it("takes a gender, a text of modes, or null to clear either", () => {
    expect(updateSettingsSchema.safeParse({ gender: "FEMALE", modes: "athlete,timeBoxing" }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ gender: null, modes: null }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ modes: "" }).success).toBe(true);
  });

  it("refuses a gender or a mode it does not know", () => {
    expect(updateSettingsSchema.safeParse({ gender: "OTHER" }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ modes: "athlete,cycle" }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ modes: "x".repeat(200) }).success).toBe(false);
  });
});

describe("the «بیشتر» menu entries that belong to a mode", () => {
  const shown = (state: ModeState) => MORE_NAV_ITEMS.filter((item) => navItemVisible(item.requires, state)).map((item) => item.href);

  it("are left out until their mode is on", () => {
    expect(shown(NO_MODES)).not.toContain("/meals");
    expect(shown(NO_MODES)).not.toContain("/cycle");
    expect(shown({ ...NO_MODES, modes: ["athlete"] })).toContain("/meals");
  });

  it("show the cycle only for a woman who switched it on, and never to anyone else", () => {
    expect(shown({ ...NO_MODES, gender: "FEMALE", cycleOn: true })).toContain("/cycle");
    expect(shown({ ...NO_MODES, gender: "FEMALE", cycleOn: false })).not.toContain("/cycle");
    expect(shown({ ...NO_MODES, gender: "MALE", cycleOn: true })).not.toContain("/cycle");
    expect(shown({ ...NO_MODES, gender: null, cycleOn: true, modes: ["athlete", "timeBlocking", "timeBoxing"] })).not.toContain("/cycle");
  });

  it("leave every other entry as it was", () => {
    expect(shown(NO_MODES)).toEqual(expect.arrayContaining(["/habits", "/basket", "/settings", "/review"]));
  });
});
