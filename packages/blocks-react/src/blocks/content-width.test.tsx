/**
 * Content width on every container: the two settings in Style › Layout, the
 * defaults a new container starts with, the class a Boxed container wears,
 * and the width of its own the page compile writes for it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CONTENT_WIDTH_PROP,
  CONTENT_WIDTH_PROPERTY,
  nodeClassName,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";
import type { BlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { renderCollectionLoop } from "./collection-loop";
import { CONTENT_WIDTH_CLASS, CONTENT_WIDTH_PROPS } from "./container";
import { entryContent } from "./entry-content";
import { coreBlocks } from "./index";

/** The containers that offer Content width, by name. */
const CONTAINERS = [
  "core/section",
  "core/box",
  "core/columns",
  "core/column",
  "core/card",
  "core/accordion",
  "core/gallery",
  "core/collection-loop",
  "core/entry-content",
];

function definition(name: string): AnyBlockDefinition {
  const found = coreBlocks.find(block => block.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found as AnyBlockDefinition;
}

describe("Content width on every container", () => {
  it.each(CONTAINERS)("%s offers it in Style › Layout", name => {
    const props = definition(name).props ?? {};
    expect(props.contained).toMatchObject({
      label: "Content width",
      type: "checkbox",
      group: "style",
      section: "layout",
    });
    expect(props[CONTENT_WIDTH_PROP]).toMatchObject({
      group: "style",
      section: "layout",
    });
  });

  it("keeps the width under the prop the page compile reads", () => {
    expect(Object.keys(CONTENT_WIDTH_PROPS)).toEqual([
      "contained",
      CONTENT_WIDTH_PROP,
    ]);
  });

  it("no longer offers the old checkbox anywhere", () => {
    for (const block of coreBlocks) {
      for (const schema of Object.values(block.props ?? {})) {
        expect((schema as { label?: string }).label).not.toBe(
          "Constrain content width"
        );
      }
    }
  });

  it("starts a new Section Boxed and every other container Full width", () => {
    for (const name of CONTAINERS) {
      const defaults = definition(name).defaultProps as { contained?: boolean };
      expect([name, defaults.contained]).toEqual([
        name,
        name === "core/section",
      ]);
    }
  });
});

describe("a Boxed Collection list and Entry content", () => {
  const node = (type: string): BlockNode =>
    ({ id: "n1", type, version: 1, props: {} }) as BlockNode;
  const ctx = {} as PageContext;

  it.each([true, false])(
    "a Collection list wears the class only while Boxed (%s)",
    async contained => {
      const html = renderToStaticMarkup(
        await renderCollectionLoop({
          props: { contained },
          node: node("core/collection-loop"),
          ctx,
          className: "own",
          partClass: (name: string) => name,
          renderSlot: () => null,
        } as never)
      );
      expect(html.includes(`class="own ${CONTENT_WIDTH_CLASS}"`)).toBe(
        contained
      );
    }
  );

  it.each([true, false])(
    "Entry content wears the class only while Boxed (%s)",
    contained => {
      const withChild = {
        ...node("core/entry-content"),
        slots: { content: [node("core/text")] },
      } as BlockNode;
      const drawn = entryContent.render({
        props: { contained },
        node: withChild,
        ctx,
        className: "own",
        partClass: (name: string) => name,
        renderSlot: () => null,
      } as never);
      const html = renderToStaticMarkup(<>{drawn}</>);
      expect(html.includes(`class="own ${CONTENT_WIDTH_CLASS}"`)).toBe(
        contained
      );
    }
  );
});

describe("a container's own width on the page", () => {
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
  const section = (
    id: string,
    props: Record<string, unknown>,
    children: BlockNode[] = []
  ): BlockNode =>
    ({
      id,
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true, ...props },
      ...(children.length === 0 ? {} : { slots: { children } }),
    }) as BlockNode;

  function css(nodes: BlockNode[]): string {
    const doc: BlockDocument = { formatVersion: 1, kind: "page", nodes };
    return resolvePageStyles(doc, undefined, context, resolver).css;
  }

  it("is written on the container that states it, and not on one inside it", () => {
    const sheet = css([
      section("outer", { contentWidth: "1400px" }, [section("inner", {})]),
    ]);
    expect(sheet).toContain(
      `.${nodeClassName("outer")} { ${CONTENT_WIDTH_PROPERTY}: 1400px }`
    );
    expect(sheet).not.toMatch(
      new RegExp(
        `\\.${nodeClassName("inner")} \\{[^}]*${CONTENT_WIDTH_PROPERTY}`
      )
    );
  });

  it("CONTROL: a container stating none writes no width of its own", () => {
    expect(css([section("only", {})])).not.toContain(CONTENT_WIDTH_PROPERTY);
  });
});
