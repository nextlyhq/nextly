/**
 * The cycle rule: any depth is accepted, a field group placed inside itself is refused where it is
 * written, and a cycle the Builder stored before the rule is named at start rather than refused.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  assertNoFieldGroupCycleInCode,
  assertSaveLeavesNoFieldGroupCycle,
  FIELD_GROUP_CYCLE,
  judgeFieldGroupCyclesAtStart,
} from "../field-group-cycles";

const text = { name: "title", type: "text" };

/** A field group whose only placement is `inner`, directly. */
function places(slug: string, inner?: string) {
  return {
    slug,
    fields:
      inner === undefined
        ? [text]
        : [text, { name: inner, type: "component", component: inner }],
  };
}

/** The refusal `run` throws, read as the validation error it must be. */
function refusal(run: () => void): {
  path: string;
  code: string;
  message: string;
} {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    const errors = (error as NextlyError).publicData as {
      errors: { path: string; code: string; message: string }[];
    };
    expect(errors.errors).toHaveLength(1);
    return errors.errors[0];
  }
  throw new Error("expected a refusal, and nothing was thrown");
}

describe("assertNoFieldGroupCycleInCode", () => {
  it("accepts field groups nested five levels deep", () => {
    expect(() =>
      assertNoFieldGroupCycleInCode([
        places("l1", "l2"),
        places("l2", "l3"),
        places("l3", "l4"),
        places("l4", "l5"),
        places("l5"),
      ])
    ).not.toThrow();
  });

  it("refuses a field group placed directly in itself, naming it", () => {
    const issue = refusal(() =>
      assertNoFieldGroupCycleInCode([places("a", "a")])
    );
    expect(issue).toMatchObject({
      path: "fieldGroups",
      code: FIELD_GROUP_CYCLE,
    });
    expect(issue.message).toContain("a → a");
  });

  it("refuses A in B in A, naming the cycle", () => {
    const issue = refusal(() =>
      assertNoFieldGroupCycleInCode([places("a", "b"), places("b", "a")])
    );
    expect(issue.message).toContain("a → b → a");
  });

  it("refuses a cycle closed through a repeater, a named group, a zone and a presentational group", () => {
    const issue = refusal(() =>
      assertNoFieldGroupCycleInCode([
        {
          slug: "a",
          fields: [
            {
              name: "rows",
              type: "repeater",
              fields: [{ name: "b", type: "component", component: "b" }],
            },
          ],
        },
        {
          slug: "b",
          fields: [
            {
              name: "box",
              type: "group",
              fields: [{ name: "zone", type: "component", components: ["c"] }],
            },
          ],
        },
        {
          slug: "c",
          fields: [
            {
              type: "group",
              label: "Layout",
              fields: [{ name: "a", type: "component", component: "a" }],
            },
          ],
        },
      ])
    );
    expect(issue.message).toContain("a → b → c → a");
  });

  it("names the shortest cycle through a field group", () => {
    const issue = refusal(() =>
      assertNoFieldGroupCycleInCode([
        {
          slug: "a",
          // The long way is placed last, so a search that follows the latest placement first
          // finds it before the short one.
          fields: [
            { name: "short", type: "component", component: "b" },
            { name: "long", type: "component", component: "c" },
          ],
        },
        places("b", "a"),
        places("c", "d"),
        places("d", "a"),
      ])
    );
    expect(issue.message).toContain("a → b → a");
  });

  it("compares slugs without case", () => {
    const issue = refusal(() =>
      assertNoFieldGroupCycleInCode([places("a", "B"), places("b", "A")])
    );
    expect(issue.code).toBe(FIELD_GROUP_CYCLE);
  });

  it("leaves out a placement of a field group it is not given", () => {
    expect(() =>
      assertNoFieldGroupCycleInCode([places("a", "elsewhere")])
    ).not.toThrow();
  });
});

describe("judgeFieldGroupCyclesAtStart", () => {
  it("refuses a cycle that takes in a field group defined in code", () => {
    const warn = vi.fn();
    const issue = refusal(() =>
      judgeFieldGroupCyclesAtStart({
        code: [places("hero", "card")],
        registered: [places("card", "hero")],
        warn,
      })
    );
    expect(issue.message).toContain("hero → card → hero");
    expect(warn).not.toHaveBeenCalled();
  });

  it("names a cycle among Builder field groups alone, once, and starts", () => {
    const warn = vi.fn();
    judgeFieldGroupCyclesAtStart({
      code: [places("hero")],
      registered: [places("a", "b"), places("b", "a")],
      warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("a → b → a");
  });

  it("refuses a cycle among Builder field groups that only a plugin's extension at start closes", () => {
    const warn = vi.fn();
    const issue = refusal(() =>
      judgeFieldGroupCyclesAtStart({
        code: [],
        // As the start reconciles them, with a plugin's field extended onto `b`.
        registered: [places("a", "b"), places("b", "a")],
        // As the Builder stored them.
        stored: [places("a", "b"), places("b")],
        warn,
      })
    );
    expect(issue.message).toMatch(/a → b → a|b → a → b/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("judges the code's definition where a slug is both", () => {
    const warn = vi.fn();
    judgeFieldGroupCyclesAtStart({
      code: [places("a")],
      registered: [places("a", "b"), places("b", "a")],
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("starts quietly with field groups nested five levels deep across code and the Builder", () => {
    const warn = vi.fn();
    judgeFieldGroupCyclesAtStart({
      code: [places("l1", "l2"), places("l2", "l3")],
      registered: [places("l3", "l4"), places("l4", "l5"), places("l5")],
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("assertSaveLeavesNoFieldGroupCycle", () => {
  it("refuses a save that closes a cycle, judged with the saved definition", () => {
    const issue = refusal(() =>
      assertSaveLeavesNoFieldGroupCycle({
        saved: places("b", "a"),
        stored: [places("a", "b"), places("b")],
      })
    );
    expect(issue).toMatchObject({ path: "fields", code: FIELD_GROUP_CYCLE });
    expect(issue.message).toContain("b → a → b");
  });

  it("allows the save that breaks a stored cycle", () => {
    expect(() =>
      assertSaveLeavesNoFieldGroupCycle({
        saved: places("b"),
        stored: [places("a", "b"), places("b", "a")],
      })
    ).not.toThrow();
  });

  it("allows saving a field group outside a stored cycle", () => {
    expect(() =>
      assertSaveLeavesNoFieldGroupCycle({
        saved: places("hero", "a"),
        stored: [places("a", "b"), places("b", "a"), places("hero")],
      })
    ).not.toThrow();
  });

  it("accepts a save nesting five levels deep", () => {
    expect(() =>
      assertSaveLeavesNoFieldGroupCycle({
        saved: places("l1", "l2"),
        stored: [
          places("l2", "l3"),
          places("l3", "l4"),
          places("l4", "l5"),
          places("l5"),
        ],
      })
    ).not.toThrow();
  });
});
