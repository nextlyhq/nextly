import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockPart, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { starredLookSelector } from "./block-looks";
import { compilePageCss } from "./compile-page";
import { starredLooksOf, type NamedClass } from "./named-class";
import { CHILD_GAP_CLASS, PAGE_ROOT_CLASS } from "./node-class";
import { styleOrigin } from "./style-origin";

/*
 * A block type's ★ look: the block style a block of its type has while it
 * wears none of the type's looks. Written as the look's own rule under a
 * selector that leaves out every block wearing one of the type's looks.
 */

const values = (set: Record<string, unknown>): NodeStyles =>
  ({ base: { base: set } }) as unknown as NodeStyles;

const primary: NamedClass = {
  id: "look:core/button:primary",
  slug: "button-primary",
  orderIndex: 0,
  blockType: "core/button",
  isDefault: true,
  styles: {},
};
const secondary: NamedClass = {
  id: "look:core/button:secondary",
  slug: "button-secondary",
  orderIndex: 1,
  blockType: "core/button",
  styles: values({ color: "navy" }),
};
const ghost: NamedClass = {
  id: "look-ghost",
  slug: "button-ghost",
  label: "Ghost",
  orderIndex: 2,
  blockType: "core/button",
  styles: {
    base: { base: { color: "teal" } },
    hover: { base: { color: "orange" } },
  } as unknown as NodeStyles,
};

const page = (
  nodes: readonly { id: string; type: string; classes?: string[] }[]
): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: nodes.map(node => ({ version: 1, props: {}, ...node })),
  }) as unknown as BlockDocument;

const twoButtons = page([
  { id: "plain", type: "core/button" },
  { id: "worn", type: "core/button", classes: [secondary.id] },
]);

const compile = (classes: readonly NamedClass[]) =>
  compilePageCss(twoButtons, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses: classes,
  });

const STARRED_RULE =
  ".nx-pb-page.nx-pb-page .nx-bt-core--button:where(:not(.nx-l-button-secondary, .nx-l-button-ghost))";

describe("which look is a block type's ★", () => {
  it("is the first worn look of the type marked starred, in library order", () => {
    const later = { ...secondary, starred: true as const };
    const first = { ...ghost, starred: true as const };
    expect(starredLooksOf([primary, later, first]).get("core/button")?.id).toBe(
      secondary.id
    );
  });

  it("is never the type's own look, a shared style, or a mark but true", () => {
    const own = { ...primary, starred: true as const };
    const shared = {
      id: "c-card",
      slug: "card",
      orderIndex: 3,
      styles: {},
      starred: true as const,
    };
    const odd = { ...ghost, starred: "yes" } as unknown as NamedClass;
    expect(starredLooksOf([own, shared, odd]).size).toBe(0);
  });
});

describe("a block type's ★ look on the page", () => {
  it("writes nothing while no look of the type is starred", () => {
    // Absent pointer: today's sheet.
    expect(compile([primary, secondary, ghost]).css).not.toContain(
      ":where(:not("
    );
  });

  it("is written for the type's blocks that wear none of its looks", () => {
    const { css, classes } = compile([
      primary,
      secondary,
      { ...ghost, starred: true },
    ]);
    expect(css).toContain(`${STARRED_RULE} { color: teal }`);
    // Nothing moves in the documents: the plain button wears no class, and
    // the one wearing Secondary keeps it.
    expect(classes.get("plain")).not.toContain("nx-l-button-ghost");
    expect(classes.get("worn")).toContain("nx-l-button-secondary");
  });

  it("keeps the look's other states, so its hover reaches the plain blocks", () => {
    const { css } = compile([primary, secondary, { ...ghost, starred: true }]);
    // Under the state selector a worn look's hover is written with.
    expect(css).toContain(`${STARRED_RULE}:where(:hover) { color: orange }`);
  });

  it("is written ahead of the shared styles, so one a block wears still wins", () => {
    const card: NamedClass = {
      id: "c-card",
      slug: "card",
      orderIndex: 0,
      styles: values({ color: "crimson" }),
    };
    const { css } = compile([
      card,
      primary,
      secondary,
      { ...ghost, starred: true },
    ]);
    expect(css.indexOf(STARRED_RULE)).toBeGreaterThan(-1);
    expect(css.indexOf(STARRED_RULE)).toBeLessThan(css.indexOf(".nx-c-card"));
  });

  it("leaves out the type's inner parts, which carry its class too", () => {
    const parts: Record<string, BlockPart> = {
      frame: {},
      picture: {
        takesFromRoot: { properties: ["borderRadius"], whenRootIs: ["frame"] },
      },
    };
    expect(
      starredLookSelector("core/image", [{ slug: "image-circle" }], parts)
    ).toBe(
      ".nx-bt-core--image:where(:not(.nx-l-image-circle, .nx-bp-core--image--picture))"
    );
  });
});

describe("a ★ look that lays out a container", () => {
  const row: NamedClass = {
    id: "look-row",
    slug: "box-row",
    orderIndex: 0,
    blockType: "core/box",
    starred: true,
    styles: values({ display: "flex" }),
  };

  it("swaps the flow margin for gap on the containers it reaches", () => {
    const { css } = compilePageCss(page([{ id: "box", type: "core/box" }]), {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [row],
      childGaps: { "core/box": { $token: "space.stack" } },
    });
    // Without it the box keeps its children's flow margins beside `gap`.
    expect(css).toContain(
      `.${PAGE_ROOT_CLASS} :where(.nx-bt-core--box:where(:not(.nx-l-box-row)).${CHILD_GAP_CLASS} > * + *) { margin-block-start: 0 }`
    );
  });
});

describe("where a ★ look's values come from, as the inspector asks", () => {
  const traced = () =>
    compilePageCss(twoButtons, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [primary, secondary, { ...ghost, starred: true }],
      trace: true,
    }).trace ?? [];
  const query = { property: "color", state: "base" as const, breakpoints: ["base"] };

  it("names the ★ look on a block that picked no style", () => {
    expect(
      styleOrigin(traced(), { nodeId: "plain", blockType: "core/button", classIds: [] }, query)
        ?.origin
    ).toMatchObject({ kind: "class", id: ghost.id });
  });

  it("names the style a block picked, never the ★ look", () => {
    expect(
      styleOrigin(
        traced(),
        { nodeId: "worn", blockType: "core/button", classIds: [secondary.id] },
        query
      )?.origin
    ).toMatchObject({ kind: "class", id: secondary.id });
  });
});
