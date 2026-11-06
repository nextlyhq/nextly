import { blockDefaultsOf } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { withBlockLooks, withCoreLooks } from "./core-looks";
import { checkStoredClasses, referableClassIds } from "./site-style-record";
import { classOverrideOf, resolveSiteStyle } from "./site-style";

describe("the core blocks' looks in the site's code tier", () => {
  it("adds every core look as a class the code supplies", () => {
    const ids = (withCoreLooks(undefined).classes ?? []).map(each => each.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "look:core/button:outline",
        "look:core/image:circle",
        "look:core/section:hero",
      ])
    );
  });

  it("keeps the site config's own classes, and its own copy of a look", () => {
    const mine = {
      id: "look:core/button:outline",
      slug: "button-outline",
      orderIndex: 0,
      blockType: "core/button",
      styles: { base: { base: { color: "black" } } },
    };
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    const classes = withCoreLooks({ classes: [mine, card] }).classes ?? [];
    expect(classes.filter(each => each.id === mine.id)).toEqual([mine]);
    expect(classes).toContainEqual(card);
  });

  it("stores a site's edit of a look as an override, which compares its block type", () => {
    const configured = withCoreLooks(undefined).classes ?? [];
    const outline = configured.find(
      each => each.id === "look:core/button:outline"
    );
    if (outline === undefined) throw new Error("no outline look");
    // The same look bound to another type is a different look.
    const moved = { ...outline, blockType: "core/text" };
    expect(classOverrideOf(configured, [moved])).toEqual([moved]);
    expect(classOverrideOf(configured, [outline])).toEqual([]);
  });
});

describe("looks of blocks another plugin declares", () => {
  it("join the code tier once their definitions are known", () => {
    const hero = {
      name: "acme/hero",
      editor: {
        variations: [
          {
            name: "dark",
            label: "Dark",
            styles: { base: { base: { color: "white" } } },
          },
        ],
      },
    };
    const ids = (withBlockLooks(undefined, [hero]).classes ?? []).map(
      each => each.id
    );
    expect(ids).toEqual(["look:acme/hero:dark"]);
  });
});

describe("a site's own style holding a look's name", () => {
  // A site saved a shared style named like a seeded look before looks existed.
  const mine = {
    id: "c-outline",
    slug: "button-outline",
    orderIndex: 0,
    styles: { base: { base: { color: "black" } } },
  };
  const card = { id: "c-card", slug: "card", orderIndex: 1, styles: {} };
  const policy = { defaults: resolveSiteStyle(withCoreLooks(undefined)) };

  it("keeps the style and lets every later save through", () => {
    // The look it shadows is the one the compiler leaves out, so neither the
    // save that keeps the style nor one that adds another style is refused.
    expect(checkStoredClasses([mine], policy).issues).toEqual([]);
    expect(checkStoredClasses([mine, card], policy).issues).toEqual([]);
  });

  it("still refuses a save whose own look takes another look's name", () => {
    // Only a shared style keeps a name over a look. A look ordered first that
    // claims another look's name stops that look rendering, so it is refused.
    const rival = {
      id: "look:core/button:rival",
      slug: "image-circle",
      orderIndex: -1,
      blockType: "core/button",
      styles: {},
    };
    expect(checkStoredClasses([rival], policy).issues).toEqual([
      expect.stringContaining('"look:core/image:circle"'),
    ]);
  });
});

describe("a block's own look, which a site edits as its type's base", () => {
  const configured = withCoreLooks(undefined).classes ?? [];
  const primary = configured.find(
    each => each.id === "look:core/button:primary"
  );
  if (primary === undefined) throw new Error("no primary look");
  const edited = {
    ...primary,
    styles: { base: { base: { color: "purple" } } },
  };
  const policy = { defaults: resolveSiteStyle(withCoreLooks(undefined)) };

  it("is in the code tier with no edits, marked as the type's own", () => {
    expect(primary).toMatchObject({
      blockType: "core/button",
      isDefault: true,
      styles: {},
    });
    // Nothing edited: the code tier changes no base.
    expect(blockDefaultsOf(configured)).toEqual({
      "core/button": {},
      "core/image": {},
      "core/section": {},
    });
  });

  it("is stored only once edited, and the edit reaches its type's base", () => {
    expect(classOverrideOf(configured, [primary])).toEqual([]);
    const stored = classOverrideOf(configured, [edited]);
    expect(stored).toEqual([edited]);
    expect(checkStoredClasses(stored, policy).issues).toEqual([]);
    const merged = resolveSiteStyle(withCoreLooks(undefined), {
      classes: stored,
    });
    expect(blockDefaultsOf(merged.classes)["core/button"]).toEqual(
      edited.styles
    );
  });

  it("refuses a second own look of a type, which would never be read", () => {
    const second = {
      ...edited,
      id: "look:core/button:main",
      slug: "button-main",
      orderIndex: 900,
    };
    expect(checkStoredClasses([second], policy).issues).toEqual([
      expect.stringContaining('"look:core/button:main" would not render'),
    ]);
  });

  it("may be stored beside a shared style holding its name", () => {
    const named = {
      id: "c-named",
      slug: "button-primary",
      orderIndex: 0,
      styles: { base: { base: { color: "black" } } },
    };
    expect(checkStoredClasses([edited, named], policy).issues).toEqual([]);
    expect(checkStoredClasses([named, edited], policy).issues).toEqual([]);
  });

  it("keeps an override that only takes its mark away", () => {
    const { isDefault: _mark, ...unmarked } = primary;
    expect(classOverrideOf(configured, [unmarked])).toEqual([unmarked]);
  });

  it("is never a class a page may refer to", () => {
    const ids = referableClassIds(configured);
    expect(ids.has("look:core/button:outline")).toBe(true);
    expect(ids.has(primary.id)).toBe(false);
  });

  it("refuses the mark on a stored class bound to no block type", () => {
    const unbound = {
      id: "c-own",
      slug: "own",
      orderIndex: 0,
      isDefault: true,
      styles: {},
    };
    expect(checkStoredClasses([unbound], policy).issues).not.toEqual([]);
  });
});
