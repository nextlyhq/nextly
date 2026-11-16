import { describe, expect, it } from "vitest";

import { evaluateRefreshBinding } from "../refresh-binding";

const UA = "Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36";

/** The binding of a refresh from `currentIp`, for a row stored at `storedIp`. */
function fromAddress(storedIp: string | null, currentIp: string | null) {
  return evaluateRefreshBinding({
    storedUserAgent: UA,
    currentUserAgent: UA,
    storedIp,
    currentIp,
  });
}

describe("evaluateRefreshBinding", () => {
  // A browser's own requests reach a site from more than one address: a
  // carrier-grade NAT or several uplinks pick a public address per
  // connection, often in another /24, and a dual-stack browser connects over
  // whichever family answers first. None of that says the cookie was stolen,
  // so none of it may end the session; it is reported for an operator to
  // watch instead.
  it.each([
    ["another IPv4 /24", "198.51.100.7", "203.0.113.9", "ipv4-prefix-changed"],
    ["the other IP family", "198.51.100.7", "2001:db8::1", "ip-family-changed"],
    [
      "another IPv6 /48",
      "2001:db8:1::10",
      "2001:db9:2::20",
      "ipv6-prefix-changed",
    ],
  ])(
    "reports a refresh from %s as a change, never a refusal",
    (_, a, b, why) => {
      expect(fromAddress(a, b)).toEqual({ kind: "changed", reasons: [why] });
    }
  );

  it("names an IPv4 address the same in its IPv6-mapped spelling", () => {
    // One address, written the way a dual-stack socket reports it.
    expect(fromAddress("198.51.100.7", "::ffff:198.51.100.7")).toEqual({
      kind: "ok",
    });
  });

  it.each([
    ["hexadecimal", "::ffff:c633:6407"],
    ["written out in full", "0:0:0:0:0:ffff:c633:6407"],
    ["in capitals", "::FFFF:198.51.100.7"],
  ])(
    "reads the IPv6-mapped spelling %s as the IPv4 address it names",
    (_, mapped) => {
      expect(fromAddress("198.51.100.7", mapped)).toEqual({ kind: "ok" });
    }
  );

  it("reports two IPv4-mapped addresses in different /24s as a change", () => {
    // 198.51.100.7 and 203.0.113.9, both written in hexadecimal: compared as
    // IPv6 their /48s are both zero and would read as one network.
    expect(fromAddress("::ffff:c633:6407", "::ffff:cb00:7109")).toEqual({
      kind: "changed",
      reasons: ["ipv4-prefix-changed"],
    });
  });

  it("keeps quiet for an address in the same network", () => {
    expect(fromAddress("198.51.100.7", "198.51.100.42")).toEqual({
      kind: "ok",
    });
    expect(fromAddress("2001:db8:1::10", "2001:db8:1:ffff::1")).toEqual({
      kind: "ok",
    });
  });

  it("reports a changed browser beside a changed network", () => {
    expect(
      evaluateRefreshBinding({
        storedUserAgent: UA,
        currentUserAgent: "curl/8.7.1",
        storedIp: "198.51.100.7",
        currentIp: "203.0.113.9",
      })
    ).toEqual({
      kind: "changed",
      reasons: ["ipv4-prefix-changed", "user-agent-changed"],
    });
  });

  it("compares nothing it cannot read", () => {
    // Without a trusted proxy no address is known, and the binding has
    // nothing to say.
    expect(fromAddress(null, "203.0.113.9")).toEqual({ kind: "ok" });
    expect(fromAddress("198.51.100.7", null)).toEqual({ kind: "ok" });
    expect(fromAddress("not-an-address", "203.0.113.9")).toEqual({
      kind: "ok",
    });
  });
});
