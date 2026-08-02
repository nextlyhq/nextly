import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  allBlocks,
  clearBlocks,
  getBlock,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import type { BlockNode } from "@nextlyhq/blocks-engine";
import type {
  BlockRenderArgs,
  BlockRenderContext,
} from "@nextlyhq/plugin-sdk/blocks";
import type { ReactElement } from "react";

import type { DataProvider } from "../context";

import { box } from "./box";
import { collectionLoop, renderCollectionLoop } from "./collection-loop";
import { CONTENT_WIDTH_CLASS, renderContainer } from "./container";
import type { ContainerProps } from "./container";
import { section } from "./section";

const NODE: BlockNode = { id: "n1", type: "core/box", version: 1, props: {} };

/** Coerce deliberately-malformed stored props, the way a document can hold them. */
function storedProps(props: unknown): ContainerProps {
  return props as ContainerProps;
}

/**
 * Render arguments whose slot draws what it is asked to draw.
 *
 * The stub echoes the entry on the context it was handed, which is the only way
 * to tell a slot drawn once per entry from one drawn once and copied: identical
 * output either way, unless the output depends on the entry.
 */
function args<P>(
  props: P,
  ctx: BlockRenderContext = {}
): BlockRenderArgs<P> & { drawnWith: BlockRenderContext[] } {
  const drawnWith: BlockRenderContext[] = [];
  return {
    props,
    node: NODE,
    className: "nx-n1",
    ctx,
    drawnWith,
    renderSlot: (_name: string, override?: BlockRenderContext) => {
      const used = override ?? ctx;
      drawnWith.push(used);
      const title = used.item?.title;
      return <span>{typeof title === "string" ? title : "child"}</span>;
    },
  };
}

/** A data source that answers from a fixed list and records what it was asked. */
function stubProvider(items: Record<string, unknown>[]): {
  provider: DataProvider;
  calls: Parameters<DataProvider["find"]>[0][];
} {
  const calls: Parameters<DataProvider["find"]>[0][] = [];
  return {
    calls,
    provider: {
      find: findArgs => {
        calls.push(findArgs);
        return Promise.resolve({ items });
      },
    },
  };
}

describe("the container presets", () => {
  it("renders the tag it is told to and no wrapper around it", () => {
    const html = renderToStaticMarkup(
      renderContainer(args<ContainerProps>({ as: "section" }))
    );
    // One element carrying the generated class, with the slot inside it: a
    // wrapper here would break the one-selector-per-node contract the compiler
    // depends on.
    expect(html).toBe('<section class="nx-n1"><span>child</span></section>');
  });

  it("adds the content-width class only when contained", () => {
    const contained = renderToStaticMarkup(
      renderContainer(args<ContainerProps>({ as: "div", contained: true }))
    );
    expect(contained).toContain(CONTENT_WIDTH_CLASS);
    const full = renderToStaticMarkup(
      renderContainer(args<ContainerProps>({ as: "div", contained: false }))
    );
    expect(full).not.toContain(CONTENT_WIDTH_CLASS);
  });

  it("defaults to a div, so a preset that names no tag still renders", () => {
    const html = renderToStaticMarkup(
      renderContainer(args<ContainerProps>({}))
    );
    expect(html.startsWith("<div ")).toBe(true);
  });

  it("gives section and box the same capabilities", () => {
    // A preset differs from its sibling in defaults, never in what it can do.
    // Two containers whose supports diverge is how a "why are there two of
    // these?" pair starts.
    expect(box.supports).toEqual(section.supports);
    expect(section.defaultProps).toEqual({ as: "section", contained: true });
    expect(box.defaultProps).toEqual({ as: "div", contained: false });
  });

  it("gives box no padding of its own", () => {
    // A default padding is removed at the start of every project that has one.
    const styled = box as { styles?: unknown };
    expect(styled.styles).toBeUndefined();
    expect(JSON.stringify(box.defaultProps)).not.toContain("padding");
  });
});

