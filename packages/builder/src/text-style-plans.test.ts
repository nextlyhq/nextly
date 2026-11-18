/**
 * What Design's Type → "Text styles" writes: the site's whole class list
 * after a text style is made, copied or renamed, or why it can't be.
 */
import {
  BASE_BREAKPOINT,
  isTextStyle,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  duplicateTextStylePlan,
  newTextStylePlan,
  renameTextStylePlan,
} from "./text-style-plans";

const eyebrow: NamedClass = {
  id: "t-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 1,
  role: "text",
  styles: {
    base: { [BASE_BREAKPOINT]: { fontSize: "12px", textTransform: "uppercase" } },
  },
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 4,
  styles: {},
};
const ids = (...made: string[]) => {
  const queue = [...made];
  return () => queue.shift() ?? "spare";
};

describe("a new text style", () => {
  it("is a text style named by the author, last in the library, on the Body font", () => {
    const plan = newTextStylePlan([card, eyebrow], "Display", ids("t-new"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const made = plan.classes.find(entry => entry.id === plan.id);
    expect(made).toEqual({
      id: "t-new",
      slug: "display",
      label: "Display",
      orderIndex: 5,
      role: "text",
      styles: {
        base: { [BASE_BREAKPOINT]: { fontFamily: { $token: "font.body" } } },
      },
    });
    expect(made !== undefined && isTextStyle(made)).toBe(true);
    expect(plan.classes.slice(0, 2)).toEqual([card, eyebrow]);
  });

  it("refuses a name another text style has, in any case, and an empty one", () => {
    expect(newTextStylePlan([eyebrow], "eyebrow")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/already a text style named/),
    });
    expect(newTextStylePlan([eyebrow], "  ")).toMatchObject({ ok: false });
  });

  it("takes a free class name where a shared style has the one its name gives", () => {
    const plan = newTextStylePlan([card], "Card", ids("t-card"));
    expect(plan.ok && plan.classes.at(-1)?.slug).toBe("card-2");
  });
});

describe("a copy of a text style", () => {
  it("keeps its parts under the next free copy name, unlocked", () => {
    const plan = duplicateTextStylePlan(
      [{ ...eyebrow, locked: true }],
      "t-eyebrow",
      ids("t-copy")
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const copy = plan.classes.at(-1);
    expect(copy).toMatchObject({
      id: "t-copy",
      label: "Eyebrow copy",
      slug: "eyebrow-copy",
      role: "text",
      styles: eyebrow.styles,
    });
    expect(copy).not.toHaveProperty("locked");
    // A copy, so an edit to the new one never reaches the first.
    expect(copy?.styles).not.toBe(eyebrow.styles);
  });

  it("counts on past a copy name already taken", () => {
    const first = duplicateTextStylePlan([eyebrow], "t-eyebrow", ids("t-2"));
    if (!first.ok) throw new Error(first.reason);
    const second = duplicateTextStylePlan(first.classes, "t-eyebrow", ids("t-3"));
    expect(second.ok && second.classes.at(-1)?.label).toBe("Eyebrow copy 2");
  });

  it("refuses anything that is not a text style", () => {
    expect(duplicateTextStylePlan([card], "c-card")).toMatchObject({
      ok: false,
    });
  });
});

describe("renaming a text style", () => {
  it("changes its name and keeps its id and class name", () => {
    const plan = renameTextStylePlan([card, eyebrow], "t-eyebrow", "Kicker");
    expect(plan.ok && plan.classes[1]).toEqual({ ...eyebrow, label: "Kicker" });
  });

  it("refuses a locked one, and a name another text style has", () => {
    expect(
      renameTextStylePlan([{ ...eyebrow, locked: true }], "t-eyebrow", "Kicker")
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/locked/) });
    const display = { ...eyebrow, id: "t-display", slug: "display", label: "Display" };
    expect(
      renameTextStylePlan([eyebrow, display], "t-eyebrow", "DISPLAY")
    ).toMatchObject({ ok: false });
  });
});
