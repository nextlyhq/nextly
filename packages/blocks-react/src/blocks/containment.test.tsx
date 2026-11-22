/**
 * Every container that shares the Section's rendering is contained the same
 * way: the content-width class on its own element and nothing around it.
 *
 * The site sheet pads a contained element's content in to the content width
 * and leaves the element itself full width, so its background reaches the
 * edges. That only works while the class sits on the one element the block
 * draws, with the block's children directly inside it: a wrapper would add a
 * node to every flow, flex and grid layout, and the padding would land on the
 * wrong box.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlockDefinition,
  BlockDocument,
  BlockNode,
} from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";
import type { BlockResolver } from "../resolver";
import { resolvePageStyles, type PageStyles } from "../styles";

import { accordion } from "./accordion";
import { box } from "./box";
import { card } from "./card";
import { column } from "./column";
import { columns } from "./columns";
import { CONTENT_WIDTH_CLASS } from "./container";
import type { ContainerProps } from "./container";
import { gallery } from "./gallery";
import { coreBlocks } from "./index";
import { section } from "./section";

const CONTAINERS = [
  section,
  box,
  columns,
  column,
  card,
  accordion,
  gallery,
].map(
  definition =>
    [
      definition.name,
      definition as unknown as BlockDefinition<ContainerProps, PageContext>,
    ] as const
);

function drawn(
  definition: BlockDefinition<ContainerProps, PageContext>,
  contained: boolean
): string {
  return renderToStaticMarkup(
    definition.render({
      props: { ...definition.defaultProps, contained },
      node: { id: "n1", type: definition.name, version: 1, props: {} },
      className: "nx-n1",
      partClass: () => "",
      ctx: {} as PageContext,
      renderSlot: () => <span>child</span>,
    }) as ReactElement
  );
}

describe("a contained container", () => {
  it.each(CONTAINERS)(
    "%s carries the class on its own element, with its children directly inside",
    (_, definition) => {
      const html = drawn(definition, true);
      expect(html).toMatch(
        new RegExp(
          `^<([a-z]+) class="nx-n1 ${CONTENT_WIDTH_CLASS}"><span>child</span></\\1>$`
        )
      );
    }
  );

  it.each(CONTAINERS)(
    "%s carries no class when it is not contained",
    (_, definition) => {
      const html = drawn(definition, false);
      expect(html).not.toContain(CONTENT_WIDTH_CLASS);
      expect(html).toMatch(
        /^<([a-z]+) class="nx-n1"><span>child<\/span><\/\1>$/
      );
    }
  );
});

/**
 * A page stylesheet stored before contained blocks were padded in.
 *
 * That compiler wrote an author's side padding as the bare value, which
 * outweighs the containment rule, so the content of a contained Section with
 * 300px at its sides ran past the content width on a narrow page. A stored
 * sheet is reused while its stamp matches, so the stamp's encoding moved and
 * the old sheet is recompiled on its next read rather than served.
 */
describe("a sheet stored before contained blocks were padded in", () => {
  const DOC: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "band",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        styles: {
          base: {
            base: { padding: { inlineStart: "300px", inlineEnd: "300px" } },
          },
        },
      } as BlockNode,
    ],
  };
  const resolver: BlockResolver = {
    get: (name: string) =>
      coreBlocks.find(block => block.name === name) as never,
  };
  const context = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };
  const PADDED_IN =
    "padding-inline-start: max(300px, var(--nx-contain-inset, 0px))";

  /** The sheet as the `v6` compiler stored it: the bare padding, a `v6` stamp. */
  function storedByV6(): PageStyles {
    const current = resolvePageStyles(DOC, undefined, context, resolver);
    return {
      ...current,
      css: current.css.replaceAll(PADDED_IN, "padding-inline-start: 300px"),
      sharedInputsId: current.sharedInputsId?.replace(/^v\d+:/, "v6:"),
    } as PageStyles;
  }

  it("is recompiled on a read with no compile context", () => {
    const stored = storedByV6();
    expect(stored.css).not.toContain(PADDED_IN);
    const served = resolvePageStyles(DOC, stored, undefined, resolver);
    expect(served.css).toContain(PADDED_IN);
    expect(served.sharedInputsId?.startsWith("v13:")).toBe(true);
  });

  it("is recompiled where a compile context exists", () => {
    const served = resolvePageStyles(DOC, storedByV6(), context, resolver);
    expect(served.css).toContain(PADDED_IN);
  });

  it("CONTROL: a sheet stored by the current compiler is served as it stands", () => {
    const current = resolvePageStyles(DOC, undefined, context, resolver);
    // Marked so a recompile would show: the same stamp, a css nobody compiles.
    const marked = { ...current, css: `${current.css}\n/* stored */` };
    expect(resolvePageStyles(DOC, marked, undefined, resolver).css).toBe(
      marked.css
    );
  });
});

/**
 * A page stylesheet stored before a row's items were flagged.
 *
 * That compiler wrote no flag on a flex block's children, so a
 * contained item in a row was inset from the whole row's width. The stamp's
 * encoding moved, so such a sheet is recompiled on its next read.
 */
describe("a sheet stored before a row's items were flagged", () => {
  const DOC: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "row",
        type: "core/box",
        version: 1,
        props: { as: "div", contained: false },
        styles: { base: { base: { display: "flex" } } },
        slots: {
          children: [
            {
              id: "item",
              type: "core/box",
              version: 1,
              props: { as: "div", contained: true },
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ],
  };
  const resolver: BlockResolver = {
    get: (name: string) =>
      coreBlocks.find(block => block.name === name) as never,
  };
  const context = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };
  const FLAGGED = "--nx-sized-item: 1";

  /** The sheet as the `v7` compiler stored it: no flag, a `v7` stamp. */
  function storedByV7(): PageStyles {
    const current = resolvePageStyles(DOC, undefined, context, resolver);
    return {
      ...current,
      css: current.css
        .split("\n")
        .filter(line => !line.includes(FLAGGED))
        .join("\n"),
      sharedInputsId: current.sharedInputsId?.replace(/^v\d+:/, "v7:"),
    } as PageStyles;
  }

  it("is recompiled with the flag, with or without a compile context", () => {
    expect(storedByV7().css).not.toContain(FLAGGED);
    for (const read of [undefined, context]) {
      const served = resolvePageStyles(DOC, storedByV7(), read, resolver);
      expect(served.css).toContain(FLAGGED);
      expect(served.sharedInputsId?.startsWith("v13:")).toBe(true);
    }
  });
});
