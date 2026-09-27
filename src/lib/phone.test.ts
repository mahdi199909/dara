import { afterEach, describe, expect, it } from "vitest";
import { looksLikePhone, maskEmail, maskPhone, normalizeIranMobile } from "./phone";
import { clientIp } from "./clientIp";

describe("normalizeIranMobile", () => {
  it("accepts the usual ways of writing a mobile number, Persian digits included", () => {
    for (const input of ["09123456789", "9123456789", "+989123456789", "00989123456789", "989123456789", "۰۹۱۲ ۳۴۵ ۶۷۸۹", "0912-345-6789", "(0912) 345 6789"]) {
      expect(normalizeIranMobile(input), input).toBe("09123456789");
    }
  });

  it("refuses landlines, short numbers and anything else", () => {
    for (const input of ["02188776655", "0912345678", "091234567890", "abc", "", "+14155550123"]) expect(normalizeIranMobile(input), input).toBeNull();
  });

  it("tells a phone from an email, and masks both", () => {
    expect(looksLikePhone("0912 345 6789")).toBe(true);
    expect(looksLikePhone("me@example.com")).toBe(false);
    expect(maskPhone("09123456789")).toBe("0912***6789");
    expect(maskEmail("someone@gmail.com")).toBe("so*****@gmail.com");
  });
});

describe("clientIp", () => {
  const original = process.env.TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = original;
  });
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("takes the address the proxy appended, not the one the client wrote in", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("follows TRUSTED_PROXY_HOPS and falls back to x-real-ip", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(req({}))).toBeNull();
  });
});
