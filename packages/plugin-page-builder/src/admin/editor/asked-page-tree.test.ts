/**
 * The page's tree as the canvas's bindings are asked of it, for a template
 * whose Entry content block carries conditions of its own.
 *
 * The canvas draws every conditioned block, whoever the page would show it
 * to, and with the previewed entry's Body composed into Entry content. The
 * renderer's pipeline, which prepares the tree the ask is made of, holds a
 * conditioned block back as a visitor's page does, so a heading in the Body
 * bound to the entry's `slug` went unasked: the route read no `slug`, and the
 * canvas drew the heading's fallback, the switch that applies conditions on
 * or off. Here the ask is read off the tree, as the canvas's request reads
 * it (`bindingDemand`).
 *
 * @module admin/editor/asked-page-tree.test
 */
import {
  bindingDemand,
  clearBlocks,
  composeEntryContent,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  prepareDocumentForRead,
  registeredBlocks,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { askedPageTree } from "./use-render-inputs";

beforeAll(() => {
  clearBlocks();
  registerBlocks([...coreBlocks], { source: "asked-page-tree-test" });
});

afterAll(() => {
  clearBlocks();
});

/** The article's Body: a heading bound to its slug. */
const BODY: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "b0",
      type: "core/heading",
      version: 1,
      props: { text: "Body heading fallback", level: "h3" },
      bindings: { text: { $bind: "slug" } },
    },
  ],
};

/** The articles template, its Entry content block gated or not. */
function template(gated: boolean): BlockDocument {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "ec",
        type: "core/entry-content",
        version: 1,
        props: { field: "body" },
        ...(gated
          ? {
              visibility: {
                conditions: [
                  [{ field: "title", op: "contains", value: "content model" }],
                ],
              },
            }
          : {}),
      },
    ],
  };
}

/** The template with the article's Body composed in, as the canvas draws it. */
function drawn(gated: boolean): BlockDocument {
  return composeEntryContent(template(gated), {
    valueOf: field => (field === "body" ? BODY : undefined),
  });
}

const RENDER = {
  styleContext: { breakpoints: { viewport: [], container: [] } },
};

/** The entry fields a tree asks the route for. */
function entryFieldsOf(tree: BlockDocument | null): readonly string[] {
  return tree === null ? [] : (bindingDemand([tree]).entry?.fields ?? []);
}

describe("the canvas's ask of a template's Entry content", () => {
  it("asks for what the Body binds, its block unconditioned (the control)", () => {
    expect(
      entryFieldsOf(askedPageTree(drawn(false), new Map(), RENDER))
    ).toEqual(["slug"]);
  });

  it("asks for what the Body binds while its block carries conditions", () => {
    expect(
      entryFieldsOf(askedPageTree(drawn(true), new Map(), RENDER))
    ).toEqual(["slug"]);
  });

  it("is not the tree a visitor is served, which holds the block back", () => {
    // The tree the ask was made of before: the renderer's own preparation,
    // which drops the conditioned block and the Body composed into it.
    const served = prepareDocumentForRead(drawn(true), {
      resolver: registeredBlocks(),
      styleContext: RENDER.styleContext,
      definitions: new Map(),
    });
    expect(entryFieldsOf(served)).toEqual([]);
    // Handed it as the gated tree, the ask is still made of the page as
    // drawn, since the page holds a conditioned block.
    expect(
      entryFieldsOf(askedPageTree(drawn(true), new Map(), RENDER, served))
    ).toEqual(["slug"]);
  });
});
