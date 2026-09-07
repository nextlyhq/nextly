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

describe("a condition-gated instance", () => {
  const gate = {
    conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
  } as BlockNode["visibility"];
  const definitions = defs({
    card: component([node("d1", { props: { mark: "body" } })]),
    gatedInside: component([
      node("g1", {
        props: { mark: "body" },
        visibility: {
          conditions: [[{ field: "locale", op: "eq", value: "fr" }]],
        },
      }),
    ]),
  });

  it("really detaches it, carrying the gate onto what replaces it", () => {
    // The resolver declines to inline a gated instance — replacing it with
    // roots that inherit no gate would show a reader content withheld from
    // them — and it says so by returning the instance UNTOUCHED, with no
    // `unresolved` entry. A planner reading only that list saw a clean
    // resolution and planned to replace the instance with itself: success
    // reported, still linked to the definition, and stamped with a provenance
    // record claiming it had been detached.
    //
    // Gating is inherited, so the gate on each root gates everything beneath
    // it and the page renders exactly as before.
    const doc = page([instance("i1", "card", { visibility: gate })]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(flatten(result.nodes).map(n => n.type)).not.toContain(
      COMPONENT_INSTANCE_TYPE
    );
    expect(result.nodes[0]?.visibility).toEqual(gate);
    expect(marked(result.nodes, "body").props?.mark).toBe("body");
  });

  it("refuses when the content carries a gate of its own", () => {
    // Two condition sets combine as a cross product of their groups, and
    // quietly rewriting an author's visibility rules is not a detach's to make.
    const doc = page([instance("i1", "gatedInside", { visibility: gate })]);

    expect(planDetach(doc, "i1", definitions, anyParent).problem).toBe(
      "condition-gated"
    );
  });

  it("leaves ungated content alone", () => {
    // The control: without a gate on the instance, nothing is stamped.
    const doc = page([instance("i1", "card")]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(result.nodes[0]?.visibility).toBeUndefined();
  });
});

describe("what the op group has to survive", () => {
  it("unlocks a locked block for the insert and locks it again after", () => {
    // `applyOp` refuses an insert whose subtree arrives locked: the inverse of
    // an insert is a remove, and a remove refuses a locked subtree, so such an
    // insert could never be undone. Building the ops by hand refused every
    // definition holding a locked block, reported as a byte-cap failure.
    const definitions = defs({
      card: component([node("d1", { locked: true, props: { mark: "body" } })]),
    });
    const doc = page([instance("i1", "card")]);

    const plan = planDetach(doc, "i1", definitions, anyParent);
    const result = applied(doc, plan);

    // It arrives unlocked and is locked where it landed.
    expect(plan.pageOps?.some(op => op.kind === "update")).toBe(true);
    expect(marked(result.nodes, "body").locked).toBe(true);
  });

  it("avoids a DOM id the author's own slot content will bring back", () => {
    // The supplied content is RESTORED rather than copied, so it keeps the id
    // it already has. Counting only the page outside the instance let the
    // definition's id land on top of the author's — legal on the page today,
    // because the definition's is rendered scoped — and the group was refused
    // with a cause about size.
    const definitions = defs({
      shell: component(
        [
          node("s1", {
            type: "core/box",
            cssId: "shared",
            slots: { children: [] },
          }),
        ],
        { slots: { body: { label: "Body", nodeId: "s1", slot: "children" } } }
      ),
    });
    const doc = page([
      instance("i1", "shell", {
        slots: { body: [node("mine", { cssId: "shared" })] },
      }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));
    const root = result.nodes[0];

    // The author keeps theirs; the definition's copy moves aside.
    expect(root?.slots?.children?.[0]?.cssId).toBe("shared");
    expect(root?.cssId).toBe(mintDomId("shared", root!.id));
  });
});

describe("responsive visibility is not a gate", () => {
  it("detaches, and keeps the resolver's device merge", () => {
    // `devices` shares the visibility envelope with `conditions` but is
    // explicitly NOT a gate — per-breakpoint hiding is CSS on a node that is
    // always served — and the resolver already carries it onto the roots under
    // a rule of its own about which direction may propagate. Lifting the WHOLE
    // envelope for the resolution threw that merge away and then refused every
    // responsive instance whose definition styled its own breakpoints.
    const definitions = defs({
      card: component([
        node("d1", {
          props: { mark: "body" },
          visibility: { devices: { desktop: true } },
        }),
      ]),
    });
    const doc = page([
      instance("i1", "card", { visibility: { devices: { mobile: false } } }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(result.nodes[0]?.visibility).toEqual({
      devices: { desktop: true, mobile: false },
    });
  });
});

describe("what the copy must not do to ids", () => {
  it("keeps an authored id when only DISCARDED content would collide", () => {
    // Content for a slot the definition does not expose is dropped by the
    // resolver and never reaches the page. Counting its ids as taken renamed a
    // definition's authored anchor to avoid something that will not be there,
    // breaking a fragment link or a selector for no collision at all.
    const definitions = defs({
      card: component([
        node("d1", { cssId: "anchor", props: { mark: "body" } }),
      ]),
    });
    const doc = page([
      instance("i1", "card", {
        slots: { body: [node("orphan", { cssId: "anchor" })] },
      }),
    ]);

    const result = applied(doc, planDetach(doc, "i1", definitions, anyParent));

    expect(marked(result.nodes, "body").cssId).toBe("anchor");
  });

  it("refuses a definition that renders one id on two nodes", () => {
    // Resolution scopes both to one runtime id; putting the authored one back
    // gives the page a duplicate. `applyOps` does not police DOM-id uniqueness
    // and strict validation — the gate this predicts — refuses it, so the plan
    // would succeed into a page that can never be published.
    const definitions = defs({
      card: component([
        node("d1", { cssId: "same" }),
        node("d2", { cssId: "same" }),
      ]),
    });
    const doc = page([instance("i1", "card")]);

    expect(planDetach(doc, "i1", definitions, anyParent).problem).toBe(
      "duplicate-dom-id"
    );
  });
});

describe("a slot name the format allows and JavaScript does not", () => {
  const exposing = (key: string): DefinitionsById => {
    const envelope: Record<string, unknown> = {};
    Object.defineProperty(envelope, key, {
      value: { label: "B", nodeId: "s1", slot: "children" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return defs({
      card: component([box("s1", [])], {
        slots: envelope as ComponentDocument["slots"],
      }),
    });
  };

  const supplying = (key: string): BlockDocument => {
    const supplied: Record<string, BlockNode[]> = {};
    Object.defineProperty(supplied, key, {
      value: [node("mine", { props: { mark: "m" } })],
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return page([instance("i1", "card", { slots: supplied })]);
  };

  it("restores content from an ordinary slot", () => {
    // The control. Without it the assertion below passes for a planner that
    // restores nothing at all.
    const doc = supplying("body");

    const result = applied(
      doc,
      planDetach(doc, "i1", exposing("body"), anyParent)
    );

    expect(marked(result.nodes, "m").id).toBe("mine");
  });

  it("refuses a `__proto__` slot rather than dropping it silently", () => {
    // Locks the OUTCOME, and it does not discriminate: such a document is
    // refused upstream today whichever way the slots were written, so this
    // passes with or without the fix beside it. Kept because the failure it
    // guards against is a silent one — a future change that let this document
    // through would produce a plan reporting success with the author's content
    // quietly gone, and nothing else here would notice.
    //
    // The write itself goes through `defineEntry` regardless: `slots[name] = …`
    // with this name sets the object's PROTOTYPE instead of creating the key,
    // so the placeholder is never written and the resolver places nothing.
    // `validate` calls such a document `document-lossy` and the pattern paths
    // call it `invalid-node`.
    const doc = supplying("__proto__");

    expect(
      planDetach(doc, "i1", exposing("__proto__"), anyParent).problem
    ).toBe("unusable-document");
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

  it("refuses a definition whose fields compute themselves", () => {
    // The resolver reads a supplied definition's `kind` to tell a component
    // from a page, and an accessor there threw straight out of this planner,
    // which promises a refusal. Contained where the read happens, so every
    // caller of the resolver gets the classification rather than the error.
    const definition: Record<string, unknown> = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      nodes: [node("d1")],
    };
    Object.defineProperty(definition, "kind", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });
    const doc = page([instance("i1", "card")]);

    let escaped: unknown;
    let problem: string | undefined;
    try {
      problem = planDetach(
        doc,
        "i1",
        defs({ card: definition as unknown as BlockDocument }),
        anyParent
      ).problem;
    } catch (error) {
      escaped = error;
    }

    expect(escaped).toBeUndefined();
    expect(problem).toBe("not-a-component");
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
