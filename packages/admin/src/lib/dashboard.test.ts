/**
 * Dashboard utility functions tests
 *
 * @module lib/dashboard.test
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { describeActivityActor, formatRelativeTime } from "./dashboard";
import {
  getGlobalDateTimeConfig,
  setGlobalDateTimeConfig,
} from "./dates/format";

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
    // Carries the year even though only month and day are requested: the
    // shared formatter fills in `year: "numeric"` whenever the caller does not
    // name one, so anything past the relative window reads as "Mar 1, 2026".
    expect(formatRelativeTime("2026-03-01T12:00:00Z")).toBe("Mar 1, 2026");
  });

  it("dates an older time in the admin's timezone, not the browser's", () => {
    const before = getGlobalDateTimeConfig();
    try {
      // 12:30 on 28 February in UTC is already 1 March at UTC+14: the day
      // shown is the one the admin is set to, whatever zone the browser is in.
      setGlobalDateTimeConfig({ timezone: "Pacific/Kiritimati" });
      const now = Date.parse("2026-03-20T12:00:00Z");
      expect(formatRelativeTime("2026-02-28T12:30:00Z", now)).toBe(
        "Mar 1, 2026"
      );
      setGlobalDateTimeConfig({ timezone: "Pacific/Pago_Pago" });
      expect(formatRelativeTime("2026-02-28T12:30:00Z", now)).toBe(
        "Feb 28, 2026"
      );
    } finally {
      setGlobalDateTimeConfig(before);
    }
  });

  it("drops the words in its short style, at the same thresholds", () => {
    const at = Date.parse("2026-03-08T12:00:00Z");
    const short = (iso: string) => formatRelativeTime(iso, at, "short");
    expect(short("2026-03-08T11:59:45Z")).toBe("now");
    expect(short("2026-03-08T11:55:00Z")).toBe("5m");
    expect(short("2026-03-08T09:00:00Z")).toBe("3h");
    expect(short("2026-03-06T12:00:00Z")).toBe("2d");
    // Past the relative window, the date, as the long style draws it.
    expect(short("2026-03-01T12:00:00Z")).toBe(
      formatRelativeTime("2026-03-01T12:00:00Z", at)
    );
  });
});

describe("describeActivityActor", () => {
  it("names an API key rather than rendering a blank actor", () => {
    // A key has no account, so no name, no email and no erasure stamp. Without
    // its own branch it falls through to the live-actor case and renders an
    // empty name — a feed less attributable than the one before keys were
    // recorded at all.
    const actor = describeActivityActor({
      userId: "k1b2c3d4-0000-4000-8000-000000000009",
      userName: null,
      userEmail: null,
      identityErasedAt: null,
      actorType: "apiKey",
    });
    expect(actor.name).toContain("API key");
    // The key's own id, so two keys are told apart rather than both reading
    // "API key".
    expect(actor.name).toContain("k1b2c3d4");
    expect(actor.initials).toBeTruthy();
    // Not a deleted person: nothing was erased, and saying so would send a
    // reader looking for an account that never existed.
    expect(actor.deleted).toBe(false);
    expect(actor.email).toBeNull();
  });

  it("names an internal write rather than rendering a blank actor", () => {
    // A system actor has no account either, so it falls through to the
    // live-actor case and renders blank for the same reason a key did.
    const actor = describeActivityActor({
      userId: "system",
      userName: null,
      userEmail: null,
      identityErasedAt: null,
      actorType: "system",
    });
    expect(actor.name).toBeTruthy();
    expect(actor.name).not.toContain("API key");
    expect(actor.initials).toBeTruthy();
    expect(actor.deleted).toBe(false);
  });

  it("reads an ABSENT kind as a user", () => {
    // A server older than this admin does not send the field. Before it
    // existed only a signed-in person could be recorded, so the absence is
    // read rather than guessed — and treating it as a non-person would
    // attribute a real person's write to a machine.
    const actor = describeActivityActor({
      userId: "a1b2c3d4-0000-4000-8000-000000000001",
      userName: "Ada Author",
      userEmail: "ada@example.com",
      identityErasedAt: null,
    });
    expect(actor.name).toBe("Ada Author");
  });

  it("shows a deleted PERSON as deleted, not as a key", () => {
    // The control for the branch above: the key case is checked first, so a
    // condition that matched too broadly would relabel every erased account.
    const actor = describeActivityActor({
      userId: "a1b2c3d4-0000-4000-8000-000000000001",
      userName: null,
      userEmail: null,
      identityErasedAt: "2026-03-06T12:00:00Z",
      actorType: "user",
    });
    expect(actor.deleted).toBe(true);
    expect(actor.name).not.toContain("API key");
  });

  // A live actor: `identityErasedAt` is null, which is the single field that
  // decides every case below. Each test starts from this and changes only what
  // it is about, so a failure names the difference that caused it.
  const live = {
    userId: "a1b2c3d4-0000-4000-8000-000000000001",
    userName: "Ada Author",
    userEmail: "ada@example.com",
    identityErasedAt: null,
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
      identityErasedAt: "2026-08-03T10:00:00Z",
    });

    expect(actor.deleted).toBe(true);
    expect(actor.name).toBe("[deleted user · a1b2c3d4]");
    expect(actor.id).toBe(live.userId);
    expect(actor.email).toBeNull();
  });

  it("tells two deleted actors apart", () => {
    // The whole reason the opaque id outlives the account: without it every
    // deleted actor collapses into one indistinguishable "[deleted user]".
    const first = describeActivityActor({
      ...live,
      userName: null,
      identityErasedAt: "2026-08-03T10:00:00Z",
    });
    const second = describeActivityActor({
      ...live,
      userId: "9f8e7d6c-0000-4000-8000-000000000002",
      userName: null,
      identityErasedAt: "2026-08-03T10:00:00Z",
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
