import {
  styleOrigin,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { sharedStyleInputs } from "../page-renderer";
import { sharedStyleInputsId } from "../shared-style-inputs";
import { resolvePageStylesWithTrace } from "../styles";

import { coreBlocks } from "./index";

/*
 * Where the site's edit of a block type's own look stands, under the Classic
 * spacing mode, which swaps in the frozen block bases: over the base, under a
 * look, a shared style and the block's own values. The edit is a default look
 * in the site's class library, as a site stores it. Read off the compiled
 * trace by the engine's own cascade reader.
 */
const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};
const colour = (color: string): NodeStyles =>
  ({ base: { base: { color } } }) as unknown as NodeStyles;
const cta: NamedClass = {
  id: "c-cta",
  slug: "cta",
  orderIndex: 0,
  styles: colour("#00aa00"),
};
/** The site's edit of the button's own look, Primary, as its library holds it. */
const primary: NamedClass = {
  id: "look:core/button:primary",
  slug: "button-primary",
  orderIndex: 0,
  blockType: "core/button",
  isDefault: true,
  styles: colour("#aa00aa"),
};
/** Another of the button's looks, which a block wears. */
const outline: NamedClass = {
  id: "look:core/button:outline",
  slug: "button-outline",
  orderIndex: 1,
  blockType: "core/button",
  styles: colour("#0000aa"),
};

function compiled(
  library: readonly NamedClass[],
  classes: readonly NamedClass[],
  own?: NodeStyles
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/button",
        version: 1,
        props: { label: "Go" },
        classes: classes.map(each => each.id),
        ...(own === undefined ? {} : { styles: own }),
      },
    ],
  } as unknown as BlockDocument;
  return resolvePageStylesWithTrace(
    document,
    undefined,
    {
      breakpoints: BREAKPOINTS,
      spacingMode: "classic",
      namedClasses: [...library, ...classes],
    } satisfies StyleCompileContext,
    resolver,
    false,
    { trace: true }
  );
}

/** The tier the button's value for one property comes from, and its value. */
function from(
  property: string,
  library: readonly NamedClass[],
  classes: readonly NamedClass[],
  own?: NodeStyles
): { tier: string; value: string } | undefined {
  const { trace } = compiled(library, classes, own);
  const entry = styleOrigin(
    trace ?? [],
    {
      nodeId: "n1",
      blockType: "core/button",
      classIds: classes.map(each => each.id),
    },
    { property, state: "base", breakpoints: ["base"] }
  );
  if (entry === undefined) return undefined;
  const tier =
    entry.origin.kind === "class" ? entry.origin.id : entry.origin.kind;
  return { tier, value: entry.value };
}

describe("the site's edit of a block's own look, in Classic spacing", () => {
  const edited = [primary];

  it("is over the frozen base, and under a look, a shared style and the block's own value", () => {
    expect(from("color", edited, [outline, cta], colour("#aa0000"))?.tier).toBe(
      "node"
    );
    expect(from("color", edited, [outline, cta])?.tier).toBe("c-cta");
    expect(from("color", edited, [outline])?.tier).toBe(outline.id);
    expect(from("color", edited, [])).toEqual({
      tier: "blockType",
      value: "#aa00aa",
    });
    // The control: without the edit, the frozen base's own colour shows.
    const unedited = from("color", [], []);
    expect(unedited?.tier).toBe("blockType");
    expect(unedited?.value).not.toBe("#aa00aa");
  });

  it("keeps every default value the site did not change", () => {
    expect(from("display", edited, [])).toEqual(from("display", [], []));
    expect(from("display", [], [])?.value).toBe("inline-block");
  });

  it("is never written as a class, so a block listing it gains nothing from it", () => {
    const css = (library: NamedClass[], worn: NamedClass[]) =>
      compiled(library, worn).styles.css;
    expect(css(edited, [])).toContain("#aa00aa");
    expect(css(edited, [])).not.toContain("button-primary");
    // Listed by a block, it adds no class rule: the block reads the edit only
    // through its base, as every other button does.
    expect(css([], [primary])).toBe(css([primary], []));
  });

  it("reaches only its own block type", () => {
    const onImage = { ...primary, blockType: "core/image" };
    expect(from("color", [onImage], [])).toEqual(from("color", [], []));
  });

  it("moves the stamp of a stored sheet when the edit or its mark changes", () => {
    const base = { breakpoints: BREAKPOINTS };
    const id = (namedClasses: NamedClass[]) =>
      sharedStyleInputsId({ ...base, namedClasses });
    expect(id([primary])).not.toBe(id([]));
    expect(id([primary])).not.toBe(
      id([{ ...primary, styles: colour("#00aaaa") }])
    );
    // The same entry without the mark is a look a block wears instead.
    const { isDefault: _mark, ...worn } = primary;
    expect(id([primary])).not.toBe(id([worn]));
  });
});

describe("the site's own looks, when the route states classes of its own", () => {
  const route = { breakpoints: BREAKPOINTS, namedClasses: [outline, cta] };
  const site = { breakpoints: BREAKPOINTS, classes: [primary, outline, cta] };

  it("keeps the route's classes and carries the site's own look over", () => {
    const reconciled = sharedStyleInputs(route, site).namedClasses ?? [];
    expect(reconciled.map(each => each.id)).toEqual([
      outline.id,
      cta.id,
      primary.id,
    ]);
    // So the page's base is the site's edit, and the stamp follows the edit.
    expect(from("color", reconciled, [])).toEqual({
      tier: "blockType",
      value: "#aa00aa",
    });
    const id = (classes: NamedClass[]) =>
      sharedStyleInputsId({
        breakpoints: BREAKPOINTS,
        namedClasses:
          sharedStyleInputs(route, { ...site, classes }).namedClasses ??
          undefined,
      });
    expect(id([primary, outline, cta])).not.toBe(
      id([{ ...primary, styles: colour("#00aaaa") }, outline, cta])
    );
  });

  it("puts the site's own look in place of one the route states", () => {
    const stale = { ...primary, styles: colour("#000000") };
    const reconciled =
      sharedStyleInputs({ ...route, namedClasses: [stale, outline] }, site)
        .namedClasses ?? [];
    expect(reconciled).toEqual([outline, primary]);
  });

  it("leaves the route's classes as they are where neither holds an own look", () => {
    const plain = { breakpoints: BREAKPOINTS, classes: [outline, cta] };
    expect(sharedStyleInputs(route, plain).namedClasses).toBe(
      route.namedClasses
    );
  });
});
