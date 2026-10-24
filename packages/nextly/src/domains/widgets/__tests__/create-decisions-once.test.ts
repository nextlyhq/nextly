/**
 * The create decision behind the dashboard, made once per collection per
 * request: the onboarding step and the Create card's condition both ask it, of
 * overlapping collections, through the real probe and the real reader, with the
 * permission decision counted at its own seam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  callerMayPerform: vi.fn(),
  /** The registry record's create-disabled collections; `undefined` is never read. */
  createDisabled: undefined as ReadonlySet<string> | undefined,
}));
vi.mock("../../../auth/access/route-gate-adapters", () => ({
  callerMayPerform: seams.callerMayPerform,
}));
vi.mock("../collection-sources", async importOriginal => ({
  ...(await importOriginal<typeof import("../collection-sources")>()),
  createDisabledCollections: () => seams.createDisabled,
}));
vi.mock("../reader-content", async importOriginal => ({
  ...(await importOriginal<typeof import("../reader-content")>()),
  readableOfKind: async () => ({
    slugs: ["posts", "notes", "submissions"],
    reachable: true,
  }),
}));

import { conditionProbe } from "../condition-probe";
import { evaluateConditions } from "../conditions";

const caller = { user: { id: "u1", roles: ["editor"] } };

/** The collections the permission decision was asked about, in order. */
const asked = () =>
  seams.callerMayPerform.mock.calls.map(call => call[2] as string);

beforeEach(() => {
  vi.clearAllMocks();
  seams.createDisabled = new Set(["submissions"]);
});

describe("the create decision, asked by the onboarding step and Create alike", () => {
  it("decides each collection once, though both ask about it", async () => {
    seams.callerMayPerform.mockResolvedValue(false);
    const probe = conditionProbe(caller);
    expect(
      await Promise.all([probe.mayCreateEntry(), probe.mayCreateOnDashboard()])
    ).toEqual([false, false]);
    // 🔴 Each collection's rules ran once: posts and notes are asked by both.
    expect(asked().sort()).toEqual(["notes", "posts", "submissions"]);
  });

  it("gives both the same answer about a collection whose rule changes its mind", async () => {
    // A rule that grants once and refuses after: asked twice, the onboarding
    // step and the Create card would disagree within one response.
    seams.callerMayPerform.mockResolvedValueOnce(true).mockResolvedValue(false);
    const probe = conditionProbe(caller);
    const [step, card] = await Promise.all([
      probe.mayCreateEntry(),
      probe.mayCreateOnDashboard(),
    ]);
    // The one grant reaches both: equal answers alone would also pass for a
    // decision both consumers threw away.
    expect([step, card]).toEqual([true, true]);
    expect(asked().filter(slug => slug === "posts")).toHaveLength(1);
  });

  it("withholds Create while the collection registry has never been read", async () => {
    seams.createDisabled = undefined;
    seams.callerMayPerform.mockResolvedValue(true);
    // Unknown is not "none turn creating off": the card would otherwise be
    // offered on a collection it then leaves out.
    await expect(
      conditionProbe(caller).mayCreateOnDashboard()
    ).rejects.toThrow();
    const verdicts = await evaluateConditions(
      new Set(["create:available"] as const),
      caller
    );
    expect(verdicts.get("create:available")).not.toBe(true);
  });
});
