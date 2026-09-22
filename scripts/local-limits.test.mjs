/**
 * What the machine gets to decide, and what it does not.
 *
 * 🔴 The first version of this budget was the constant 2, chosen on the machine
 * that hit the OOM. A constant cannot be right for both a 8 GiB laptop and a
 * 64 GiB workstation: it either makes the workstation crawl or leaves the
 * laptop dying, and both end with someone reaching for `--no-verify`.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_CONCURRENCY,
  MAX_WORKERS,
  deriveLimits,
  parseOverride,
} from "./local-limits.mjs";

const GIB = 1024 ** 3;
const machine = (gib, cpus, env = {}) =>
  deriveLimits({ totalBytes: gib * GIB, cpus, env });

describe("budgeting a machine", () => {
  /*
   * The load-bearing case, and the only number here taken from a measurement
   * rather than from the formula. On a 9.7 GiB / 8-core profile, 2 x 2 was
   * observed to be survivable through a full unfiltered gate run: peak 2
   * concurrent heavy workers, memory never below 4.7 GiB, swap untouched. The
   * formula has to reproduce that without having been told it, which is what
   * makes it evidence rather than a fitted constant.
   */
  it("reproduces the measured-safe budget for a 9.7 GiB / 8-core profile", () => {
    const limits = machine(9.7, 8);
    expect(limits.concurrency).toBe(2);
    expect(limits.maxWorkers).toBe(2);
  });

  it("protects a small machine rather than assuming everyone has headroom", () => {
    expect(machine(4, 4).concurrency * machine(4, 4).maxWorkers).toBe(1);
  });

  it("gives a workstation more than a laptop", () => {
    const laptop = machine(8, 4);
    const workstation = machine(64, 32);
    const peak = l => l.concurrency * l.maxWorkers;
    expect(peak(workstation)).toBeGreaterThan(peak(laptop));
  });

  it("never exceeds the declared ceilings", () => {
    const huge = machine(512, 128);
    expect(huge.concurrency).toBeLessThanOrEqual(MAX_CONCURRENCY);
    expect(huge.maxWorkers).toBeLessThanOrEqual(MAX_WORKERS);
  });

  it("never returns zero, which would mean no work at all", () => {
    for (const gib of [0.5, 1, 2, 3, 4]) {
      const limits = machine(gib, 1);
      expect(limits.concurrency).toBeGreaterThanOrEqual(1);
      expect(limits.maxWorkers).toBeGreaterThanOrEqual(1);
    }
  });

  /*
   * Cores bound it as well as memory. A container with a large memory limit and
   * one core should not start four package tasks.
   */
  it("lets a low core count hold it down even with plenty of memory", () => {
    expect(machine(64, 1).concurrency * machine(64, 1).maxWorkers).toBe(1);
  });

  it("grows monotonically with memory, so a bigger machine is never slower", () => {
    const peak = gib => {
      const l = machine(gib, 32);
      return l.concurrency * l.maxWorkers;
    };
    const series = [4, 8, 16, 32, 64].map(peak);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
  });
});

describe("letting a person override it", () => {
  it("takes an explicit concurrency", () => {
    expect(machine(9.7, 8, { NEXTLY_LOCAL_CONCURRENCY: "6" }).concurrency).toBe(6);
  });

  it("takes an explicit worker count", () => {
    expect(machine(9.7, 8, { NEXTLY_LOCAL_MAX_WORKERS: "1" }).maxWorkers).toBe(1);
  });

  it("says when a value was overridden, so the reported number is not mistaken for the derived one", () => {
    expect(machine(9.7, 8, { NEXTLY_LOCAL_CONCURRENCY: "6" }).overridden).toBe(true);
    expect(machine(9.7, 8).overridden).toBe(false);
  });

  /*
   * A malformed override must fall back to the derived value rather than to
   * turbo's default of 10. `NEXTLY_LOCAL_CONCURRENCY=` in a shell profile is
   * the likely spelling, and it must not unbound the gate.
   */
  it.each([["", "empty"], ["0", "zero"], ["-1", "negative"], ["abc", "text"], ["2.5", "fractional"]])(
    "ignores a %s override rather than unbounding",
    raw => {
      expect(parseOverride(raw)).toBeNull();
      expect(machine(9.7, 8, { NEXTLY_LOCAL_CONCURRENCY: raw }).concurrency).toBe(2);
    }
  );
});

describe("being deterministic", () => {
  /*
   * `os.freemem()` is deliberately not an input. It swings with page cache, so
   * using it would make the same command bounded differently on two consecutive
   * runs, and a gate whose strictness depends on when you ran it cannot be
   * reasoned about — or reproduced in a bug report.
   */
  it("gives the same answer for the same machine every time", () => {
    const a = machine(16, 8);
    const b = machine(16, 8);
    expect(a.concurrency).toBe(b.concurrency);
    expect(a.maxWorkers).toBe(b.maxWorkers);
  });
});
