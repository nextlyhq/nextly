/**
 * The checklist's steps are DERIVED from the Get started answer, and a setup
 * that is not known holds `onboarding:incomplete` and is carried to the card.
 */
import { describe, expect, it } from "vitest";

import type { ConditionProbe } from "../condition-probe";
import type { GetStartedAnswer } from "../get-started-steps";
import { onboardingIsIncomplete, onboardingProgress } from "../onboarding";

function probeAnswering(answer: GetStartedAnswer): ConditionProbe {
  const unused = () => Promise.reject(new Error("not under test"));
  return {
    caller: { user: { id: "u1", roles: [] } },
    readableSlugs: unused,
    readableSingles: unused,
    collectionsRead: unused,
    singlesRead: unused,
    hasContent: unused,
    mayCreateEntry: unused,
    mayCreateCollection: unused,
    mayReadReleases: unused,
    releasesExist: unused,
    getStarted: async () => answer,
  };
}

const known = (statuses: Array<["collection" | "entry" | "invite", string]>) =>
  ({
    unknown: false,
    steps: statuses.map(([kind, status]) => ({ key: kind, kind, status })),
    done: 0,
    total: statuses.length,
  }) as GetStartedAnswer;

describe("the checklist's steps", () => {
  it("are the answer's collection and entry steps, after the account", async () => {
    const { steps } = await onboardingProgress(
      probeAnswering(
        known([
          ["collection", "done"],
          ["entry", "unknown"],
          ["invite", "open"],
        ])
      )
    );
    // A step not known is not complete; a kind this list does not name is not drawn.
    expect(steps).toEqual([
      { id: "account", complete: true },
      { id: "collection", complete: true },
      { id: "entry", complete: false },
    ]);
  });

  it("leave out a step the answer did not offer", async () => {
    expect(
      (
        await onboardingProgress(
          probeAnswering(known([["collection", "done"]]))
        )
      ).steps
    ).toEqual([
      { id: "account", complete: true },
      { id: "collection", complete: true },
    ]);
  });

  it("carry a setup that is not known to the card, though every row reads done", async () => {
    // 🔴 The condition holds the card while setup is not known. Were the card
    // handed the rows alone, it would draw them all ticked and ask for a
    // layout that offers it again.
    const progress = await onboardingProgress(
      probeAnswering({ ...known([["collection", "done"]]), unknown: true })
    );
    expect(progress.steps.every(step => step.complete)).toBe(true);
    expect(progress.unknown).toBe(true);
    // The must-differ half: a setup that was checked says so.
    expect(
      (
        await onboardingProgress(
          probeAnswering(known([["collection", "done"]]))
        )
      ).unknown
    ).toBe(false);
  });
});

describe("onboarding:incomplete", () => {
  it("holds while setup is not known, though every listed step reads done", async () => {
    const answer = { ...known([["collection", "done"]]), unknown: true };
    expect(await onboardingIsIncomplete(probeAnswering(answer))).toBe(true);
  });

  it("lapses once every listed step is done, and holds while one is not", async () => {
    expect(
      await onboardingIsIncomplete(
        probeAnswering(
          known([
            ["collection", "done"],
            ["entry", "done"],
          ])
        )
      )
    ).toBe(false);
    expect(
      await onboardingIsIncomplete(
        probeAnswering(
          known([
            ["collection", "done"],
            ["entry", "open"],
          ])
        )
      )
    ).toBe(true);
  });
});
