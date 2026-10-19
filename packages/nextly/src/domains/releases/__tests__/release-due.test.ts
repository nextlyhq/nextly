/**
 * The due boundary, stated once: the drain's query and the read-side resolver
 * take it from the same condition, so they meet at the same instant.
 */
import { describe, expect, it } from "vitest";

import { isDueAt, releaseDueCondition } from "../release-due";
import { resolveReleaseEffect } from "../resolve-release-effect";

const NOW = new Date("2026-10-16T09:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the release due boundary", () => {
  it("is due at the instant and before it, and not after", () => {
    expect(isDueAt(at(-1), NOW)).toBe(true);
    expect(isDueAt(at(0), NOW)).toBe(true);
    expect(isDueAt(at(1), NOW)).toBe(false);
  });

  it("is the condition the drain queries by", () => {
    expect(releaseDueCondition(NOW)).toEqual({
      column: "scheduledAt",
      op: "<=",
      value: NOW,
    });
  });

  it("is the boundary the resolver applies to a member", () => {
    // A member exactly at the instant takes effect; one a millisecond later
    // does not — the same answers the drain's query gives.
    const member = (ms: number) => ({
      memberId: `m${ms}`,
      releaseId: `r${ms}`,
      action: "publish" as const,
      scheduledAt: at(ms),
      createdAt: at(-60_000),
    });
    expect(
      resolveReleaseEffect({ members: [member(0)], now: NOW }).effect
    ).toBe("publish");
    expect(
      resolveReleaseEffect({ members: [member(1)], now: NOW }).effect
    ).toBe("none");
  });
});
