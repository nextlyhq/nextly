/**
 * Dashboard utility functions tests
 *
 * @module lib/dashboard.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { formatRelativeTime } from "./dashboard";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:30Z"));
    expect(formatRelativeTime("2026-03-06T12:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for timestamps less than 60 minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:05:00Z"));
    expect(formatRelativeTime("2026-03-06T12:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for timestamps less than 24 hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T15:00:00Z"));
    expect(formatRelativeTime("2026-03-06T12:00:00Z")).toBe("3h ago");
  });

  it("returns days ago for timestamps less than 7 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T12:00:00Z"));
    expect(formatRelativeTime("2026-03-06T12:00:00Z")).toBe("2d ago");
  });

  it("returns formatted date for timestamps 7+ days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00Z"));
    expect(formatRelativeTime("2026-03-01T12:00:00Z")).toBe("Mar 1");
  });
});
