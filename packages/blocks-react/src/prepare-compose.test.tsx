/**
 * Composition as a pass of the shared read pipeline.
 *
 * The pipeline is where five readers meet — the renderer, the style resolver,
 * the exported page reader, the style trace and the route helper — so a
 * component resolved for one of them is resolved for all five. What is pinned
 * here is what a caller cannot see for itself: that composition happens BEFORE
 * migration, that a definition is repaired against the same caps the host is,
 * that a stored stylesheet is refused once the tree it described has grown,
 * and that an instance nothing could resolve draws a marker naming the cause.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import {
  prepareDocumentReadStages,
  rendersOwnMarkup,
} from "./prepare-document";
import { preparePageForRead } from "./read-page";
import { createBlockResolver } from "./resolver";
import { resolvePageStyles } from "./styles";

const text = defineBlock<{ value: string }>({
  name: "test/text",
  version: 1,
  description: "Text.",
  example: { props: { value: "x" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

/** A block whose current schema is version 2, so a stored v1 node migrates. */
const aged = defineBlock<{ value: string }>({
  name: "test/aged",
  version: 2,
  description: "Text whose props moved at version 2.",
  example: { props: { value: "x" } },
  defaultProps: { value: "" },
  // Keyed by the version migrated FROM, not to: `migrateProps` walks
  // `for (v = from; v < to; v++)` and looks up `map[v]`.
  migrate: {
    1: props => ({ value: `migrated:${String(props.value)}` }),
  },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

const resolver = createBlockResolver([text, aged]);

const context: StyleCompileContext = {
  breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
  blockBases: { "test/text": { base: { base: { fontSize: "16px" } } } },
};

const node = (
  id: string,
  value: string,
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: "test/text",
  version: 1,
  props: { value },
  ...extra,
});

const instance = (id: string, componentId: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (nodes: unknown[]): ComponentDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes,
  }) as unknown as ComponentDocument;

const defs = (entries: Record<string, BlockDocument>) =>
  new Map(Object.entries(entries));

const stagesOf = (
  doc: BlockDocument,
  definitions?: Map<string, BlockDocument>
) => prepareDocumentReadStages(doc, { resolver, definitions });

