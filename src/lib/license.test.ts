import { describe, expect, it } from "vitest";
import { applyLicenseChange, effectiveLicense, LicenseChangeError } from "./license";

const NOW = new Date("2026-09-27T12:00:00Z");
const DAY = 86_400_000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

describe("effectiveLicense", () => {
  it("reads a lapsed trial or subscription as FREE", () => {
    expect(effectiveLicense({ status: "TRIAL", trialEndsAt: inDays(-1), currentPeriodEnd: null }, NOW).status).toBe("FREE");
    expect(effectiveLicense({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: inDays(-1) }, NOW).status).toBe("FREE");
    expect(effectiveLicense(null, NOW).status).toBe("FREE");
  });

  it("counts the days left, rounded up", () => {
    expect(effectiveLicense({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: new Date(NOW.getTime() + 2.2 * DAY) }, NOW)).toMatchObject({ status: "SUBSCRIBED", daysRemaining: 3 });
    expect(effectiveLicense({ status: "TRIAL", trialEndsAt: inDays(10), currentPeriodEnd: null }, NOW)).toMatchObject({ status: "TRIAL", daysRemaining: 10 });
    expect(effectiveLicense({ status: "LIFETIME", trialEndsAt: null, currentPeriodEnd: null }, NOW)).toMatchObject({ status: "LIFETIME", endsAt: null });
  });
});

describe("applyLicenseChange", () => {
  it("adds days to a running subscription, and after a running trial", () => {
    const sub = applyLicenseChange({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: inDays(5) }, { action: "extend", days: 30 }, NOW);
    expect(sub).toMatchObject({ status: "SUBSCRIBED", currentPeriodEnd: inDays(35) });
    const trial = applyLicenseChange({ status: "TRIAL", trialEndsAt: inDays(12), currentPeriodEnd: null }, { action: "extend", days: 30 }, NOW);
    expect(trial).toMatchObject({ status: "SUBSCRIBED", currentPeriodEnd: inDays(42) });
  });

  it("starts from today when nothing is running", () => {
    expect(applyLicenseChange({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: inDays(-40) }, { action: "extend", days: 30 }, NOW).currentPeriodEnd).toEqual(inDays(30));
    expect(applyLicenseChange(null, { action: "extend", days: 7 }, NOW).currentPeriodEnd).toEqual(inDays(7));
  });

  it("shortens but never into the past, and only a subscription", () => {
    expect(applyLicenseChange({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: inDays(10) }, { action: "shorten", days: 4 }, NOW).currentPeriodEnd).toEqual(inDays(6));
    expect(applyLicenseChange({ status: "SUBSCRIBED", trialEndsAt: null, currentPeriodEnd: inDays(10) }, { action: "shorten", days: 40 }, NOW).currentPeriodEnd).toEqual(NOW);
    expect(() => applyLicenseChange({ status: "TRIAL", trialEndsAt: inDays(3), currentPeriodEnd: null }, { action: "shorten", days: 1 }, NOW)).toThrow(LicenseChangeError);
  });

  it("refuses nonsense: extending lifetime, a date in the past, zero or absurd day counts", () => {
    expect(() => applyLicenseChange({ status: "LIFETIME", trialEndsAt: null, currentPeriodEnd: null }, { action: "extend", days: 30 }, NOW)).toThrow(LicenseChangeError);
    expect(() => applyLicenseChange(null, { action: "set_until", until: inDays(-1) }, NOW)).toThrow(LicenseChangeError);
    expect(() => applyLicenseChange(null, { action: "extend", days: 0 }, NOW)).toThrow(LicenseChangeError);
    expect(() => applyLicenseChange(null, { action: "extend", days: 99_999 }, NOW)).toThrow(LicenseChangeError);
  });

  it("free also ends a running trial; trial restarts from today", () => {
    const free = applyLicenseChange({ status: "TRIAL", trialEndsAt: inDays(20), currentPeriodEnd: null }, { action: "free" }, NOW);
    expect(effectiveLicense(free, NOW).status).toBe("FREE");
    expect(applyLicenseChange(null, { action: "trial", days: 14 }, NOW)).toMatchObject({ status: "TRIAL", trialEndsAt: inDays(14) });
  });
});
