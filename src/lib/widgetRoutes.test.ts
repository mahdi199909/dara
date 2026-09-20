import { describe, expect, it } from "vitest";
import { routeFromWidgetUrl } from "./widgetRoutes";

describe("routeFromWidgetUrl", () => {
  it("maps the links the widgets send to their screens", () => {
    expect(routeFromWidgetUrl("parva://open/habits")).toBe("/habits");
    expect(routeFromWidgetUrl("parva://open/calendar")).toBe("/calendar");
    expect(routeFromWidgetUrl("parva://open/reports")).toBe("/reports");
    expect(routeFromWidgetUrl("parva://open/")).toBe("/");
    expect(routeFromWidgetUrl("parva://open")).toBe("/");
  });

  it("ignores a query string, a fragment and a trailing slash", () => {
    expect(routeFromWidgetUrl("parva://open/habits/")).toBe("/habits");
    expect(routeFromWidgetUrl("parva://open/habits?x=1#y")).toBe("/habits");
  });

  it("refuses anything that is not an allowed screen of ours", () => {
    expect(routeFromWidgetUrl("parva://open/admin")).toBeNull();
    expect(routeFromWidgetUrl("parva://open/../etc")).toBeNull();
    expect(routeFromWidgetUrl("parva://other/habits")).toBeNull();
    expect(routeFromWidgetUrl("https://evil.example/habits")).toBeNull();
    expect(routeFromWidgetUrl("javascript:alert(1)")).toBeNull();
    expect(routeFromWidgetUrl("")).toBeNull();
    expect(routeFromWidgetUrl(null)).toBeNull();
    expect(routeFromWidgetUrl(undefined)).toBeNull();
  });
});
