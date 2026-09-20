import { describe, expect, it } from "vitest";
import { pickWidgetTextTone, relativeLuminance, widgetTextColor } from "./widgetContrast";

describe("pickWidgetTextTone", () => {
  it("uses dark text on an opaque light background and light text on an opaque dark one", () => {
    expect(pickWidgetTextTone("#FFFFFF", 100, false)).toBe("dark");
    expect(pickWidgetTextTone("#F3F4F6", 100, true)).toBe("dark");
    expect(pickWidgetTextTone("#000000", 100, false)).toBe("light");
    expect(pickWidgetTextTone("#0E5F54", 100, false)).toBe("light"); // the quick-capture teal
    expect(pickWidgetTextTone("#1E3A8A", 100, false)).toBe("light");
  });

  it("picks whichever of white and black reads better on a mid-tone colour, whatever the hue", () => {
    expect(pickWidgetTextTone("#FFD54F", 100, true)).toBe("dark"); // amber
    expect(pickWidgetTextTone("#B71C1C", 100, false)).toBe("light"); // deep red
    expect(pickWidgetTextTone("#00E676", 100, false)).toBe("dark"); // bright green
  });

  it("stays readable over any wallpaper when the background is see-through", () => {
    // Translucent white: a black wallpaper shows through as dark grey, a white one as white.
    expect(pickWidgetTextTone("#FFFFFF", 60, false)).toBe("dark");
    // Translucent black: white text wins over both extremes.
    expect(pickWidgetTextTone("#000000", 60, false)).toBe("light");
  });

  it("follows the phone's light/dark mode when nothing is painted at all", () => {
    expect(pickWidgetTextTone("#FFFFFF", 0, true)).toBe("light");
    expect(pickWidgetTextTone("#FFFFFF", 0, false)).toBe("dark");
  });

  it("copes with a malformed colour and an out-of-range opacity", () => {
    expect(pickWidgetTextTone("not-a-colour", 100, true)).toBe("light");
    expect(pickWidgetTextTone("not-a-colour", 100, false)).toBe("dark");
    expect(pickWidgetTextTone("#000000", 500, false)).toBe("light");
    expect(pickWidgetTextTone("#000000", -20, false)).toBe("dark"); // clamps to fully transparent, so the mode decides
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });
});

describe("widgetTextColor", () => {
  it("is neutral: a grey or white, never a tint", () => {
    for (const tone of ["light", "dark"] as const) {
      const hex = widgetTextColor(tone);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });
});
