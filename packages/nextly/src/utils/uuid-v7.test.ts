/**
 * The properties that make a UUIDv7 worth having over a v4.
 *
 * Format and uniqueness are the easy half and prove almost nothing: a v4
 * generator passes both. The load-bearing tests are the TIMESTAMP decoding and
 * the strict ordering within one millisecond, because those are the only ones
 * a random generator fails.
 */
import { describe, expect, it, vi } from "vitest";

import { uuidV7, uuidV7Timestamp } from "./uuid-v7";

describe("layout", () => {
  it("is a canonical 36-character UUID", () => {
    expect(uuidV7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("sets version 7 and variant 10", () => {
    const hex = uuidV7().replace(/-/g, "");
    expect(parseInt(hex[12], 16)).toBe(7);
    // Variant: the top two bits of byte 8 must be `10`, so the nibble is 8–b.
    expect(parseInt(hex[16], 16) & 0b1100).toBe(0b1000);
  });
});

describe("the timestamp", () => {
  it("decodes to the moment it was issued", () => {
    // This is the separating test. A v4 generator passes every format and
    // uniqueness check above and fails this one immediately, because its
    // leading 48 bits are random.
    const before = Date.now();
    const decoded = uuidV7Timestamp(uuidV7());
    const after = Date.now();
    expect(decoded).not.toBeNull();
    expect(decoded as number).toBeGreaterThanOrEqual(before);
    expect(decoded as number).toBeLessThanOrEqual(after + 1);
  });

  it("reads back a supplied timestamp exactly", () => {
    const at = 1_700_000_000_000;
    expect(uuidV7Timestamp(uuidV7(at))).toBe(at);
  });

  it("returns null for a value that is not a v7", () => {
    // The control: a decoder that always returned a number would satisfy the
    // assertions above without reading anything.
    expect(uuidV7Timestamp("not-a-uuid")).toBeNull();
    expect(uuidV7Timestamp("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("ordering", () => {
  it("is strictly increasing across 10,000 ids in a tight loop", () => {
    // Every one of these shares a millisecond, so without the counter in
    // `rand_a` they would sort randomly — which is the whole reason for
    // preferring v7.
    const ids = Array.from({ length: 10_000 }, () => uuidV7());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it("keeps increasing when the system clock goes backwards", () => {
    // Exercised through the DEFAULT path, because that is where the guarantee
    // applies: an explicit timestamp is honoured exactly, and substituting a
    // later one there would make the timestamp a lie.
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(2_000_000_000_000);
      const first = uuidV7();
      // An NTP correction, or a virtual machine resuming.
      clock.mockReturnValue(1_000_000_000_000);
      const second = uuidV7();
      expect(second > first).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("honours an explicit timestamp rather than clamping it", () => {
    // The caller is choosing where the id sorts, which is the whole reason to
    // pass one. Clamping it to "now" silently discards that choice.
    const past = 1_500_000_000_000;
    expect(uuidV7Timestamp(uuidV7(past))).toBe(past);
  });

  it("produces distinct values", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => uuidV7()));
    expect(ids.size).toBe(5_000);
  });
});

describe("more ids in one millisecond than the counter can hold", () => {
  it("keeps every id strictly increasing past the 4096th", () => {
    // The overflow the 10,000-id test could never reach: it does not freeze
    // the clock, so its loop spans several milliseconds and each one starts a
    // fresh counter. Frozen, every id competes for the same 12-bit counter and
    // the 4,097th must borrow the next millisecond — encoded WITH that
    // millisecond, or it sorts before ids already issued.
    const frozen = 1_700_000_000_000;
    const realNow = Date.now;
    Date.now = () => frozen;
    try {
      const ids: string[] = [];
      for (let i = 0; i < 5000; i += 1) ids.push(uuidV7());
      const sorted = [...ids].sort();
      expect(sorted).toEqual(ids);
      // And no two are equal, which a reset counter would produce.
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      Date.now = realNow;
    }
  });
});
