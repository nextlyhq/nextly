/**
 * `onboarding:incomplete` is derived from the setup card's own answer, and
 * fails VISIBLE: a setup that is not known, or a check that threw, holds the
 * condition rather than hiding the card that says so.
 */
import { describe, expect, it } from "vitest";

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
});
