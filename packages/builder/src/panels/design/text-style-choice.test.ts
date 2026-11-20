/**
 * What the Style tab's "Text style" picker reads and writes: the site's text
 * styles as it lists them, the one a block wears, and the class list a pick
 * leaves, with the block's other classes where they were.
 */
import {
  BASE_BREAKPOINT,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  planTextStyle,
  textStyleOptions,
  textStylePreview,
  wornTextStyle,
} from "./text-style-choice";

const base = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { [BASE_BREAKPOINT]: values } }) as unknown as NodeStyles;

const eyebrow: NamedClass = {
  id: "t-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 4,
  role: "text",
  styles: base({
    fontSize: "12px",
    lineHeight: 1.4,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  }),
};
const display: NamedClass = {
  id: "t-display",
  slug: "display",
  label: "Display",
  orderIndex: 2,
  role: "text",
  styles: base({
    fontFamily: { $token: "font.heading" },
    fontSize: { $token: "font-size.h1" },
    fontWeight: 700,
  }),
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: base({ color: "blue" }),
};
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: base({ color: "red" }),
};
const library = [card, eyebrow, outline, display];

const tokens: SiteTokenSet = {
  tokens: [
    {
      id: "font.heading",
      name: "font.heading",
      kind: "fontFamily",
      values: { light: "Georgia, serif" },
    },
    {
      id: "font-size.h1",
      name: "font-size.h1",
      kind: "fontSize",
      values: { light: "40px" },
    },
  ],
} as unknown as SiteTokenSet;

function documentWith(classes?: string[], locked = false): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: {},
        ...(classes === undefined ? {} : { classes }),
        ...(locked ? { locked: true } : {}),
      },
    ],
  } as unknown as BlockDocument;
}

describe("the site's text styles, as the picker lists them", () => {
  it("lists the text styles only, in the order they override one another", () => {
    expect(
      textStyleOptions(library, tokens, "light").map(option => option.name)
    ).toEqual(["Display", "Eyebrow"]);
  });

  it("says each one's size and line height, read through its variables", () => {
    const [first, second] = textStyleOptions(library, tokens, "light");
    expect(first?.pair).toBe("40");
    expect(second?.pair).toBe("12 / 1.4");
  });

  it("lists nothing for a site with no text styles", () => {
    expect(textStyleOptions([card, outline], tokens, "light")).toEqual([]);
    expect(textStyleOptions(undefined, tokens, "light")).toEqual([]);
  });
});

describe("a text style's preview", () => {
  it("draws its font, weight, spacing and case, its variables read", () => {
    expect(textStylePreview(eyebrow.styles, tokens, "light")).toMatchObject({
      fontWeight: "600",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    });
    expect(textStylePreview(display.styles, tokens, "light")).toMatchObject({
      fontFamily: "Georgia, serif",
      fontWeight: "700",
    });
  });

  it("scales its size into a row, so a large style still fits", () => {
    const big = textStylePreview(display.styles, tokens, "light");
    const small = textStylePreview(eyebrow.styles, tokens, "light");
    expect(Number.parseFloat(big.fontSize ?? "")).toBeLessThanOrEqual(20);
    expect(Number.parseFloat(small.fontSize ?? "")).toBeGreaterThanOrEqual(11);
    expect(Number.parseFloat(big.fontSize ?? "")).toBeGreaterThan(
      Number.parseFloat(small.fontSize ?? "")
    );
  });

  it("leaves out a value it cannot read", () => {
    const unread = textStylePreview(
      base({ fontFamily: { $token: "font.gone" } }),
      tokens,
      "light"
    );
    expect(unread).not.toHaveProperty("fontFamily");
  });
});

describe("the text style a block wears", () => {
  it("is the one text style among its classes", () => {
    expect(wornTextStyle(library, ["c-card", "t-eyebrow"])?.id).toBe(
      "t-eyebrow"
    );
  });

  it("is none for a block wearing only a shared style or a block style", () => {
    expect(
      wornTextStyle(library, ["c-card", "look:core/button:outline"])
    ).toBeUndefined();
    expect(wornTextStyle(undefined, ["t-eyebrow"])).toBeUndefined();
  });
});

describe("picking a text style for a block", () => {
  it("adds the one entry, keeping the block's other classes", () => {
    const plan = planTextStyle(
      documentWith(["c-card"]),
      "a",
      library,
      "t-eyebrow"
    );
    expect(plan).toEqual({
      ok: true,
      ops: [
        {
          kind: "update",
          id: "a",
          patch: { classes: ["c-card", "t-eyebrow"] },
        },
      ],
    });
  });

  it("replaces the one it wore, in its place, so a block wears one at a time", () => {
    const plan = planTextStyle(
      documentWith(["t-eyebrow", "c-card"]),
      "a",
      library,
      "t-display"
    );
    expect(plan.ok && plan.ops[0]).toEqual({
      kind: "update",
      id: "a",
      patch: { classes: ["t-display", "c-card"] },
    });
  });

  it("takes it off with None, and leaves no empty class list", () => {
    expect(
      planTextStyle(documentWith(["t-eyebrow", "c-card"]), "a", library, null)
    ).toMatchObject({
      ok: true,
      ops: [{ patch: { classes: ["c-card"] } }],
    });
    expect(
      planTextStyle(documentWith(["t-eyebrow"]), "a", library, null)
    ).toEqual({
      ok: true,
      ops: [{ kind: "update", id: "a", patch: {}, unset: ["classes"] }],
    });
  });

  it("writes nothing for the text style the block already wears", () => {
    expect(
      planTextStyle(documentWith(["t-eyebrow"]), "a", library, "t-eyebrow")
    ).toEqual({ ok: true, ops: [] });
  });

  it("refuses a block whose design is held, saying why", () => {
    const plan = planTextStyle(
      documentWith(undefined, true),
      "a",
      library,
      "t-eyebrow"
    );
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/\S/);
  });

  it("refuses an id that is not one of the site's text styles", () => {
    expect(planTextStyle(documentWith(), "a", library, "c-card")).toMatchObject(
      { ok: false }
    );
  });
});