/** Streamed rather than statically rendered, matching the renderer's own tests. */
async function renderToHtml(element: ReactElement): Promise<string> {
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

describe("the composition pass", () => {
  it("replaces an instance with its definition's tree", () => {
    const stages = stagesOf(
      page([instance("i1", "hero")]),
      defs({ hero: component([node("d1", "Hi")]) })
    );

    expect(stages!.prepared.nodes).toHaveLength(1);
    expect(stages!.prepared.nodes[0]!.props.value).toBe("Hi");
    expect(stages!.referencedComponents).toEqual(["hero"]);
    expect(stages!.unresolvedInstances).toEqual([]);
  });

  it("leaves a document holding no instance exactly as it was", () => {
    const stages = stagesOf(
      page([node("a", "Plain")]),
      defs({ hero: component([node("d1", "Hi")]) })
    );

    expect(stages!.resolved).toBe(stages!.sanitized);
    expect(stages!.referencedComponents).toEqual([]);
  });

  it("reports an instance as unresolved when no definitions were supplied", () => {
    const stages = stagesOf(page([instance("i1", "hero")]));

    expect(stages!.unresolvedInstances).toEqual([
      { instanceId: "i1", componentId: "hero", reason: "missing" },
    ]);
    expect(stages!.referencedComponents).toEqual(["hero"]);
  });
});

describe("where composition sits in the order", () => {
  it("migrates the nodes it inlined, so a definition is not read at its stored version", () => {
    // The whole point of composing BEFORE migration. A definition authored
    // against version 1 reaches a renderer holding version 2, and it has to be
    // upgraded like any other content — otherwise the renderer reads props
    // shaped for a schema it no longer speaks, which is the failure
    // `migrationFailed` exists to name.
    const stages = stagesOf(
      page([instance("i1", "hero")]),
      defs({
        hero: component([
          { id: "d1", type: "test/aged", version: 1, props: { value: "old" } },
        ]),
      })
    );

    expect(stages!.prepared.nodes[0]!.props.value).toBe("migrated:old");
    expect(stages!.prepared.nodes[0]!.version).toBe(2);
  });

  it("CONTROL: the same node stored on the page migrates identically", () => {
    // Without this the case above passes on an implementation that migrates
    // nothing and happens to carry the string through, and it proves the
    // fixture's block really does have a version-2 step to run.
    const stages = stagesOf(
      page([
        { id: "a", type: "test/aged", version: 1, props: { value: "old" } },
      ])
    );

    expect(stages!.prepared.nodes[0]!.props.value).toBe("migrated:old");
  });

  it("repairs a definition against the same caps the host is repaired against", async () => {
    // Asserted through a RENDER, because the prepared tree cannot tell the two
    // apart: an unrepaired node whose `type` is not a string has no registered
    // block either way, so it is pruned from `prepared` either way. The
    // renderer walks the deduped tree instead, and there the difference is
    // total — the placeholder writes that value into a data attribute and into
    // text, and React throws inside the component that exists to contain a
    // failure, taking the whole page with it.
    const html = await renderToHtml(
      <PageRenderer
        document={page([instance("i1", "hero")])}
        blocks={resolver}
        definitions={defs({
          hero: component([
            { id: "bad", type: {}, version: 1, props: {} },
            node("good", "Kept"),
          ]),
        })}
      />
    );

    expect(html).toContain("Kept");
  });
});

describe("composition and the limits around it", () => {
  it("lets the resolver refuse a definition past the node cap", () => {
    const stages = prepareDocumentReadStages(page([instance("i1", "hero")]), {
      resolver,
      limits: { maxDepth: 12, maxNodes: 2, maxBytes: 2_097_152 },
      definitions: defs({
        hero: component([node("a", "1"), node("b", "2"), node("c", "3")]),
      }),
    });

    // Repair must not be the thing that enforces the limit: truncating the
    // definition first publishes a component missing part of itself with
    // nothing in `unresolvedInstances` to say so.
    expect(stages!.unresolvedInstances.map(e => e.reason)).toEqual(["budget"]);
  });

  it("traces the styles of a component the page renders", async () => {
    const { pageStyleTrace } = await import("./page-style-trace");
    const traceInput = {
      document: page([instance("i1", "hero")]),
      styleContext: context,
      site: undefined,
      blocks: resolver,
    };
    const definitions = defs({ hero: component([node("d1", "Hi")]) });

    const composed = pageStyleTrace({ ...traceInput, definitions });
    const without = pageStyleTrace(traceInput);

    // The trace must describe the tree that RENDERS. Without the definitions
    // it marks the instance unresolved and drops it, so an editor's style
    // provenance describes a page that is not the one in front of the author.
    expect(composed?.nodes.map(n => n.props.value)).toEqual(["Hi"]);
    // The control: the same call is genuinely empty without them, so the
    // assertion above is about forwarding rather than about the trace working.
    expect(without?.nodes).toEqual([]);
  });
});

describe("a definitions map that is not what it claims", () => {
  it("survives a malformed entry in the definitions map", () => {
    const definitions = new Map<string, BlockDocument>([
      ["broken", null as unknown as BlockDocument],
      ["hero", component([node("d1", "Hi")])],
    ]);

    const stages = prepareDocumentReadStages(page([instance("i1", "hero")]), {
      resolver,
      definitions,
    });

    // An entry nothing on this page even references must not cost the page.
    expect(stages!.prepared.nodes[0]!.props.value).toBe("Hi");
  });

  it("reports a supplied but unreadable definition as unreadable", () => {
    const definitions = new Map<string, BlockDocument>([
      ["hero", null as unknown as BlockDocument],
      ["absent-control", component([node("d1", "x")])],
    ]);

    const stages = prepareDocumentReadStages(
      page([instance("i1", "hero"), instance("i2", "never-supplied")]),
      { resolver, definitions }
    );

    // The two are different facts with different remedies: one asks somebody
    // to publish a component, the other says the component data is corrupt.
    expect(
      stages!.unresolvedInstances.map(e => `${e.componentId}:${e.reason}`)
    ).toEqual(["hero:unreadable", "never-supplied:missing"]);
  });
});

describe("what the pipeline trusts and what it repairs", () => {
  it("does not report an empty record as a composed component", () => {
    const definitions = new Map<string, BlockDocument>([
      ["hero", {} as unknown as BlockDocument],
    ]);

    const stages = prepareDocumentReadStages(page([instance("i1", "hero")]), {
      resolver,
      definitions,
    });

    // Repair turns a missing `nodes` into `[]`, so the instance composes
    // "successfully" to nothing and the whole region disappears with no marker
    // saying anything went wrong.
    expect(stages!.unresolvedInstances).toHaveLength(1);
  });

  it("follows a reference a component makes to another component", () => {
    const definitions = new Map<string, BlockDocument>([
      ["outer", component([instance("o1", "inner")])],
      ["inner", component([node("d1", "Nested")])],
      ["unused", component([node("d2", "Never")])],
    ]);

    const stages = prepareDocumentReadStages(page([instance("i1", "outer")]), {
      resolver,
      definitions,
    });

    // Repairing only what the PAGE names would leave `inner` unrepaired and
    // therefore unreachable, so the outer component would compose to an
    // unresolved reference rather than to its content.
    expect(stages!.prepared.nodes[0]!.props.value).toBe("Nested");
    expect(stages!.unresolvedInstances).toEqual([]);
    expect(stages!.referencedComponents).toEqual(["outer", "inner"]);
  });

  it("does not trust an unresolved marker that came from storage", () => {
    const stored = page([
      {
        id: "a",
        type: "test/text",
        version: 1,
        props: { value: "Real" },
        unresolvedComponent: "missing",
      } as unknown as BlockNode,
    ]);

    const stages = prepareDocumentReadStages(stored, { resolver });

    // The marker is a render-time fact. A hand-edited, legacy or corrupt
    // document carrying the key must not replace real content with a
    // placeholder — nothing validates unknown node keys away.
    expect(stages!.prepared.nodes).toHaveLength(1);
  });

  it("repairs only the definitions the page reaches", () => {
    class CountingMap extends Map<string, BlockDocument> {
      reads = 0;
      override get(key: string): BlockDocument | undefined {
        this.reads += 1;
        return super.get(key);
      }
    }
    const catalog = new CountingMap();
    for (let i = 0; i < 50; i += 1) {
      catalog.set(`c${i}`, component([node(`n${i}`, "x")]));
    }

    prepareDocumentReadStages(page([node("a", "Plain")]), {
      resolver,
      definitions: catalog,
    });
    const untouched = catalog.reads;

    prepareDocumentReadStages(page([instance("i1", "c7")]), {
      resolver,
      definitions: catalog,
    });

    // A page referencing nothing must not pay for the catalog...
    expect(untouched).toBe(0);
    // ...and one referencing a single component pays for that one, not fifty.
    expect(catalog.reads).toBeLessThanOrEqual(3);
  });
});

describe("discovery, envelopes and one reading of a marker", () => {
  it("finds a supplied component behind more absent ones", () => {
    const definitions = new Map<string, BlockDocument>([
      ["hero", component([node("d1", "Hi")])],
    ]);
    const doc = page([
      instance("i1", "hero"),
      instance("i2", "gone1"),
      instance("i3", "gone2"),
    ]);

    const stages = prepareDocumentReadStages(doc, { resolver, definitions });

    // Absent ids must not consume the discovery budget: three references and
    // one supplied definition still has to reach that definition.
    expect(stages!.unresolvedInstances.map(e => e.componentId)).toEqual([
      "gone1",
      "gone2",
    ]);
  });

  it("refuses a definition stored in a format this build cannot read", () => {
    const definitions = new Map<string, BlockDocument>([
      [
        "hero",
        {
          formatVersion: 99,
          kind: "component",
          nodes: [node("d1", "Hi")],
        } as unknown as BlockDocument,
      ],
    ]);

    const stages = prepareDocumentReadStages(page([instance("i1", "hero")]), {
      resolver,
      definitions,
    });

    // The host is refused outright for an unknown format; a definition whose
    // nodes may not even be nodes must not be repaired and inlined instead.
    expect(stages!.unresolvedInstances).toHaveLength(1);
  });

  it("does not draw a placeholder for a stored marker on a real block", async () => {
    const stored = page([
      {
        id: "a",
        type: "test/text",
        version: 1,
        props: { value: "Real" },
        unresolvedComponent: "missing",
      } as unknown as BlockNode,
    ]);

    const html = await renderToHtml(
      <PageRenderer document={stored} blocks={resolver} />
    );

    // The pipeline keeps the node; the boundary must agree, or the renderer
    // hides content the exported reader returns.
    expect(html).toContain("Real");
  });
});

describe("an instance nothing could resolve", () => {
  // `rendersOwnMarkup` returning false for one is NOT asserted here. The
  // engine refuses to register the reserved instance name
  // (`registry.ts:RESERVED_BLOCK_NAMES`), so the unregistered-type fallthrough
  // already answers false and no fixture can separate the two. The guard is
  // kept in the source as a cheap statement of intent; a test over it would
  // pass with the guard deleted, which reads as coverage and is not.

  it("draws a marker naming composition rather than an unknown block", async () => {
    // Without the check it falls through to `unknown-block`, which is true —
    // the reserved instance type registers no block — and tells an author
    // nothing they can act on.
    const html = await renderToHtml(
      <PageRenderer
        document={page([instance("i1", "hero")])}
        blocks={createBlockResolver([text, aged])}
      />
    );

    expect(html).toContain('data-nx-block-placeholder="unresolved-component"');
    expect(html).toContain('data-nx-block-id="i1"');
  });
});

describe("a stored stylesheet after composition", () => {
  const composedPage = page([instance("i1", "hero")]);
  const plainPage = page([node("a", "Plain")]);
  const definitions = defs({ hero: component([node("d1", "Hi")]) });

  it("is refused, because it names none of the inlined nodes", () => {
    // Compiled from the page as STORED — one instance node and nothing else —
    // which is exactly the artifact a site would have persisted before the
    // component was resolvable.
    const stored = resolvePageStyles(
      composedPage,
      undefined,
      context,
      resolver
    );

    const read = preparePageForRead(composedPage, {
      resolver,
      definitions,
      styles: stored,
      styleContext: context,
    });

    expect(read.styles.css).not.toBe(stored.css);
    expect(read.styles.css).toContain("font-size: 16px");
  });

  it("CONTROL: a page with nothing to compose keeps its stored sheet", () => {
    // Without this the case above passes on an implementation that withholds
    // every stored sheet unconditionally, which is the opposite defect and
    // costs every page its styling.
    const stored = resolvePageStyles(plainPage, undefined, context, resolver);

    const read = preparePageForRead(plainPage, {
      resolver,
      definitions,
      styles: stored,
      styleContext: context,
    });

    expect(read.styles.css).toBe(stored.css);
  });

  it("carries the composed definitions out for the caller that must tag them", () => {
    const read = preparePageForRead(
      page([instance("i1", "hero"), instance("i2", "gone")]),
      { resolver, definitions }
    );

    expect(read.referencedComponents).toEqual(["hero", "gone"]);
    expect(read.unresolvedInstances.map(e => e.reason)).toEqual(["missing"]);
  });
});

/**
 * Preparing a definition and deciding to read one are ONE question.
 *
 * The pass that repairs definitions has to know which ones the render will
 * reach, and reachability is decided by the resolver — after overrides, under
 * its own composition cap, over the tree its own shape pass retained. A second
 * traversal answering that question separately answers it differently, and
 * every disagreement costs the page content it was supplied.
 */
describe("which definitions a render prepares", () => {
  /** A definition envelope with exposed properties. */
  const exposing = (nodes: unknown[], exposed: unknown[]): BlockDocument =>
    ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes,
      exposed,
    }) as unknown as BlockDocument;

  /** An instance node carrying overrides. */
  const overriding = (
    id: string,
    componentId: string,
    overrides: Record<string, unknown>
  ): BlockNode => ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId, overrides },
  });

  it("composes a nested component the instance's override selected", () => {
    const stages = stagesOf(
      page([overriding("i1", "outer", { which: "chosen" })]),
      defs({
        outer: exposing(
          [instance("n1", "default")],
          [{ id: "which", nodeId: "n1", propPath: "componentId" }]
        ),
        default: component([node("d1", "Default")]),
        chosen: component([node("d2", "Chosen")]),
      })
    );

    expect(stages!.unresolvedInstances).toEqual([]);
    expect(stages!.prepared.nodes.map(n => n.props.value)).toEqual(["Chosen"]);
  });

  it("composes a nested instance the definition's shape pass retained", () => {
    // The host's cap admits four nodes. The definition stores four entries
    // nothing can read and then an instance: a scan of the STORED nodes
    // spends its budget on the four and never reaches the fifth, while the
    // shape pass drops all four and hands the resolver the instance.
    const limits = { maxDepth: 12, maxNodes: 4, maxBytes: 2_097_152 };
    const stages = prepareDocumentReadStages(page([instance("i1", "outer")]), {
      resolver,
      limits,
      definitions: defs({
        outer: component([null, null, null, null, instance("n1", "inner")]),
        inner: component([node("d1", "Inner")]),
      }),
    });

    expect(stages!.unresolvedInstances).toEqual([]);
    expect(stages!.prepared.nodes.map(n => n.props.value)).toEqual(["Inner"]);
  });

  it("reads no definition deeper than the composition cap can compose", () => {
    // A chain of ten. The resolver refuses past `MAX_COMPOSED_DEPTH`, so the
    // definitions below that line cannot change one pixel of this page — and
    // repairing them is per-render work an author can grow without bound by
    // publishing a longer chain.
    class Counting extends Map<string, BlockDocument> {
      readonly reads: string[] = [];
      override get(id: string): BlockDocument | undefined {
        this.reads.push(id);
        return super.get(id);
      }
    }
    const chain = new Counting();
    for (let i = 0; i < 10; i += 1) {
      chain.set(
        `c${String(i)}`,
        i === 9
          ? component([node("leaf", "End")])
          : component([instance(`n${String(i)}`, `c${String(i + 1)}`)])
      );
    }

    const stages = stagesOf(page([instance("i1", "c0")]), chain);

    expect(stages!.unresolvedInstances.map(e => e.reason)).toEqual([
      "composed-depth",
    ]);
    expect(chain.reads).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });
});

describe("what an unresolved instance tells whoever is debugging it", () => {
  it("names the DEFINITION as the fault when the instance is sound", () => {
    // Both faults are document faults no author action fixes, but they are
    // faults in two different documents: one sends whoever is debugging to
    // this page, the other to the component it correctly names.
    const stages = stagesOf(
      page([
        instance("i1", "hero"),
        { id: "i2", type: COMPONENT_INSTANCE_TYPE, version: 1, props: {} },
      ]),
      defs({ hero: page([node("d1", "A page, not a component")]) })
    );

    expect(stages!.unresolvedInstances).toEqual([
      { instanceId: "i1", componentId: "hero", reason: "unreadable" },
      { instanceId: "i2", componentId: "", reason: "malformed" },
    ]);
  });
});
