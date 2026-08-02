/**
 * Dashboard utility functions tests
 *
 * @module lib/dashboard.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { describeActivityActor, formatRelativeTime } from "./dashboard";

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

describe("describeActivityActor", () => {
  const live = {
    userId: "a1b2c3d4-0000-4000-8000-000000000001",
    userName: "Ada Author",
    userEmail: "ada@example.com",
    actorDeletedAt: null,
  };

  it("shows a live actor by name", () => {
    expect(describeActivityActor(live)).toEqual({
      id: live.userId,
      name: "Ada Author",
      email: "ada@example.com",
      initials: "AA",
      deleted: false,
    });
  });

  it("names a deleted actor by the surviving id, not by nothing", () => {
    // The entry still has to say an account did this, or the audit line reads
    // as if it happened by itself.
    const actor = describeActivityActor({
      ...live,
      userName: null,
      userEmail: null,
      actorDeletedAt: "2026-08-03T10:00:00Z",
    });

    expect(actor.deleted).toBe(true);
    expect(actor.name).toBe("[deleted user · a1b2]");
    expect(actor.id).toBe(live.userId);
    expect(actor.email).toBeNull();
  });

  it("tells two deleted actors apart", () => {
    // The whole reason the opaque id outlives the account: without it every
    // deleted actor collapses into one indistinguishable "[deleted user]".
    const first = describeActivityActor({
      ...live,
      userName: null,
      actorDeletedAt: "2026-08-03T10:00:00Z",
    });
    const second = describeActivityActor({
      ...live,
      userId: "9f8e7d6c-0000-4000-8000-000000000002",
      userName: null,
      actorDeletedAt: "2026-08-03T10:00:00Z",
    });

    expect(first.name).not.toBe(second.name);
  });

  it("does not call a live nameless actor deleted", () => {
    // The stamp is the authority. A live account with no name would otherwise
    // be labelled deleted, which is worse than an empty label.
    const actor = describeActivityActor({ ...live, userName: null });

    expect(actor.deleted).toBe(false);
    expect(actor.name).toBe("");
  });
});
