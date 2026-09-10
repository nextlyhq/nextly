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
import { describe, expect, it } from "vitest";

import {
  BlockBoundary,
  INSTANCE_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
} from "./block-boundary";
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

const blocks = createBlockResolver([
  forger,
  mutator,
  asyncMutator,
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

  it("spells those attributes the way the boundary does", async () => {
    // `placeholder.tsx` writes these two names as literals rather than
    // importing them, so that the module drawing the substitute does not
    // depend on the module that renders it. That is a duplication, and this is
    // what keeps it honest: renaming either constant fails HERE rather than
    // silently leaving placeholders marked in an old namespace no editor reads.
    expect({ INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE }).toEqual({
      INSTANCE_ATTRIBUTE: "data-nx-instance",
      NODE_ID_ATTRIBUTE: "data-nx-node",
    });
  });
});
