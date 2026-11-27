/**
 * The level, door and exit-code lists the checks and `levelForRun` read are
 * frozen, so code that holds them cannot reorder or extend what every
 * declaration is judged by.
 */
import { describe, expect, it } from "vitest";

import { DOORS, RISK_LEVELS, SHARED_EXIT_CODES } from "../definition";
import { levelForRun } from "../levels";
import { DEPLOY_DOOR_OPERATIONS } from "../start-up-checks";

describe("the shared vocabulary", () => {
  it.each([
    ["the risk levels", RISK_LEVELS],
    ["the doors", DOORS],
    ["the shared exit codes", SHARED_EXIT_CODES],
  ])("cannot be changed: %s", (_name, list) => {
    expect(Object.isFrozen(list)).toBe(true);
  });

  it("lets nothing add an operation to the deploy door's list", () => {
    expect(Object.isFrozen(DEPLOY_DOOR_OPERATIONS)).toBe(true);
    expect(() =>
      (DEPLOY_DOOR_OPERATIONS as unknown as string[]).push("posts.delete")
    ).toThrow(TypeError);
    expect(DEPLOY_DOOR_OPERATIONS).not.toContain("posts.delete");
  });

  it("keeps the levels in order even when something tries to reverse them", () => {
    expect(() => (RISK_LEVELS as unknown as string[]).reverse()).toThrow(
      TypeError
    );
    const raise = [
      { when: "always", level: "critical" as const, applies: () => true },
    ];
    expect(levelForRun({ level: "draft", raise }, { input: {} }).level).toBe(
      "critical"
    );
  });
});