describe("core/collection-loop", () => {
  it("repeats its template once per entry", async () => {
    const { provider, calls } = stubProvider([{ id: "a" }, { id: "b" }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string; limit?: number }>(
        { collection: "posts", limit: 5 },
        { data: provider }
      )
    );
    const html = renderToStaticMarkup(element);
    expect(html.match(/<span>child<\/span>/g)).toHaveLength(2);
    expect(calls).toEqual([{ collection: "posts", limit: 5 }]);
  });

  it("passes a sort through only when one is set", async () => {
    const { provider, calls } = stubProvider([]);
    await renderCollectionLoop(
      args<{ collection?: string; sort?: string }>(
        { collection: "posts", sort: "-publishedAt" },
        { data: provider }
      )
    );
    expect(calls[0]).toEqual({
      collection: "posts",
      limit: 10,
      sort: "-publishedAt",
    });
  });

  it("renders its template once while no collection is chosen", async () => {
    const { provider, calls } = stubProvider([{ id: "a" }, { id: "b" }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({}, { data: provider })
    );
    const html = renderToStaticMarkup(element);
    // An author who has placed the loop but not chosen a collection still sees
    // what they are building, and nothing was queried.
    expect(html.match(/<span>child<\/span>/g)).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("renders its template once when the renderer supplies no data source", async () => {
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({ collection: "posts" }, {})
    );
    expect(renderToStaticMarkup(element)).toContain("<span>child</span>");
  });

  it("renders empty rather than throwing when the query fails", async () => {
    const failing: DataProvider = {
      find: () => Promise.reject(new Error("no database")),
    };
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({ collection: "posts" }, { data: failing })
    );
    const html = renderToStaticMarkup(element);
    // The page survives a data source it cannot reach: this block goes empty,
    // and everything around it still renders.
    expect(html).toBe('<div class="nx-n1"></div>');
  });

  it("keys each iteration by the entry id, falling back to its position", async () => {
    // Two entries without ids must not collide onto one key, which is what a
    // fixed key would do the moment a collection has no id field.
    const { provider } = stubProvider([{ title: "x" }, { title: "y" }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({ collection: "posts" }, { data: provider })
    );
    const children = (
      element as ReactElement<{ children: ReactElement<unknown>[] }>
    ).props.children;
    expect(children.map(child => child.key)).toEqual(["0", "1"]);
  });

  it("draws its template again per entry, under that entry's context", async () => {
    // The point of a slot being something a block DRAWS. Drawn once and copied,
    // every row would read "child"; drawn per entry with that entry named on
    // the context, each row reads its own title.
    const { provider } = stubProvider([
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
    ]);
    const rendered = args<{ collection?: string }>(
      { collection: "posts" },
      { data: provider }
    );
    const html = renderToStaticMarkup(await renderCollectionLoop(rendered));
    expect(html).toContain("First");
    expect(html).toContain("Second");
    // The surrounding context is carried through, not replaced wholesale: a
    // block deeper in the template can still reach the data source.
    expect(rendered.drawnWith.map(c => c.item?.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(rendered.drawnWith.every(c => c.data === provider)).toBe(true);
  });

  it("draws nothing until it is asked to", async () => {
    // Laziness is the other half of the change: a slot that is never drawn
    // costs nothing, which is what lets a block show one panel out of four
    // without paying for the three it hides.
    const rendered = args<{ collection?: string }>({ collection: "posts" }, {});
    expect(rendered.drawnWith).toEqual([]);
    await renderCollectionLoop(rendered);
    expect(rendered.drawnWith.length).toBeGreaterThan(0);
  });

  it("keys an iteration by a numeric id as readily as a string one", async () => {
    // A numerically-keyed collection is ordinary. Falling back to the position
    // for those gives every row a positional key, which is precisely the case
    // where reordering makes React reuse the wrong DOM node.
    const { provider } = stubProvider([{ id: 7 }, { id: 8 }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({ collection: "posts" }, { data: provider })
    );
    const children = (
      element as ReactElement<{ children: ReactElement<unknown>[] }>
    ).props.children;
    expect(children.map(child => child.key)).toEqual(["7", "8"]);
  });

  it("locks its template to content-only editing", () => {
    // The shape is the author's and the repetition is the block's; a structural
    // edit inside one iteration is how a repeater stops being predictable.
    expect(collectionLoop.slots?.children.lock).toBe("contentOnly");
  });
});

describe("the gate blocks are registrable definitions", () => {
  it("each carries the metadata registration and tooling require", () => {
    for (const block of [section, box, collectionLoop]) {
      expect(block.name).toMatch(/^core\/[a-z-]+$/);
      expect(block.version).toBe(1);
      expect(block.description.length).toBeGreaterThan(0);
      expect(block.example).toBeDefined();
      expect(typeof block.render).toBe("function");
    }
  });

  it("passes the real registry rather than a description of it", () => {
    // Registration is where a block's supports are checked against what is
    // registered, and where an uncovered version bump is refused. Asserting the
    // fields by hand would pass for a definition the registry rejects.
    clearBlocks();
    try {
      registerBlocks([section, box, collectionLoop], {
        source: "@nextlyhq/plugin-page-builder",
      });
      expect(
        allBlocks()
          .map(block => block.name)
          .sort()
      ).toEqual(["core/box", "core/collection-loop", "core/section"]);
      expect(getBlock("core/collection-loop")?.version).toBe(1);
    } finally {
      clearBlocks();
    }
  });
});

describe("a container does not trust what is stored", () => {
  it("falls back to a safe tag when the stored one is not a container tag", () => {
    // Validation only asks that props be an object, so `as` arrives as data.
    // A stored void element handed children throws inside React and takes the
    // page down with it.
    const html = renderToStaticMarkup(
      renderContainer(args<ContainerProps>(storedProps({ as: "img" })))
    );
    expect(html.startsWith("<div ")).toBe(true);
  });
});
