/**
 * The setup card's server half, over a stand-in preferences store and a
 * stand-in step answer: who it shows to, the "You're all set" retirement, and
 * what a reader's change writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { superAdmin, stored, steps } = vi.hoisted(() => ({
  superAdmin: vi.fn(),
  stored: new Map<string, string>(),
  steps: vi.fn(),
}));
vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdminOrRefuse: superAdmin,
}));
// The repository over a map, keyed by reader and key, as the table is.
vi.mock("../../dashboard/dashboard-preferences", () => ({
  DashboardPreferences: class {
    get(userId: string, key: string): Promise<string | undefined> {
      return Promise.resolve(stored.get(`${userId}:${key}`));
    }
    set(userId: string, key: string, value: string): Promise<void> {
      stored.set(`${userId}:${key}`, value);
      return Promise.resolve();
    }
  },
}));
vi.mock("../../../di/container", () => ({
  container: { get: () => ({}) },
}));
vi.mock("../condition-probe", () => ({
  conditionProbe: (caller: unknown) => ({ caller, setup: steps }),
}));
// The caller a card's read services were bound for: the services stand for it.
vi.mock("../declaration/read-services", () => ({
  boundCaller: (services: { caller: unknown }) => services.caller,
}));

import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { setupWidget } from "../core-widgets/setup";
import {
  changeSetupState,
  registerSetupCard,
  setupCardData,
  setupShownTo,
} from "../setup-card";
import { readSetupState } from "../setup-reader";
import type { SetupAnswer } from "../setup-steps";

const person: ReadCaller = { user: { id: "ana" } };
const key: ReadCaller = {
  user: { id: "ana" },
  authenticatedScope: { actorType: "apiKey", permissions: [] },
};
const now = new Date("2026-10-30T09:00:00.000Z");

const open: SetupAnswer = {
  known: true,
  steps: [
    { kind: "collection", status: "done" },
    { kind: "invite", status: "open" },
  ],
  done: 1,
  total: 2,
};
const finished: SetupAnswer = {
  known: true,
  steps: [
    { kind: "collection", status: "done" },
    { kind: "invite", status: "done" },
  ],
  done: 2,
  total: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  superAdmin.mockResolvedValue(true);
  steps.mockResolvedValue(open);
});

describe("who the card shows to", () => {
  it("shows only to a super-admin person", async () => {
    expect(await setupShownTo(person)).toBe(true);
    superAdmin.mockResolvedValue(false);
    expect(await setupShownTo(person)).toBe(false);
  });

  it("never shows to an API key, whoever made it, and asks no role for one", async () => {
    expect(await setupShownTo(key)).toBe(false);
    expect(superAdmin).not.toHaveBeenCalled();
  });

  it("refuses rather than shows when the roles cannot be read", async () => {
    superAdmin.mockRejectedValue(new Error("roles unreadable"));
    await expect(setupShownTo(person)).rejects.toThrow();
  });

  it("is left out once its reader dismissed it, and back once they resume", async () => {
    await changeSetupState("ana", { dismissed: true });
    expect(await setupShownTo(person)).toBe(false);
    await changeSetupState("ana", { dismissed: false });
    expect(await setupShownTo(person)).toBe(true);
  });
});

describe('"You\'re all set", once', () => {
  it("records the retirement on the load that finds every step done, and shows is false after it", async () => {
    steps.mockResolvedValue(finished);
    const first = await setupCardData(person, now);
    expect(first.allSet).toBe(true);
    expect(stored.get("ana:setup-retired")).toBe(now.toISOString());
    expect(await setupShownTo(person)).toBe(false);
  });

  it("records nothing while a step is open, or setup is not known", async () => {
    expect((await setupCardData(person, now)).allSet).toBe(false);
    steps.mockResolvedValue({ known: false });
    expect((await setupCardData(person, now)).allSet).toBe(false);
    expect(stored.has("ana:setup-retired")).toBe(false);
    expect(await setupShownTo(person)).toBe(true);
  });

  it("judges all set over the steps the card draws: a sample step the route refuses this reader holds nothing open", async () => {
    // Builder off, no collection, nothing to create in, no sample route, Invite skipped:
    // the card draws one tile, "1 of 1 done".
    steps.mockResolvedValue({
      known: true,
      steps: [
        { kind: "sample", status: "open" },
        { kind: "invite", status: "open" },
      ],
      done: 0,
      total: 2,
    });
    await changeSetupState("ana", { skip: { kind: "invite", skipped: true } });
    // The must-differ half: where the route was not asked, the open sample step holds it open.
    expect((await setupCardData(person, now)).allSet).toBe(false);
    expect(stored.has("ana:setup-retired")).toBe(false);
    const refused = await setupCardData(person, now, { sampleRefused: true });
    expect(refused.allSet).toBe(true);
    expect(stored.get("ana:setup-retired")).toBe(now.toISOString());
  });

  it("never passes over a sample step the route offers, nor one already answered", async () => {
    steps.mockResolvedValue({
      known: true,
      steps: [
        { kind: "sample", status: "open" },
        { kind: "invite", status: "done" },
      ],
      done: 1,
      total: 2,
    });
    expect(
      (await setupCardData(person, now, { sampleRefused: false })).allSet
    ).toBe(false);
    expect(stored.has("ana:setup-retired")).toBe(false);
  });

  it("counts a skipped step as done, so a skip can finish setup", async () => {
    await changeSetupState("ana", { skip: { kind: "invite", skipped: true } });
    const card = await setupCardData(person, now);
    expect(card.allSet).toBe(true);
    expect(card.setup.known && card.setup.done).toBe(2);
  });
});

describe("what a reader's card remembers", () => {
  it("answers the collapse with the card's data", async () => {
    expect((await setupCardData(person, now)).collapsed).toBe(false);
    await changeSetupState("ana", { collapsed: true });
    expect((await setupCardData(person, now)).collapsed).toBe(true);
  });

  it("keeps each reader's own state apart", async () => {
    await changeSetupState("ana", { collapsed: true, dismissed: true });
    expect((await readSetupState("rui")).collapsed).toBe(false);
    expect((await readSetupState("rui")).dismissed).toBe(false);
  });

  it("keeps both of two skips written at once, and restores one", async () => {
    // From two devices at the same moment: neither write may undo the other.
    await Promise.all([
      changeSetupState("ana", { skip: { kind: "invite", skipped: true } }),
      changeSetupState("ana", { skip: { kind: "singles", skipped: true } }),
    ]);
    expect([...(await readSetupState("ana")).skipped].sort()).toEqual([
      "invite",
      "singles",
    ]);
    // One row per step.
    expect(stored.get("ana:setup-skipped-invite")).toBe("true");
    expect(stored.get("ana:setup-skipped-singles")).toBe("true");
    await changeSetupState("ana", {
      skip: { kind: "singles", skipped: false },
    });
    expect([...(await readSetupState("ana")).skipped]).toEqual(["invite"]);
  });
});

describe("the card's declaration", () => {
  type LoadInput = Parameters<typeof setupWidget.load>[0];
  /** What the frame hands `shows` and `load`: read services bound for `caller`, at `now`. */
  const asked = (caller: ReadCaller) =>
    ({ services: { caller }, now }) as unknown as LoadInput;

  it("answers shows and load from the reads registered at boot, as the caller its services were bound for", async () => {
    registerSetupCard();
    expect(await setupWidget.shows?.(asked(person))).toBe(true);
    expect(await setupWidget.shows?.(asked(key))).toBe(false);
    const data = await setupWidget.load(asked(person));
    expect(data).toEqual({ setup: open, collapsed: false, allSet: false });
  });
});
