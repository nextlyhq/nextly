import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { MAX_NAMED_CLASSES } from "../document";

import { blockLooks, blockOwnLooks, lookClassId } from "./block-looks";
import { compilePageCss } from "./compile-page";
import { styleOrigin } from "./style-origin";
import {
  classNameOf,
  isLook,
  isUsableNamedClass,
  namedClassesRead,
} from "./named-class";

const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;

const button = {
  name: "core/button",
  editor: {
    variations: [
      { name: "primary", label: "Primary", isDefault: true as const },
      { name: "outline", label: "Outline", styles: colour("red") },
      // An insert preset, not a look: it carries no styles.
      { name: "wide", label: "Wide", props: { width: "full" } },
    ],
  },
};

describe("a block type's looks, as the site receives them", () => {
  it("is one class per look that carries styles, bound to its block type", () => {
    expect(blockLooks([button])).toEqual([
      {
        id: lookClassId("core/button", "outline"),
        slug: "button-outline",
        label: "Outline",
        orderIndex: 0,
        blockType: "core/button",
        styles: colour("red"),
      },
    ]);
  });

  it("gives each block's own look apart, with no edits and the own-look mark", () => {
    expect(blockOwnLooks([button])).toEqual([
      {
        id: lookClassId("core/button", "primary"),
        slug: "button-primary",
        label: "Primary",
        orderIndex: 0,
        blockType: "core/button",
        styles: {},
        isDefault: true,
      },
    ]);
  });

  it("keeps an own look whatever its name, under a slug made writable", () => {
    const named = {
      name: "core/button",
      editor: {
        variations: [
          { name: "Primary Choice!", isDefault: true as const },
          // A worn look's name must already be writable.
          { name: "Big Bold!", styles: colour("red") },
        ],
      },
    };
    expect(
      blockOwnLooks([named]).map(look => [look.id, look.slug, look.isDefault])
    ).toEqual([
      [
        lookClassId("core/button", "Primary Choice!"),
        "button-primary-choice",
        true,
      ],
    ]);
    expect(blockLooks([named])).toEqual([]);
  });

  it("refuses a block's own look that also states styles: its styles are the base", () => {
    const both = {
      name: "core/button",
      editor: {
        variations: [
          { name: "primary", isDefault: true as const, styles: colour("red") },
        ],
      },
    };
    expect(blockOwnLooks([both])).toEqual([]);
    expect(blockLooks([both])).toEqual([]);
  });

  it("names a look of a type outside core by its whole type", () => {
    const hero = {
      name: "acme/hero",
      editor: { variations: [{ name: "dark", styles: colour("black") }] },
    };
    expect(blockLooks([hero])[0]?.slug).toBe("acme-hero-dark");
  });

  it("leaves out a look whose name can't be written as a class", () => {
    const odd = {
      name: "core/button",
      editor: { variations: [{ name: "Big Bold!", styles: colour("red") }] },
    };
    expect(blockLooks([odd])).toEqual([]);
  });

  it("applies only to its own block type", () => {
    const [outline] = blockLooks([button]);
    if (outline === undefined) throw new Error("no look");
    const on = (type: string) =>
      compilePageCss(
        {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "n1",
              type,
              version: 1,
              props: {},
              classes: [outline.id],
            },
          ],
        } as unknown as BlockDocument,
        { breakpoints: FIXTURE_BREAKPOINTS, namedClasses: [outline] }
      );
    // The control: on a button the look's class is put on the element.
    expect(on("core/button").classes.get("n1")).toContain(
      "nx-l-button-outline"
    );
    const box = on("core/box");
    expect(box.classes.get("n1") ?? "").not.toContain("nx-l-button-outline");
    expect(box.warnings.map(each => each.code)).toContain(
      "look-for-another-block"
    );
  });

  it("styles a block that wears it, and a shared style still wins over it", () => {
    const [outline] = blockLooks([button]);
    if (outline === undefined) throw new Error("no look");
    const card = {
      id: "c-card",
      slug: "card",
      orderIndex: 0,
      styles: colour("blue"),
    };
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/button",
          version: 1,
          props: {},
          classes: [outline.id, card.id],
        },
      ],
    } as unknown as BlockDocument;
    const { css } = compilePageCss(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [card, outline],
    });
    // The population first: both rules are written.
    expect(css).toContain(".nx-l-button-outline { color: red }");
    expect(css.indexOf(".nx-l-button-outline")).toBeLessThan(
      css.indexOf(".nx-c-card")
    );
  });
});

describe("looks and the library cap", () => {
  it("never take a shared style's place under the cap", () => {
    // A site at the cap, with the core looks put in front of it.
    const shared = Array.from({ length: MAX_NAMED_CLASSES }, (_, index) => ({
      id: `c-${index}`,
      slug: `s${index}`,
      orderIndex: index,
      styles: colour("red"),
    }));
    const looks = blockLooks([button]);
    const read = namedClassesRead([...looks, ...shared]);
    expect(read.filter(each => !isLook(each))).toHaveLength(MAX_NAMED_CLASSES);
    expect(read.filter(each => isLook(each))).toHaveLength(looks.length);
  });
});

describe("a look's own name and binding", () => {
  it("is written under its own prefix, apart from shared styles", () => {
    expect(
      classNameOf({ slug: "image-rounded", blockType: "core/image" })
    ).toBe("nx-l-image-rounded");
    expect(classNameOf({ slug: "image-rounded" })).toBe("nx-c-image-rounded");
  });

  it("refuses a binding that is not a block type", () => {
    const bound = (blockType: unknown) =>
      isUsableNamedClass({
        id: "x",
        slug: "x",
        orderIndex: 0,
        styles: {},
        blockType,
      });
    expect(bound("core/button")).toBe(true);
    expect(bound(undefined)).toBe(true);
    expect(bound("")).toBe(false);
    expect(bound("button")).toBe(false);
  });

  it("reads no more than the look cap, even in a small library", () => {
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `look:core/button:l${index}`,
      slug: `button-l${index}`,
      orderIndex: index,
      blockType: "core/button",
      styles: colour("red"),
    }));
    expect(namedClassesRead(many)).toHaveLength(512);
  });
});

describe("a look the engine could not use", () => {
  it("is left out rather than declared and then dropped", () => {
    const long = {
      name: "core/button",
      editor: {
        variations: [{ name: "x".repeat(130), styles: colour("red") }],
      },
    };
    expect(blockLooks([long])).toEqual([]);
  });
});

describe("a look in the cascade's own reading", () => {
  it("reaches only a node of its own block type", () => {
    const [outline] = blockLooks([button]);
    if (outline === undefined) throw new Error("no look");
    const traced = (type: string) => {
      const { trace } = compilePageCss(
        {
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "n1", type, version: 1, props: {}, classes: [outline.id] },
          ],
        } as unknown as BlockDocument,
        {
          breakpoints: FIXTURE_BREAKPOINTS,
          namedClasses: [outline],
          trace: true,
        } as never
      );
      return styleOrigin(
        trace ?? [],
        { nodeId: "n1", blockType: type, classIds: [outline.id] },
        { property: "color", state: "base", breakpoints: ["base"] }
      );
    };
    expect(traced("core/button")?.origin).toMatchObject({
      kind: "class",
      id: outline.id,
    });
    expect(traced("core/box")).toBeUndefined();
  });
});
