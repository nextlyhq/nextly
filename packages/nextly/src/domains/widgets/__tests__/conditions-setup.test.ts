/**
 * `onboarding:incomplete` is derived from the setup card's own answer, with
 * the reader's skips applied as the card applies them, and fails VISIBLE: a
 * setup that is not known, or a check that threw, holds the condition rather
 * than hiding the card that says so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The reader's stored preferences, over a map keyed by reader and key, as the table is.
const { stored, unreadable } = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  unreadable: { now: false },
}));
vi.mock("../../dashboard/dashboard-preferences", () => ({
  DashboardPreferences: class {
    get(userId: string, key: string): Promise<string | undefined> {
      if (unreadable.now) return Promise.reject(new Error("preferences down"));
      return Promise.resolve(stored.get(`${userId}:${key}`));
    }
  },
}));
vi.mock("../../../di/container", () => ({
  container: { get: () => ({}) },
}));

import type { ConditionProbe } from "../condition-probe";
import { evaluateConditions } from "../conditions";
import type { SetupAnswer } from "../setup-steps";

const caller = { user: { id: "u1", roles: ["editor"] } };

/** A probe whose only answer is the setup one: no other read is asked. */
function probeAnswering(setup: () => Promise<SetupAnswer>): ConditionProbe {
  return { caller, setup } as unknown as ConditionProbe;
}

async function verdict(setup: () => Promise<SetupAnswer>) {
  const verdicts = await evaluateConditions(
    new Set(["onboarding:incomplete"]),
    caller,
    probeAnswering(setup)
  );
  return verdicts.get("onboarding:incomplete");
}

/** Invite still open in the steps as detected, before any skip. */
const inviteOpen = async (): Promise<SetupAnswer> => ({
  known: true,
  steps: [
    { kind: "collection", status: "done" },
    { kind: "invite", status: "open" },
  ],
  done: 1,
  total: 2,
});

beforeEach(() => {
  stored.clear();
  unreadable.now = false;
});

describe("onboarding:incomplete", () => {
  it("holds when the setup check throws, where every other condition goes unanswered", async () => {
    expect(await verdict(() => Promise.reject(new Error("down")))).toBe(true);
  });

  it("holds while setup is not known", async () => {
    expect(await verdict(async () => ({ known: false }))).toBe(true);
  });

  it("holds while a step is open, and not once every step is done or skipped", async () => {
    // The must-differ half: a condition that always held would pass the cases above.
    expect(
      await verdict(async () => ({
        known: true,
        steps: [
          { kind: "collection", status: "done" },
          { kind: "invite", status: "open" },
        ],
        done: 1,
        total: 2,
      }))
    ).toBe(true);
    expect(
      await verdict(async () => ({
        known: true,
        steps: [
          { kind: "collection", status: "done" },
          { kind: "invite", status: "skipped" },
        ],
        done: 2,
        total: 2,
      }))
    ).toBe(false);
  });

  it("does not hold once the reader skipped their last open step, as their card counts it", async () => {
    // The must-differ half: the same detected steps hold for a reader with no skip.
    expect(await verdict(inviteOpen)).toBe(true);
    stored.set("u1:setup-skipped-invite", "true");
    expect(await verdict(inviteOpen)).toBe(false);
  });

  it("does not hold once the reader's card has said You're all set", async () => {
    stored.set("u1:setup-retired", "2026-10-30T09:00:00.000Z");
    expect(await verdict(inviteOpen)).toBe(false);
  });

  it("holds when the reader's preferences cannot be read", async () => {
    stored.set("u1:setup-skipped-invite", "true");
    unreadable.now = true;
    expect(await verdict(inviteOpen)).toBe(true);
  });
});
