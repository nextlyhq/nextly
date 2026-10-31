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

import { conditionProbe, type ConditionProbe } from "../condition-probe";
import { evaluateConditions } from "../conditions";
import { setupSteps } from "../setup";

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

describe("the collection Add your first entry opens", () => {
  /** The create decision: `posts` as `postsAnswer` says, every other collection refused. */
  function decide(postsAnswer: () => Promise<boolean>): void {
    seams.callerMayPerform.mockImplementation(
      (_scope: unknown, _action: string, resource: string) =>
        resource === "posts" ? postsAnswer() : Promise.resolve(false)
    );
  }

  /**
   * The real probe's create decisions, over a site with no entry: only the
   * reads the entry step does not make are stood in for, so its answer comes
   * from `firstCreatableCollection` as the probe resolves it.
   */
  function emptySite(): ConditionProbe {
    const probe = conditionProbe(caller);
    return {
      ...probe,
      hasContent: async () => false,
      sampleAnswered: async () => true,
      sampleContent: async () => ({ answer: "declined" }),
      singlesRead: async () => ({ slugs: [], reachable: true }),
    };
  }

  it("is not known when a decision that could have been the grant threw, so setup is not known", async () => {
    decide(() => Promise.reject(new Error("access service down")));
    await expect(emptySite().firstCreatableCollection()).rejects.toThrow();
    expect(await setupSteps(emptySite())).toEqual({ known: false });
  });

  it("is none, and the step not offered, when every decision answered no", async () => {
    // The must-differ half: the same site with the decision answered rather than thrown.
    decide(() => Promise.resolve(false));
    expect(await emptySite().firstCreatableCollection()).toBeUndefined();
    const answer = await setupSteps(emptySite());
    expect(answer.known && answer.steps.map(step => step.kind)).toEqual([
      "sample",
      "collection",
    ]);
  });

  it("names the collection a decision granted", async () => {
    decide(() => Promise.resolve(true));
    expect(await emptySite().firstCreatableCollection()).toBe("posts");
  });
});
