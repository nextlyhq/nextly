/**
 * Detaching a component instance: inlining what it drew, and letting it go.
 *
 * The two halves are asserted apart throughout, because they are governed by
 * different rules and conflating them is the defect this planner is shaped to
 * avoid. The DEFINITION's contribution is a copy — fresh node ids, authored DOM
 * ids kept unless the page collides. The author's SUPPLIED SLOT CONTENT moves —
 * same node ids, same DOM ids, and a component instance inside it stays an
 * instance.
 */
import { describe, expect, it } from "vitest";

import { planDetach } from "./composition-planners";
import type { DefinitionsById } from "./resolve-instances";
import { applyOps } from "./ops";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, ComponentDocument } from "./document";
import { mintDomId, walkNodes } from "./tree";

const node = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  ...extra,
});

const box = (id: string, children: BlockNode[]): BlockNode =>
  node(id, { type: "core/box", slots: { children } });

const instance = (
  id: string,
  componentId: string,
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
  ...extra,
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (
  nodes: BlockNode[],
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  ...envelope,
});

const defs = (entries: Record<string, BlockDocument>): DefinitionsById =>
  new Map(Object.entries(entries));

const anyParent = { parentsOf: () => undefined };

/**
 * The prefix the resolver puts on every node id it composes.
 *
 * Spelled here rather than imported because it is deliberately not published:
 * the point of the assertion is that nothing wearing it reaches storage, and a
 * test that imported the constant would still pass if the resolver stopped
 * using it and started leaking something else.
 */
const SCOPED_MARKER = "cx-";

/** The document a plan produces, as the op layer would build it. */
function applied(doc: BlockDocument, plan: ReturnType<typeof planDetach>) {
  if (plan.pageOps === undefined) {
    throw new Error(`refused: ${String(plan.problem)}`);
  }
  return applyOps(doc, plan.pageOps).document;
}

function flatten(nodes: readonly BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  walkNodes([...nodes], n => {
    out.push(n);
  });
  return out;
}

const marked = (nodes: readonly BlockNode[], mark: string): BlockNode => {
  const found = flatten(nodes).find(n => n.props?.mark === mark);
  if (found === undefined) throw new Error(`no node marked ${mark}`);
  return found;
};

