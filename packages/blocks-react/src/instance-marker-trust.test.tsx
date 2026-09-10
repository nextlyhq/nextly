/**
 * Who is allowed to say which component instance an element belongs to.
 *
 * The marker decides what an editor click selects, edits and deletes, so the
 * value behind it is a trust boundary rather than a rendering detail. Two
 * parties can reach the element it lands on and neither may write it: the
 * stored DOCUMENT, whose route is already closed by the attribute allowlist,
 * and the BLOCK, which builds the element itself and is plugin code.
 *
 * A block gets at it two ways, and this module exists for both. It can return
 * a root that already carries the attribute, which a merge only OVER supplied
 * keys would preserve. And it can mutate the node object it was handed, which
 * a marker read after the render would then believe — including after an
 * `await`, where "after the render" is a window rather than an instant.
 *
 * @module instance-marker-trust.test
 */
import {
  defineBlock,
  type AnyBlockDefinition,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BlockBoundary,
  INSTANCE_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
} from "./block-boundary";
import { editorMarkers } from "./editor-markers";
import type { PageContext } from "./context";
import { createBlockResolver } from "./resolver";

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

/** A block whose root arrives already wearing provenance it invented. */
const forger = defineBlock<Record<string, never>, PageContext>({
  name: "test/forger",
  version: 1,
  description: "Returns a root carrying an instance marker of its own.",
  props: {},
  example: { props: {} },
  render: () => <div data-nx-instance="a-component-it-does-not-belong-to" />,
});

/**
 * A block that rewrites its own provenance while rendering.
 *
 * Mutates rather than returns, because the value under test is the one the
 * BOUNDARY reads afterwards, not anything in the block's output.
 */
const mutator = defineBlock<Record<string, never>, PageContext>({
  name: "test/mutator",
  version: 1,
  description: "Rewrites node.instanceOf during render.",
  props: {},
  example: { props: {} },
  render: ({ node }) => {
    (node as { instanceOf?: string }).instanceOf = "an-instance-it-invented";
    return <div />;
  },
});

/** The same, one `await` later, which is the window a snapshot has to span. */
const asyncMutator = defineBlock<Record<string, never>, PageContext>({
  name: "test/async-mutator",
  version: 1,
  description: "Rewrites node.instanceOf after awaiting.",
  props: {},
  example: { props: {} },
  render: async ({ node }) => {
    await Promise.resolve();
    (node as { instanceOf?: string }).instanceOf = "an-instance-it-invented";
    return <div />;
  },
});

/** Writes the marker in a DIFFERENT CASE, which merges by a different key. */
const casedForger = defineBlock<Record<string, never>, PageContext>({
  name: "test/cased-forger",
  version: 1,
  description: "Returns a root carrying data-NX-instance.",
  props: {},
  example: { props: {} },
  render: () => <div data-NX-instance="forged" />,
});

const blocks = createBlockResolver([
  forger,
  mutator,
  asyncMutator,
  casedForger,
] as unknown as AnyBlockDefinition[]);

function node(type: string, extra: Record<string, unknown> = {}): BlockNode {
  return { id: "n1", type, version: 1, props: {}, ...extra } as BlockNode;
}

/**
 * Renders through the STREAM, which is what an async block needs.
 *
 * `renderToStaticMarkup` does not await Suspense, so a block that awaits comes
 * back as the empty string — and every `not.toContain` assertion below would
 * then pass without the case having rendered. The presence assertion beside
 * each one is what caught that, and this is the fix rather than a weaker
 * assertion.
 */
