/**
 * What each block style action stores: the whole class list after it, made
 * against the list the host's queue holds.
 */
import {
  starredLooksOf,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  duplicateBlockStylePlan,
  newBlockStylePlan,
  renameBlockStylePlan,
  withDefaultBlockStyle,
  withHiddenBlockStyle,
} from "./block-style-plans";

const values = (set: Record<string, unknown>): NodeStyles =>
  ({ base: { base: set } }) as unknown as NodeStyles;

const primary: NamedClass = {
  id: "look:core/button:primary",
  slug: "button-primary",
  label: "Primary",
  orderIndex: 0,
  blockType: "core/button",
  isDefault: true,
  styles: values({ color: "purple" }),
};
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  label: "Outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: values({ color: "red" }),
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 2,
  styles: {},
};
const library = [primary, outline, card];
const mint = () => "new-id";

/** The ★ style of a type, as the compiler reads it. */
const starOf = (classes: readonly NamedClass[], type: string) =>
  starredLooksOf(classes).get(type)?.id;

describe("a new block style", () => {
  it("is made from the block's own style while no style carries ★", () => {
    const plan = newBlockStylePlan(
      library,
      "core/button",
      " Ghost ",
      "Button",
      mint
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.id).toBe("new-id");
    expect(plan.classes.slice(0, 3)).toEqual(library);
    expect(plan.classes.at(-1)).toEqual({
      id: "new-id",
      slug: "button-ghost",
      label: "Ghost",
      orderIndex: 3,
      blockType: "core/button",
      styles: values({ color: "purple" }),
    });
  });

  it("is made from the ★ style's values once one carries it", () => {
    const starred = withDefaultBlockStyle(library, "core/button", outline.id);
    const plan = newBlockStylePlan(
      starred,
      "core/button",
      "Ghost",
      "Button",
      mint
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.classes.at(-1)?.styles).toEqual(values({ color: "red" }));
    // A copy, so editing the new style never edits the ★ one.
    expect(plan.classes.at(-1)?.styles).not.toBe(outline.styles);
    // Never ★ itself: the ★ stays where the author put it.
    expect(starOf(plan.classes, "core/button")).toBe(outline.id);
  });

  it("is refused a name the block type already has, or none", () => {
    expect(
      newBlockStylePlan(library, "core/button", "outline", "Button", mint)
    ).toEqual({
      ok: false,
      reason:
        "Button already has a style named “outline”. Choose another name.",
    });
    expect(
      newBlockStylePlan(library, "core/button", "  ", "Button", mint)
    ).toEqual({ ok: false, reason: "A block style needs a name." });
    expect(
      newBlockStylePlan(library, "core/button", "!!", "Button", mint)
    ).toEqual({
      ok: false,
      reason: "Use at least one letter or digit in the name.",
    });
  });

  it("may share a name with another block type's style or a shared style", () => {
    const plan = newBlockStylePlan(
      library,
      "core/image",
      "Card",
      "Image",
      mint
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.classes.at(-1)?.slug).toBe("image-card");
  });
});

describe("a duplicated block style", () => {
  it("is the site's own copy, named as a copy, with none of the marks", () => {
    const marked: NamedClass[] = [
      primary,
      { ...outline, starred: true, hidden: true, locked: true },
    ];
    const plan = duplicateBlockStylePlan(marked, outline.id, "Button", mint);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.classes.at(-1)).toEqual({
      id: "new-id",
      slug: "button-outline-copy",
      label: "Outline copy",
      orderIndex: 2,
      blockType: "core/button",
      styles: outline.styles,
    });
    const again = duplicateBlockStylePlan(
      plan.classes,
      outline.id,
      "Button",
      () => "third"
    );
    if (!again.ok) throw new Error(again.reason);
    expect(again.classes.at(-1)?.label).toBe("Outline copy 2");
  });

  it("is refused for a style no longer on the site, or a block's own style", () => {
    const gone = {
      ok: false,
      reason: "This block style is no longer on the site.",
    };
    expect(duplicateBlockStylePlan(library, "nope", "Button", mint)).toEqual(
      gone
    );
    expect(
      duplicateBlockStylePlan(library, primary.id, "Button", mint)
    ).toEqual(gone);
  });
});

describe("a renamed block style", () => {
  const ghost: NamedClass = {
    id: "ghost",
    slug: "button-ghost",
    label: "Ghost",
    orderIndex: 2,
    blockType: "core/button",
    styles: {},
  };

  it("changes its name only, never its id or class name", () => {
    const plan = renameBlockStylePlan(
      [primary, outline, ghost],
      ghost.id,
      " Soft ghost ",
      "Button"
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.classes.at(-1)).toEqual({ ...ghost, label: "Soft ghost" });
    expect(plan.classes.slice(0, 2)).toEqual([primary, outline]);
  });

  it("may keep its own name in another case, never take another style's", () => {
    const own = renameBlockStylePlan(
      [outline, ghost],
      ghost.id,
      "GHOST",
      "Button"
    );
    expect(own.ok).toBe(true);
    expect(
      renameBlockStylePlan([outline, ghost], ghost.id, "Outline", "Button")
    ).toEqual({
      ok: false,
      reason:
        "Button already has a style named “Outline”. Choose another name.",
    });
    expect(
      renameBlockStylePlan([outline, ghost], ghost.id, "", "Button")
    ).toEqual({ ok: false, reason: "A block style needs a name." });
  });

  it("is refused for a style no longer on the site", () => {
    expect(renameBlockStylePlan([outline], "ghost", "Soft", "Button")).toEqual({
      ok: false,
      reason: "This block style is no longer on the site.",
    });
  });
});

describe("the ★ default", () => {
  it("moves to the style chosen, and only one style of the type carries it", () => {
    const ghost: NamedClass = {
      ...outline,
      id: "ghost",
      slug: "button-ghost",
      starred: true,
    };
    const next = withDefaultBlockStyle(
      [primary, outline, ghost],
      "core/button",
      outline.id
    );
    expect(
      next.filter(entry => entry.starred === true).map(entry => entry.id)
    ).toEqual([outline.id]);
    expect(starOf(next, "core/button")).toBe(outline.id);
  });

  it("goes back to the block's own style, which carries no mark", () => {
    const starred = withDefaultBlockStyle(library, "core/button", outline.id);
    const back = withDefaultBlockStyle(starred, "core/button", null);
    expect(back).toEqual(library);
    expect(starOf(back, "core/button")).toBeUndefined();
  });

  it("leaves another block type's ★ where it is", () => {
    const hero: NamedClass = {
      id: "look:core/section:hero",
      slug: "section-hero",
      orderIndex: 3,
      blockType: "core/section",
      starred: true,
      styles: {},
    };
    const next = withDefaultBlockStyle(
      [...library, hero],
      "core/button",
      outline.id
    );
    expect(starOf(next, "core/section")).toBe(hero.id);
  });
});

describe("a hidden block style", () => {
  it("is marked, and shown again with the mark taken off", () => {
    const hidden = withHiddenBlockStyle(library, outline.id, true);
    expect(hidden.find(entry => entry.id === outline.id)?.hidden).toBe(true);
    expect(withHiddenBlockStyle(hidden, outline.id, false)).toEqual(library);
  });

  it("never marks a shared style", () => {
    expect(withHiddenBlockStyle(library, card.id, true)).toEqual(library);
  });
});