describe("what detach puts on the page", () => {
  const definitions = defs({
    card: component([
      node("d1", { props: { mark: "body" }, cssId: "card-anchor" }),
    ]),
  });

  it("replaces the instance with what it was drawing", () => {
    const doc = page([node("before"), instance("i1", "card"), node("after")]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    // In place: the run reads before → the inlined body → after.
    expect(result.nodes.map(n => n.props?.mark ?? n.id)).toEqual([
      "before",
      "body",
      "after",
    ]);
    // And the instance is gone, so nothing still points at the definition.
    expect(flatten(result.nodes).map(n => n.type)).not.toContain(
      COMPONENT_INSTANCE_TYPE
    );
  });

  it("records the component it came from, and no digest", () => {
    // The `component` arm of the existing provenance record, not a field of its
    // own: a detached subtree declines further change, so it has nothing a
    // digest would answer — which is what that arm's docblock says it is for.
    const doc = page([instance("i1", "card")]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const origin = result.nodes[0]?.origin;

    expect(origin).toEqual({ from: "component", id: "card" });
  });

  it("gives the definition's nodes fresh ids", () => {
    // They are a COPY. Keeping the definition's own ids would put the same id
    // on the page twice the moment a second instance of it is detached.
    const doc = page([instance("i1", "card"), instance("i2", "card")]);

    const once = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const twice = applied(once, planDetach(once, "i2", definitions, anyParent));
    const ids = flatten(twice.nodes).map(n => n.id);

    expect(ids).not.toContain("d1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the definition's authored DOM id when the page has none", () => {
    // The resolver mints a scoped `cx-` id per composed node for rendering.
    // Persisting that would put a render-time digest into the database and grow
    // a suffix on every cycle — the defect `planInsertPattern` was fixed for.
    const doc = page([instance("i1", "card")]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(marked(result.nodes, "body").cssId).toBe("card-anchor");
  });

  it("renames it only when the page really holds that id", () => {
    const doc = page([
      node("held", { cssId: "card-anchor" }),
      instance("i1", "card"),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const body = marked(result.nodes, "body");

    // Exactly what the engine's own rule mints from the AUTHORED id and this
    // node's OWN id. Asserting only "different, but contains card-anchor" is
    // equally satisfied by persisting the resolver's scoped form, which is
    // derived from an id this node no longer has — the thing to avoid.
    expect(body.cssId).toBe(mintDomId("card-anchor", body.id));
  });

  it("persists none of the resolver's render-time ids", () => {
    // The invariant behind the two tests above, stated once over the whole
    // output. Composed node ids wear a `cx-` prefix precisely so a reader can
    // tell them from stored ones, and a scoped DOM id carries the same marker.
    // Either one in the database is a render artefact an author now owns.
    const doc = page([
      node("held", { cssId: "card-anchor" }),
      instance("i1", "card"),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    for (const one of flatten(result.nodes)) {
      expect(one.id.startsWith(SCOPED_MARKER)).toBe(false);
    }
  });

  it("strips the resolver's own render-time fields", () => {
    // `instanceOf` and `unresolvedComponent` are facts about a render, and
    // `BlockNode`'s key set is the stored format.
    const doc = page([instance("i1", "card")]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    for (const one of flatten(result.nodes)) {
      const stored = one as BlockNode & Record<string, unknown>;
      expect(stored.instanceOf).toBeUndefined();
      expect(stored.unresolvedComponent).toBeUndefined();
    }
  });
});

describe("the author's own slot content moves through untouched", () => {
  const definitions = defs({
    shell: component([box("s1", [node("default-body")])], {
      slots: { body: { label: "Body", nodeId: "s1", slot: "children" } },
    }),
    leafy: component([node("l1", { props: { mark: "leaf" } })]),
  });

  it("KEEPS a nested component instance linked", () => {
    // The rule the design states, and the one the resolver's depth cap does not
    // deliver on its own: `maxComposedDepth` bounds DEFINITION-internal
    // nesting, while supplied slot content composes in the host's scope where
    // the depth never advances. Measured before this planner existed: a nested
    // instance at depth 1 was fully inlined, losing its link.
    //
    // A component the author dropped into this instance is THEIR content.
    // Detaching its host says nothing about it.
    const doc = page([
      instance("i1", "shell", { slots: { body: [instance("i2", "leafy")] } }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const nested = flatten(result.nodes).filter(
      n => n.type === COMPONENT_INSTANCE_TYPE
    );

    expect(nested).toHaveLength(1);
    expect(nested[0]?.id).toBe("i2");
    expect(nested[0]?.props?.componentId).toBe("leafy");
    // Still an instance, so it never drew the definition's content.
    expect(flatten(result.nodes).find(n => n.props?.mark === "leaf")).toBe(
      undefined
    );
  });

  it("keeps the author's node ids and DOM ids", () => {
    // It MOVES rather than being copied: the instance holding it is removed in
    // the same group, so its ids are free, and re-minting them would rename an
    // author's anchor for a collision that does not exist.
    const doc = page([
      instance("i1", "shell", {
        slots: {
          body: [
            node("mine", { cssId: "author-anchor", props: { mark: "a" } }),
          ],
        },
      }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const mine = marked(result.nodes, "a");

    expect(mine.id).toBe("mine");
    expect(mine.cssId).toBe("author-anchor");
  });

  it("lands it where the definition exposes the slot", () => {
    const doc = page([
      instance("i1", "shell", {
        slots: { body: [node("mine", { props: { mark: "a" } })] },
      }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    // Inside the definition's own box, replacing its default content.
    const root = result.nodes[0];
    expect(root?.type).toBe("core/box");
    expect(root?.slots?.children?.map(n => n.id)).toEqual(["mine"]);
  });

  it("shows the definition's default when the author supplied nothing", () => {
    // The control for the test above: an empty slot is how an author asks for
    // the default, so a placeholder there would suppress it.
    const doc = page([instance("i1", "shell", { slots: { body: [] } })]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(result.nodes[0]?.slots?.children).toHaveLength(1);
    expect(result.nodes[0]?.slots?.children?.[0]?.id).not.toBe("default-body");
  });
});

describe("what detach refuses", () => {
  const definitions = defs({ card: component([node("d1")]) });

  it("refuses a node that is not a component instance", () => {
    const doc = page([node("plain")]);

    expect(planDetach(doc, "plain", definitions, anyParent).problem).toBe(
      "not-a-component"
    );
  });

  it("refuses an id the document does not hold", () => {
    const doc = page([instance("i1", "card")]);

    expect(planDetach(doc, "nope", definitions, anyParent).problem).toBe(
      "unknown"
    );
  });

  it("refuses an instance whose definition is missing", () => {
    // Inlining nothing would silently delete the author's section.
    const doc = page([instance("i1", "gone")]);

    expect(planDetach(doc, "i1", definitions, anyParent).problem).toBe(
      "not-a-component"
    );
  });

  it("refuses an instance naming no component at all", () => {
    const doc = page([
      { id: "i1", type: COMPONENT_INSTANCE_TYPE, version: 1, props: {} },
    ]);

    expect(planDetach(doc, "i1", definitions, anyParent).problem).toBe(
      "invalid-source"
    );
  });

  it("refuses when the page is at its byte ceiling", () => {
    const doc = page([instance("i1", "card")]);
    const limits = {
      maxNodes: 100,
      maxDepth: 10,
      maxBytes: JSON.stringify(doc).length,
    };

    expect(planDetach(doc, "i1", definitions, anyParent, limits).problem).toBe(
      "exceeds-limits"
    );
  });
});
