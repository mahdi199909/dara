import { describe, expect, it } from "vitest";
import { open, seal } from "./secretBox";

describe("secretBox", () => {
  it("round-trips, and never stores the plaintext", () => {
    const sealed = seal("SMTP_PASS", "hunter2-with-ünicode");
    expect(sealed).not.toContain("hunter2");
    expect(open("SMTP_PASS", sealed)).toBe("hunter2-with-ünicode");
    expect(seal("SMTP_PASS", "same")).not.toBe(seal("SMTP_PASS", "same"));
  });

  it("refuses a value moved to another setting, or tampered with", () => {
    const sealed = seal("KAVENEGAR_API_KEY", "k");
    expect(open("SMSIR_API_KEY", sealed)).toBeNull();
    const [v, iv, tag, ct] = sealed.split(".");
    // The first character carries six full bits of ciphertext (the last may be only padding).
    const flipped = (ct.startsWith("A") ? "B" : "A") + ct.slice(1);
    expect(open("KAVENEGAR_API_KEY", [v, iv, tag, flipped].join("."))).toBeNull();
    expect(open("KAVENEGAR_API_KEY", "garbage")).toBeNull();
  });
});
