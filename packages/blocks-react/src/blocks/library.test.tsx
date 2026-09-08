import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  allBlocks,
  clearBlocks,
  getBlock,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import type { BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type {
  BlockRenderArgs,
  BlocksDataProvider,
  PageContext,
} from "../context";

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
/**
 * A context supplying the host services every render receives, all inert.
 *
 * `PageContext` requires them, so a test that does not care still has to hand
 * over something; answering nothing is what a standalone render does anyway.
 */
function testContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  };
}

function args<P>(
  props: P,
  ctx: PageContext = testContext()
): BlockRenderArgs<P> & { drawnWith: PageContext[] } {
  const drawnWith: PageContext[] = [];
  return {
    props,
    node: NODE,
    className: "nx-n1",
    // Required by the render contract. These fixtures declare no parts, so the
    // answer is empty for every name — but a renderer that could omit it would
    // leave every block's parts unmarked with nothing to report.
    partClass: () => "",
    ctx,
    drawnWith,
    renderSlot: (_name: string, override?: PageContext) => {
      const used = override ?? ctx;
      drawnWith.push(used);
      const title = used.item?.title;
      return <span>{typeof title === "string" ? title : "child"}</span>;
    },
  };
}

/** A data source that answers from a fixed list and records what it was asked. */
function stubProvider(items: Record<string, unknown>[]): {
  provider: BlocksDataProvider;
  calls: Parameters<BlocksDataProvider["find"]>[0][];
} {
  const calls: Parameters<BlocksDataProvider["find"]>[0][] = [];
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
        testContext({ data: provider })
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
        testContext({ data: provider })
      )
    );
    expect(calls[0]).toEqual({
      collection: "posts",
      limit: 10,
      sort: "-publishedAt",
    });
  });

  it("declares its children as a slot it may not draw", async () => {
    // Half of a two-part mechanism: the engine's SEO walk skips declared
    // conditional slots, and this is the block saying its children are one.
    // Without the declaration the walk has nothing to skip, and an empty loop's
    // template would title the page with content it never rendered.
    expect(collectionLoop.conditionalSlots).toEqual(["children"]);
  });

  it("queries in the locale the page is being rendered in", async () => {
    // Without it the provider reads the default locale, so a French page
    // embeds English rows: the surrounding blocks translate and the looped
    // content silently does not.
    const { provider, calls } = stubProvider([]);
    await renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: provider, locale: "fr" })
      )
    );
    expect(calls[0]).toEqual({ collection: "posts", limit: 10, locale: "fr" });
  });

  it("omits the locale key entirely on an unlocalized page", async () => {
    // A present-but-undefined `locale` is not the same as no locale to a
    // provider that spreads its arguments into a query.
    const { provider, calls } = stubProvider([]);
    await renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: provider })
      )
    );
    expect(calls[0]).toEqual({ collection: "posts", limit: 10 });
    expect("locale" in (calls[0] ?? {})).toBe(false);
  });

  it("renders its template once while no collection is chosen", async () => {
    const { provider, calls } = stubProvider([{ id: "a" }, { id: "b" }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string }>({}, testContext({ data: provider }))
    );
    const html = renderToStaticMarkup(element);
    // An author who has placed the loop but not chosen a collection still sees
    // what they are building, and nothing was queried.
    expect(html.match(/<span>child<\/span>/g)).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("renders its template once when the renderer supplies no data source", async () => {
    const element = await renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: undefined })
      )
    );
    expect(renderToStaticMarkup(element)).toContain("<span>child</span>");
  });

  it("renders empty rather than throwing when the query fails", async () => {
    const failing: BlocksDataProvider = {
      find: () => Promise.reject(new Error("no database")),
    };
    const element = await renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: failing })
      )
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
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: provider })
      )
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
      testContext({ data: provider })
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
    const rendered = args<{ collection?: string }>(
      { collection: "posts" },
      testContext({ data: undefined })
    );
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
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: provider })
      )
    );
    const children = (
      element as ReactElement<{ children: ReactElement<unknown>[] }>
    ).props.children;
    expect(children.map(child => child.key)).toEqual(["7", "8"]);
  });

  it("leaves its empty body structurally editable", () => {
    // The body starts empty, and a content-only lock forbids exactly the edits
    // that would fill it, so an author could never insert the blocks the loop
    // repeats. Locking a finished body is worth having; locking an empty one
    // only stops it being written.
    //
    // Nor is a declared default the answer: what one entry should look like is
    // a property of the collection being looped, which the block cannot see
    // from its own declaration.
    expect(collectionLoop.slots?.children.lock).toBeUndefined();
    expect(collectionLoop.slots?.children.defaultBlock).toBeUndefined();
  });

  it("treats a cleared collection name as no collection", () => {
    // A cleared text field persists as "". Queried, it fails, the failure is
    // swallowed, and the block renders empty instead of showing its template.
    const { provider, calls } = stubProvider([{ id: "a" }]);
    return renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "   " },
        testContext({ data: provider })
      )
    ).then(element => {
      expect(renderToStaticMarkup(element)).toContain("<span>child</span>");
      expect(calls).toEqual([]);
    });
  });

  it("holds a stored limit to the bounds its schema advertises", async () => {
    // Props are validated as an object and nothing more, so a stored or
    // migrated node can carry any number at all, and it goes straight to a
    // host-supplied data source.
    const { provider, calls } = stubProvider([]);
    await renderCollectionLoop(
      args<{ collection?: string; limit?: number }>(
        { collection: "posts", limit: 100_000 },
        testContext({ data: provider })
      )
    );
    expect(calls[0]?.limit).toBe(100);
    const second = stubProvider([]);
    await renderCollectionLoop(
      args<{ collection?: string; limit?: number }>(
        { collection: "posts", limit: -5 },
        testContext({ data: second.provider })
      )
    );
    expect(second.calls[0]?.limit).toBe(1);
  });

  it("stops querying when the page has spent its allowance", async () => {
    // A loop inside a loop asks once per entry of the outer one, so depth in a
    // document becomes multiplication in queries.
    const { provider, calls } = stubProvider([{ id: "a" }]);
    const element = await renderCollectionLoop(
      args<{ collection?: string }>(
        { collection: "posts" },
        testContext({ data: provider, queries: { take: () => false } })
      )
    );
    expect(calls).toEqual([]);
    expect(renderToStaticMarkup(element)).toBe('<div class="nx-n1"></div>');
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
