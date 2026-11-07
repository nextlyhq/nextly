import {
  clearBlocks,
  registerBlocks,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  blockLookGroups,
  lookReachWords,
  ownLookDescription,
  siteBaseOf,
} from "./block-look-rows";

const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;

const primary: NamedClass = {
  id: "look:core/button:primary",
  slug: "button-primary",
  label: "Primary",
  orderIndex: 0,
  blockType: "core/button",
  isDefault: true,
  styles: {},
};
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  label: "Outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: colour("red"),
};
const square: NamedClass = {
  id: "look:core/image:square",
  slug: "image-square",
  label: "Square",
  orderIndex: 2,
  blockType: "core/image",
  isDefault: true,
  styles: {},
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 3,
  styles: colour("blue"),
};

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "core/button",
        version: 1,
        description: "core/button",
        example: { props: {} },
        editor: { label: "Button" },
        props: {},
        render: () => null,
        baseStyles: {
          base: { base: { color: "white", display: "inline-block" } },
        },
      },
    ] as never,
    { source: "block-look-rows-test" }
  );
});
afterAll(clearBlocks);

describe("the Design panel's block looks", () => {
  it("groups looks by block type, each type's own look first, and leaves shared styles out", () => {
    const groups = blockLookGroups(
      [card, outline, primary, square],
      new Set([primary.id, outline.id])
    );
    expect(
      groups.map(group => [
        group.blockType,
        group.rows.map(row => [row.id, row.own, row.className, row.inCode]),
      ])
    ).toEqual([
      [
        "core/button",
        [
          [primary.id, true, "", true],
          [outline.id, false, ".nx-l-button-outline", true],
        ],
      ],
      ["core/image", [[square.id, true, "", false]]],
    ]);
  });

  it("lists only the looks that take effect: the first own look of a type, and worn looks that render", () => {
    const second = {
      ...primary,
      id: "look:core/button:main",
      slug: "button-main",
      orderIndex: 9,
    };
    // A shared style holding a look's name keeps it, so the look is left out.
    const shadow = { ...card, id: "c-outline", slug: "button-outline" };
    const groups = blockLookGroups(
      [primary, second, outline, shadow],
      new Set()
    );
    expect(groups.map(group => group.rows.map(row => row.id))).toEqual([
      [primary.id],
    ]);
  });

  it("marks an own look whose id another block type's own look shares", () => {
    const twin = { ...square, id: primary.id };
    const rows = blockLookGroups([primary, outline, twin], new Set()).flatMap(
      group => group.rows.map(row => [row.blockType, row.id, row.sharedId])
    );
    expect(rows).toEqual([
      ["core/button", primary.id, true],
      ["core/button", outline.id, false],
      ["core/image", primary.id, true],
    ]);
  });

  it("marks an own look whose id a shared style or another type's worn look carries", () => {
    const ownOf = (library: NamedClass[]) =>
      blockLookGroups(library, new Set()).flatMap(group =>
        group.rows
          .filter(row => row.own)
          .map(row => [row.blockType, row.id, row.sharedId])
      );
    // The control: an id no other entry carries is not marked.
    expect(ownOf([primary, outline, square])).toEqual([
      ["core/button", primary.id, false],
      ["core/image", square.id, false],
    ]);
    const style = { ...card, id: primary.id };
    expect(ownOf([primary, outline, style])).toEqual([
      ["core/button", primary.id, true],
    ]);
    const worn = { ...outline, id: square.id };
    expect(ownOf([primary, worn, square])).toEqual([
      ["core/button", primary.id, false],
      ["core/image", square.id, true],
    ]);
  });

  it("reads a library with no looks as no groups", () => {
    expect(blockLookGroups([card], new Set())).toEqual([]);
  });
});

describe("a look's specimen base", () => {
  it("is the block's base with the site's edit of its own look laid over", () => {
    const edited = { ...primary, styles: colour("purple") };
    expect(siteBaseOf([edited, outline], "core/button")).toEqual({
      base: { base: { color: "purple", display: "inline-block" } },
    });
    // The control: without an edit, the block's own base.
    expect(siteBaseOf([primary], "core/button")).toEqual({
      base: { base: { color: "white", display: "inline-block" } },
    });
    expect(siteBaseOf(undefined, "core/button")).toEqual({
      base: { base: { color: "white", display: "inline-block" } },
    });
  });
});

describe("the words a look's edit carries", () => {
  it("say who the edit reaches, and what the Default chip covers", () => {
    expect(lookReachWords({ own: true }, "Button")).toBe("every Button");
    expect(lookReachWords({ own: false }, "Button")).toBe(
      "every Button that wears it"
    );
    expect(ownLookDescription("Button")).toBe(
      "Default · every Button starts from this look; other looks are laid on top"
    );
  });
});