async function renderStreamed(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

function render(subject: BlockNode): string {
  return renderToStaticMarkup(
    <BlockBoundary
      node={subject}
      context={context()}
      blocks={blocks}
      classes={{}}
      nodeAttribute
    />
  );
}

// The env stub is process-wide, so a case that set it would otherwise decide
// what its neighbours render — and "production" is the branch that hides the
// element every other case asserts on.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provenance a block supplied is not provenance", () => {
  it("REMOVES a marker a page-owned block put on its own root", async () => {
    // The resolver marked nothing, so this element belongs to the page. The
    // boundary used to add the attribute only when provenance existed, and
    // `cloneElement` keeps whatever the merge does not overwrite — so this
    // block's own string survived onto a root that also carries a valid node
    // address. An editor preferring the instance marker then sends a click on
    // the author's own block to a component it has nothing to do with.
    const html = render(node("test/forger"));

    // Present first, so an assertion about the marker cannot be satisfied by
    // the block having failed to render at all.
    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
    expect(html).not.toContain(INSTANCE_ATTRIBUTE);
  });

  it("keeps the RESOLVER's marker when the block supplies none", async () => {
    // The control on the removal above, and the one that stops "delete it
    // always" from passing: a genuinely definition-owned node still says so.
    const html = render(node("test/mutator", { instanceOf: "i1" }));

    expect(html).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
  });
});

describe("provenance is read before the block runs, not after", () => {
  it("ignores a value the block wrote onto the node during render", async () => {
    // The node is the page's own, and the block hands itself provenance while
    // rendering. Read afterwards this is indistinguishable from a resolver
    // marking, because it IS the same field on the same object.
    const html = render(node("test/mutator"));

    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
    expect(html).not.toContain("an-instance-it-invented");
  });

  it("ignores one written AFTER an await, which is a window not an instant", async () => {
    // The asynchronous path re-enters the output check with the same object,
    // so a snapshot taken anywhere but the boundary's entry would be taken
    // inside the window it exists to close.
    const html = await renderStreamed(
      <BlockBoundary
        node={node("test/async-mutator")}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
    expect(html).not.toContain("an-instance-it-invented");
  });

  it("does not let a block ERASE the provenance it was given", async () => {
    // The other direction, and the one that loses an author their selection
    // rather than misdirecting it: a definition-owned block deleting the field
    // would leave the editor with a re-minted id addressing nothing.
    const erasing = defineBlock<Record<string, never>, PageContext>({
      name: "test/eraser",
      version: 1,
      description: "Deletes its own provenance while rendering.",
      props: {},
      example: { props: {} },
      render: ({ node: live }) => {
        delete (live as { instanceOf?: string }).instanceOf;
        return <div />;
      },
    });
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/eraser", { instanceOf: "i1" })}
        context={context()}
        blocks={createBlockResolver([
          erasing,
        ] as unknown as AnyBlockDefinition[])}
        classes={{}}
        nodeAttribute
      />
    );

    expect(html).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
  });
});

describe("a published render is untouched by any of this", () => {
  it("writes no editor marker, and strips no block-supplied attribute", async () => {
    // The removal above is an EDITOR rule. On a served page these attributes
    // are the block author's own markup and none of this system's business, so
    // the forger's string stays exactly where it put it.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/forger")}
        context={context()}
        blocks={blocks}
        classes={{}}
      />
    );

    expect(html).not.toContain(NODE_ID_ATTRIBUTE);
    expect(html).toContain("a-component-it-does-not-belong-to");
  });
});

