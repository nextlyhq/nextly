// F10 PR 5 — relative-time formatter tests.

import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "../relative-time";

const NOW = new Date("2026-04-30T12:00:00.000Z").getTime();
const now = (): number => NOW;

describe("formatRelativeTime", () => {
  it('returns "just now" when diff is < 5s', () => {
    expect(formatRelativeTime("2026-04-30T11:59:58.000Z", now)).toBe(
      "just now"
    );
  });

  it('returns "Xs ago" between 5s and 60s', () => {
    expect(formatRelativeTime("2026-04-30T11:59:30.000Z", now)).toBe("30s ago");
  });

  it('returns "Xm ago" between 1m and 60m', () => {
    expect(formatRelativeTime("2026-04-30T11:30:00.000Z", now)).toBe("30m ago");
  });

  it('returns "Xh ago" between 1h and 24h', () => {
    expect(formatRelativeTime("2026-04-30T07:00:00.000Z", now)).toBe("5h ago");
  });

  it('returns "Xd ago" between 1d and 7d', () => {
    expect(formatRelativeTime("2026-04-27T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("falls back to absolute date for older timestamps", () => {
    const out = formatRelativeTime("2026-03-01T12:00:00.000Z", now);
    expect(out).toContain("Mar");
    expect(out).toContain("2026");
  });

  it('treats future timestamps as "just now" defensively', () => {
    expect(formatRelativeTime("2026-04-30T12:00:30.000Z", now)).toBe(
      "just now"
    );
  });

  it("returns the input for unparseable timestamps (defensive)", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("not-a-date");
  });
});
