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
    // Carries the year even though only month and day are requested: the
    // shared formatter fills in `year: "numeric"` whenever the caller does not
    // name one, so anything past the relative window reads as "Mar 1, 2026".
    expect(formatRelativeTime("2026-03-01T12:00:00Z")).toBe("Mar 1, 2026");
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