describe("a placeholder is the one element an author can still click", () => {
  it("names the host instance when the node it stands in for was the definition's", async () => {
    // A block inside a component fails to render, so the placeholder is drawn
    // INSTEAD of it — which means it never passes through the boundary's
    // marking step. Its own id is no use either: definition nodes are re-minted
    // during composition, so the id on this box is absent from the stored page
    // and the host instance is the only thing an editor can act on. Without
    // this the error box for a broken block inside a component is inert.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist", { instanceOf: "i1" })}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    // The placeholder really was drawn, so the marker assertions below are
    // about a box that exists rather than about output that never happened.
    expect(html).toContain('data-nx-block-placeholder="unknown-block"');
    expect(html).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
  });

  it("leaves a page-owned placeholder unmarked, so it stays directly selectable", async () => {
    // The discrimination, on the error path as on the ordinary one. This node
    // is the page's own; its id addresses it, and claiming it belongs to a
    // component would redirect the author's click away from the thing they can
    // actually fix.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist")}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
    expect(html).not.toContain(INSTANCE_ATTRIBUTE);
  });

  it("writes neither marker on a published page", async () => {
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist", { instanceOf: "i1" })}
        context={context()}
        blocks={blocks}
        classes={{}}
      />
    );

    expect(html).toContain('data-nx-block-placeholder="unknown-block"');
    expect(html).not.toContain(NODE_ID_ATTRIBUTE);
    expect(html).not.toContain(INSTANCE_ATTRIBUTE);
  });

  it("carries every marker the shared builder defines, not a list of its own", async () => {
    // The property the earlier version of this test could not reach. It
    // asserted that two constants held their literal spellings — which says
    // nothing about whether the two PATHS agree. A marker added to the root
    // path and not to this one leaves both names correct and the two elements
    // carrying different editor addresses, which nothing observes.
    //
    // Driven from `editorMarkers` rather than from a list retyped here: a
    // retyped list agrees with whatever it was copied from on the day it was
    // copied, while this one grows automatically with the builder. That is what
    // makes it a check on the DERIVATION rather than on today's field set.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist", { instanceOf: "i1" })}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    // The placeholder really was drawn, so what follows is about a box that
    // exists rather than about output that never happened.
    expect(html).toContain('data-nx-block-placeholder="unknown-block"');

    const expected = editorMarkers({ nodeId: "n1", instanceOf: "i1" });
    const named = Object.entries(expected).filter(
      ([, value]) => value !== undefined
    );
    // The builder must actually define something, or "every marker is present"
    // is satisfied by there being none.
    expect(named.length).toBeGreaterThan(0);
    expect(
      named.filter(([name, value]) => !html.includes(`${name}="${value}"`))
    ).toEqual([]);
  });

  it("keeps the placeholder VISIBLE in a production build when an editor asked", async () => {
    // Markers on a hidden element address nothing. `hidden` is `display: none`,
    // so the box is not generated at all: it has no geometry for a layers panel
    // or a drag reader, `elementFromPoint` never returns it, and a click cannot
    // land on it. An editor served from a production build would therefore
    // still be unable to select the host instance from the one thing an author
    // can see when a block inside a component breaks.
    //
    // Asserted on VISIBILITY rather than on the attributes, because the
    // attributes were already correct while the element was unreachable —
    // which is exactly how the first version passed its tests and shipped the
    // defect.
    vi.stubEnv("NODE_ENV", "production");

    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist", { instanceOf: "i1" })}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    expect(html).toContain('data-nx-block-placeholder="unknown-block"');
    expect(html).not.toContain("hidden");
    expect(html).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
  });

  it("still HIDES it in production on a page nobody is editing", async () => {
    // The control, and the reason the branch exists at all: a published page
    // must not show a debug box. Without this, "always visible" passes the case
    // above while putting dashed error boxes on live pages.
    vi.stubEnv("NODE_ENV", "production");

    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/does-not-exist", { instanceOf: "i1" })}
        context={context()}
        blocks={blocks}
        classes={{}}
      />
    );

    expect(html).toContain("hidden");
  });

  it("does not READ provenance on a published render, so a hostile accessor cannot crash it", async () => {
    // `BlockBoundary` is public and takes a node, so a consumer can hand it a
    // tree assembled in memory rather than JSON from the database. The identity
    // snapshot is taken at the boundary's first line — deliberately, so no
    // plugin code can move it — but it was taken UNCONDITIONALLY, and reading
    // `instanceOf` invokes a getter.
    //
    // A published render wants no provenance at all, so the read buys nothing
    // and costs the containment this whole module exists for: the boundary came
    // down before it could draw a placeholder for the failing block.
    const hostile: Record<string, unknown> = {
      id: "n1",
      type: "test/does-not-exist",
      version: 1,
      props: {},
    };
    Object.defineProperty(hostile, "instanceOf", {
      enumerable: true,
      get() {
        throw new Error("provenance getter invoked");
      },
    });

    const html = renderToStaticMarkup(
      <BlockBoundary
        node={hostile as unknown as BlockNode}
        context={context()}
        blocks={blocks}
        classes={{}}
      />
    );

    // Contained: the boundary drew its placeholder instead of throwing.
    expect(html).toContain("data-nx-block-placeholder");
  });

  it("clears a CASE VARIANT of the marker a block wrote itself", async () => {
    // `cloneElement` merges by exact prop name, so assigning `undefined` to the
    // canonical lowercase key leaves `data-NX-instance` untouched. HTML
    // attribute lookup is ASCII case-insensitive, so an editor asking for
    // `data-nx-instance` is then handed the block's forged value — the removal
    // and the read disagreeing about what counts as the same attribute.
    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node("test/cased-forger")}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    // The BLOCK really rendered, so what follows is about a root it built. A
    // placeholder carries no forged attribute at all, which would satisfy the
    // removal assertion while proving nothing — and did, in the first version
    // of this test.
    expect(html).not.toContain("data-nx-block-placeholder");
    expect(html.toLowerCase()).not.toContain("data-nx-instance");
    expect(html).toContain(`${NODE_ID_ATTRIBUTE}="n1"`);
  });

  // The other half of the clearing — that a block's OWN namespaced attributes
  // survive it — is covered by `inline-props.test.tsx`, and covered better than
  // a fixture here could manage: `data-nx-prop` is handed to blocks through
  // `markProp`, so those tests exercise the real path rather than a stand-in.
  //
  // Named rather than assumed, because that coverage is what actually caught
  // this: a first version cleared the whole `data-nx-` namespace and took the
  // inline-edit marker with it, and those four tests went red. Deleting or
  // rewriting them would leave the clearing here unbounded with nothing to say
  // so.

  it("reads provenance ONCE, so an accessor cannot answer twice", async () => {
    // A snapshot that reads the property twice is not a snapshot. An accessor
    // answering "legit" to the type test and "forged" to the assignment defeats
    // the whole guarantee — and the emitted marker is the second answer, which
    // is the one block code had a chance to change.
    let reads = 0;
    const node: Record<string, unknown> = {
      id: "n1",
      type: "test/does-not-exist",
      version: 1,
      props: {},
    };
    Object.defineProperty(node, "instanceOf", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "legit" : "forged";
      },
    });

    const html = renderToStaticMarkup(
      <BlockBoundary
        node={node as unknown as BlockNode}
        context={context()}
        blocks={blocks}
        classes={{}}
        nodeAttribute
      />
    );

    expect(html).toContain(`${INSTANCE_ATTRIBUTE}="legit"`);
    expect(html).not.toContain("forged");
  });

  it("treats an EMPTY instance id as no provenance at all", async () => {
    // The marker's contract is that its PRESENCE means "definition-owned,
    // address the instance instead" — an editor tests for the attribute rather
    // than reading it first. So emitting it empty says a node belongs to a
    // component and then names one nothing can select, which is worse than not
    // marking it: the node also stops being directly selectable.
    //
    // Reachable because a document validator accepts any string as an id, and
    // imported or hand-edited content never passes through the editor that
    // mints them.
    const markers = editorMarkers({ nodeId: "n1", instanceOf: "" });

    expect(markers[INSTANCE_ATTRIBUTE]).toBeUndefined();
    // The node keeps its own address, which is what an unmarked node means.
    expect(markers[NODE_ID_ATTRIBUTE]).toBe("n1");
  });

  it("carries a REMOVAL for the marker a page-owned node must not claim", async () => {
    // `undefined` rather than an omitted key, and both callers depend on it:
    // React drops it on the placeholder's fresh element, and `cloneElement`
    // applies it as a removal over a root a block built — which is what clears
    // a `data-nx-instance` a block hardcoded or spread from stored attributes.
    // An implementation that omitted the key instead would satisfy the
    // placeholder and silently leave the forged value on the block root.
    const markers = editorMarkers({ nodeId: "n1" });

    expect(INSTANCE_ATTRIBUTE in markers).toBe(true);
    expect(markers[INSTANCE_ATTRIBUTE]).toBeUndefined();
  });
});
