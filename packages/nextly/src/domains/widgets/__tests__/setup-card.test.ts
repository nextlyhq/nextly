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
  conditionProbe: () => ({ setup: steps }),
}));

import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import {
  changeSetupState,
  readSetupState,
  setupCardData,
  setupShownTo,
} from "../setup-card";
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

  it("stores skips in one spelling, and restores one", async () => {
    await changeSetupState("ana", { skip: { kind: "invite", skipped: true } });
    await changeSetupState("ana", { skip: { kind: "singles", skipped: true } });
    expect(stored.get("ana:setup-skipped")).toBe("singles,invite");
    await changeSetupState("ana", {
      skip: { kind: "singles", skipped: false },
    });
    expect([...(await readSetupState("ana")).skipped]).toEqual(["invite"]);
  });
});
