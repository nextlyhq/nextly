/**
 * The checklist's steps are DERIVED from the Get started answer, and a setup
 * that is not known holds `onboarding:incomplete` and is carried to the card.
 */
import { describe, expect, it } from "vitest";

import type { ConditionProbe } from "../condition-probe";
import type { GetStartedDetail } from "../get-started";
import type {
  GetStartedAnswer,
  GetStartedStepKind,
} from "../get-started-steps";
import { onboardingIsIncomplete, onboardingProgress } from "../onboarding";

function probeAnswering(
  answer: GetStartedAnswer,
  // A step whose own check fell back, which the answer withholds; and
  // whether the registries were unlisted, which the answer's `unknown` covers
  // unless something fell back.
  fallback: { fellBack?: GetStartedStepKind[]; unlisted?: boolean } = {}
): ConditionProbe {
  const detail: GetStartedDetail = {
    answer,
    fellBack: new Set(fallback.fellBack ?? []),
    unlisted: fallback.unlisted ?? answer.unknown,
  };
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
    mayCreateOnDashboard: unused,
    mayReadReleases: unused,
    releasesExist: unused,
    getStarted: async () => answer,
    getStartedDetail: async () => detail,
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
  it("draw a step whose own check fell back as a row not complete, and say not known only for an unlisted registry", async () => {
    // 🔴 Deprecated and unchanged until removed: the Get started answer
    // withholds a fallen-back step and is "not known"; this read keeps the
    // row it always drew and answers "not known" only as it always did.
    const progress = await onboardingProgress(
      probeAnswering(
        { unknown: true, steps: [], done: 0, total: 0 },
        { fellBack: ["collection"], unlisted: false }
      )
    );
    expect(progress).toEqual({
      steps: [
        { id: "account", complete: true },
        { id: "collection", complete: false },
      ],
      unknown: false,
    });
  });

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
