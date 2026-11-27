/**
 * A run's level comes from its input and target: the declared level, raised by
 * every rule that applies, never lowered.
 */
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { levelForRun } from "../levels";

import { assembleOperationList } from "../list";

import {
  activityDeleteLike,
  BULK_THRESHOLD,
  contentUpdateLike,
  settingsSetLike,
} from "./fixtures";

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

describe('an operation that refuses "Always allow" itself', () => {
  it("keeps that refusal on every run, with no rule applying", () => {
    expect(
      levelForRun(activityDeleteLike, { input: { before: "2026-01-01" } })
    ).toEqual({
      level: "critical",
      alwaysAllow: false,
    });
  });

  it("keeps it in the list's view of the operation", async () => {
    const list = await assembleOperationList({
      core: [activityDeleteLike, settingsSetLike],
    });
    expect(list.byId("activity.delete")?.alwaysAllow).toBe(false);
    // The control: an operation that refuses it only on some inputs is
    // listed as allowing it at its declared level.
    expect(list.byId("settings.set")?.alwaysAllow).toBe(true);
  });
});

describe("two rules that both apply", () => {
  it("give the higher of their levels, whichever comes first", () => {
    const applies = () => true;
    for (const raise of [
      [
        { when: "critical case", level: "critical" as const, applies },
        { when: "change case", level: "change" as const, applies },
      ],
      [
        { when: "change case", level: "change" as const, applies },
        { when: "critical case", level: "critical" as const, applies },
      ],
    ]) {
      expect(levelForRun({ level: "draft", raise }, { input: {} }).level).toBe(
        "critical"
      );
    }
  });
});

describe("a rule whose answer is not a plain yes or no", () => {
  // The list refuses a rule written to answer later; this is the run-time
  // half, for one that answers oddly anyway. A level computed too low is the
  // harm to avoid, so only a plain "no" leaves a rule out.
  it.each([
    ["a promise of no", () => Promise.resolve(false)],
    ["nothing", () => undefined],
    ["zero", () => 0],
  ])("raises the run when it answers %s", (_answer, applies) => {
    const odd = {
      level: "draft" as const,
      raise: [
        {
          when: "odd",
          level: "change" as const,
          applies: applies as unknown as () => boolean,
        },
      ],
    };
    expect(levelForRun(odd, { input: {} }).level).toBe("change");
  });

  it("leaves the level alone when it answers a plain no (control)", () => {
    const no = {
      level: "draft" as const,
      raise: [
        { when: "never", level: "change" as const, applies: () => false },
      ],
    };
    expect(levelForRun(no, { input: {} }).level).toBe("draft");
  });
});

describe("a rule that answers with a promise from another realm", () => {
  // A promise made in another realm (here a `node:vm` context) is not an
  // instance of this one's Promise; it is still raised on, and its rejection
  // still handled. Vitest fails the run on an unhandled rejection.
  it("raises the run and leaves no rejection unhandled", async () => {
    const foreign: unknown = runInNewContext(
      'Promise.reject(new Error("looked up elsewhere"))'
    );
    expect(foreign instanceof Promise).toBe(false);
    const odd = {
      level: "draft" as const,
      raise: [
        {
          when: "elsewhere",
          level: "change" as const,
          applies: (() => foreign) as unknown as () => boolean,
        },
      ],
    };
    expect(levelForRun(odd, { input: {} }).level).toBe("change");
    // Give an unhandled rejection the turn it would need to be reported.
    await new Promise(resolve => setTimeout(resolve, 20));
  });
});
