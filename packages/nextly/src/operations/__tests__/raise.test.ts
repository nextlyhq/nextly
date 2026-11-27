/**
 * A run's level comes from its input and target: the declared level, raised by
 * every rule that applies, never lowered.
 */
import { describe, expect, it } from "vitest";

import { levelForRun } from "../levels";

import { BULK_THRESHOLD, contentUpdateLike, settingsSetLike } from "./fixtures";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

describe("the level of a content update", () => {
  it("stays draft at the bulk threshold", () => {
    expect(
      levelForRun(contentUpdateLike, {
        input: { ids: ids(BULK_THRESHOLD), data: {} },
      })
    ).toEqual({
      level: "draft",
      alwaysAllow: true,
    });
  });

  it("is a change above the bulk threshold", () => {
    expect(
      levelForRun(contentUpdateLike, {
        input: { ids: ids(BULK_THRESHOLD + 1), data: {} },
      })
    ).toEqual({
      level: "change",
      alwaysAllow: true,
    });
  });
});

describe("the level of a settings change", () => {
  it("stays a change for the site's title", () => {
    expect(
      levelForRun(settingsSetLike, {
        input: { key: "site.title", value: "Corner Bakery" },
      })
    ).toEqual({
      level: "change",
      alwaysAllow: true,
    });
  });

  it('is critical, never covered by "Always allow", for a sign-in setting', () => {
    expect(
      levelForRun(settingsSetLike, {
        input: { key: "auth.allowRegistration", value: true },
      })
    ).toEqual({
      level: "critical",
      alwaysAllow: false,
    });
  });
});

describe("a rule that names a lower level", () => {
  // The list refuses such a rule at registration (start-up-checks.test.ts);
  // this is the run-time half, for a rule that reached a run anyway.
  it("leaves the declared level in place", () => {
    const lowering = {
      level: "critical" as const,
      raise: [{ when: "always", level: "read" as const, applies: () => true }],
    };
    expect(levelForRun(lowering, { input: {} })).toEqual({
      level: "critical",
      alwaysAllow: true,
    });
  });
});

describe("the target the plan found", () => {
  it("raises the level when a rule reads it", () => {
    const publishedRaises = {
      level: "draft" as const,
      raise: [
        {
          when: "the entry is published",
          level: "change" as const,
          applies: ({
            target,
          }: {
            target?: Readonly<Record<string, unknown>>;
          }) => target?.status === "published",
        },
      ],
    };
    expect(
      levelForRun(publishedRaises, { input: {}, target: { status: "draft" } })
        .level
    ).toBe("draft");
    expect(
      levelForRun(publishedRaises, {
        input: {},
        target: { status: "published" },
      }).level
    ).toBe("change");
  });
});
