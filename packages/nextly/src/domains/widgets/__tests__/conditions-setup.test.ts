/**
 * `onboarding:incomplete` fails VISIBLE: a setup that is not known, or a check
 * that threw, holds the condition rather than hiding the card that says so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { incomplete } = vi.hoisted(() => ({ incomplete: vi.fn() }));
vi.mock("../onboarding", () => ({ onboardingIsIncomplete: incomplete }));

import { evaluateConditions } from "../conditions";

const caller = { user: { id: "u1", roles: ["editor"] } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onboarding:incomplete", () => {
  it("holds when the setup check throws, where every other condition goes unanswered", async () => {
    incomplete.mockRejectedValue(new Error("registry down"));
    const verdicts = await evaluateConditions(
      new Set(["onboarding:incomplete"]),
      caller
    );
    expect(verdicts.get("onboarding:incomplete")).toBe(true);
  });

  it("passes the check's own answer through when it answers", async () => {
    // The must-differ half: a condition that always held would pass the case above.
    incomplete.mockResolvedValue(false);
    const verdicts = await evaluateConditions(
      new Set(["onboarding:incomplete"]),
      caller
    );
    expect(verdicts.get("onboarding:incomplete")).toBe(false);
  });
});
