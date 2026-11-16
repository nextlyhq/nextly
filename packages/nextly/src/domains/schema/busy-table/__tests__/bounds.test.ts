/**
 * How long a schema change waits for a busy table: one try's bound and the total, from the
 * command line, the environment or the defaults, each checked before anything changes.
 */
import { describe, expect, it } from "vitest";

import { busyTableBounds, DEFAULT_BUSY_TABLE_BOUNDS } from "../bounds";

/** The refusal `busyTableBounds` throws for `input`, or undefined where it accepts it. */
function refusal(input: Parameters<typeof busyTableBounds>[0]) {
  try {
    busyTableBounds(input);
    return undefined;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
}

describe("busyTableBounds", () => {
  it("uses about 5 seconds a try and about 90 in all when nothing sets them", () => {
    expect(busyTableBounds({ env: {} })).toEqual({
      tryMs: 5_000,
      totalMs: 90_000,
    });
    expect(DEFAULT_BUSY_TABLE_BOUNDS).toEqual({
      tryMs: 5_000,
      totalMs: 90_000,
    });
  });

  it("takes each bound from the environment", () => {
    expect(
      busyTableBounds({
        env: { NEXTLY_LOCK_TIMEOUT: "2", NEXTLY_LOCK_TIMEOUT_TOTAL: "30" },
      })
    ).toEqual({ tryMs: 2_000, totalMs: 30_000 });
  });

  it("lets the command line win over the environment, bound by bound", () => {
    expect(
      busyTableBounds({
        flags: { lockTimeout: "3" },
        env: { NEXTLY_LOCK_TIMEOUT: "2", NEXTLY_LOCK_TIMEOUT_TOTAL: "30" },
      })
    ).toEqual({ tryMs: 3_000, totalMs: 30_000 });
    expect(
      busyTableBounds({
        flags: { lockTimeoutTotal: "40" },
        env: { NEXTLY_LOCK_TIMEOUT: "2", NEXTLY_LOCK_TIMEOUT_TOTAL: "30" },
      })
    ).toEqual({ tryMs: 2_000, totalMs: 40_000 });
  });

  it.each([
    ["1", 1_000],
    ["3600", 3_600_000],
  ])("accepts one try of %s seconds", (value, tryMs) => {
    expect(
      busyTableBounds({
        flags: { lockTimeout: value, lockTimeoutTotal: "86400" },
        env: {},
      }).tryMs
    ).toBe(tryMs);
  });

  it.each(["0", "0.5", "3601", "-1", "five", "", "1e3", " 5"])(
    "refuses one try of %j, naming the value and the range",
    value => {
      const refused = refusal({ flags: { lockTimeout: value }, env: {} });
      expect(refused?.code).toBe("INVALID_INPUT");
      expect(refused?.message).toContain("--lock-timeout");
      expect(refused?.message).toContain(JSON.stringify(value));
      expect(refused?.message).toContain(
        "whole number of seconds from 1 to 3600"
      );
    }
  );

  it("names the environment variable when the value came from it", () => {
    const refused = refusal({ env: { NEXTLY_LOCK_TIMEOUT: "0" } });
    expect(refused?.message).toContain("NEXTLY_LOCK_TIMEOUT");
    expect(refused?.message).not.toContain("--lock-timeout");
  });

  it.each([
    ["equal to the one try", "5", 5_000],
    ["of 86400", "86400", 86_400_000],
  ])("accepts a total %s", (_, value, totalMs) => {
    expect(
      busyTableBounds({ flags: { lockTimeoutTotal: value }, env: {} }).totalMs
    ).toBe(totalMs);
  });

  it.each(["4", "86401", "0", "2.5"])(
    "refuses a total of %j with a one try of 5, naming the value and the range",
    value => {
      const refused = refusal({ flags: { lockTimeoutTotal: value }, env: {} });
      expect(refused?.code).toBe("INVALID_INPUT");
      expect(refused?.message).toContain("--lock-timeout-total");
      expect(refused?.message).toContain(JSON.stringify(value));
      expect(refused?.message).toContain(
        "whole number of seconds from 5 (one try) to 86400"
      );
    }
  );

  it("raises the default total to one try set longer than it, as no total was given", () => {
    expect(
      busyTableBounds({ flags: { lockTimeout: "3600" }, env: {} })
    ).toEqual({ tryMs: 3_600_000, totalMs: 3_600_000 });
  });

  it("refuses a one try longer than the total it is given", () => {
    const refused = refusal({
      flags: { lockTimeout: "60", lockTimeoutTotal: "30" },
      env: {},
    });
    expect(refused?.message).toContain("from 60 (one try) to 86400");
  });
});
