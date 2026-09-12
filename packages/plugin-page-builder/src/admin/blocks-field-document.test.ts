/**
 * The boundary between what storage holds and what the canvas may walk.
 *
 * Asserted here rather than through a rendered editor because the failure this
 * guards is a throw inside the render: the canvas reads `nodes`, and a value
 * without one takes the whole editor down at the moment an author opens it,
 * leaving them no way to repair the field.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { SavedComponent, SavedPattern } from "@nextlyhq/builder";
import { describe, expect, it } from "vitest";

import {
  canEditBlocks,
  documentFrom,
  withoutSelf,
  withoutSelfPatterns,
  type ComponentGraph,
} from "./BlocksField";

describe("documentFrom", () => {
  it("keeps a document that already has nodes", () => {
    const stored = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [{ id: "a", type: "core/heading" }],
    };
    // Returned as-is rather than rebuilt: copying would drop any field this
    // function does not know about, which is every field added after it.
    expect(documentFrom(stored)).toBe(stored);
  });

  it("replaces a value that is absent", () => {
    expect(documentFrom(undefined).nodes).toEqual([]);
    expect(documentFrom(null).nodes).toEqual([]);
  });

  it("replaces a value that is not an object", () => {
    // A field storing JSON as TEXT hands back a string. Walking it would find
    // no `nodes` and throw, so it is treated as absent.
    expect(documentFrom('{"nodes":[]}').nodes).toEqual([]);
    expect(documentFrom(42).nodes).toEqual([]);
  });

  it("replaces the previous document shape, which had no nodes array", () => {
    // The retired `{version, root}` form. An object, so an object check alone
    // would pass it through to a canvas that reads `nodes` and finds nothing.
    expect(documentFrom({ version: 1, root: { id: "r" } }).nodes).toEqual([]);
  });

  it("replaces an object whose nodes is present but not an array", () => {
    expect(documentFrom({ nodes: {} }).nodes).toEqual([]);
    expect(documentFrom({ nodes: null }).nodes).toEqual([]);
  });

  it("gives every replacement a document the validator accepts", () => {
    // Seeded from `emptyBlockDocument` rather than written here, so the shape
    // cannot drift from the one the field stores and the validator expects.
    const fresh = documentFrom(null);
    expect(fresh.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
    expect(typeof fresh.kind).toBe("string");
  });
});

describe("canEditBlocks", () => {
  /*
   * The rule that decides whether a way INTO the editor is offered at all.
   *
   * Not cosmetic. Before this, `readOnly` arrived from the admin's shared
   * `commonProps` and was dropped on the floor — so a version-history view,
   * which renders the whole document read-only, still showed an enabled "Edit
   * blocks" button. Opening it mounted a full-screen editor bound to whichever
   * form was nearest, which there is the SNAPSHOT'S: committing wrote into a
   * past version of the document. `ReadOnlyDocumentForm`'s own docblock
   * states that as impossible.
   */
  it("allows editing when neither flag is set", () => {
    // The control. Without it, "always false" would satisfy every case below
    // and no author could ever open the editor.
    expect(canEditBlocks({})).toBe(true);
    expect(canEditBlocks({ readOnly: false, disabled: false })).toBe(true);
  });

  it("refuses when the document is being READ", () => {
    expect(canEditBlocks({ readOnly: true })).toBe(false);
  });

  it("refuses when the field is DISABLED", () => {
    // Independently of `readOnly`: the admin sets the two for different
    // reasons, and honouring one of them is being wrong half the time.
    expect(canEditBlocks({ disabled: true })).toBe(false);
  });

  it("refuses when both are set", () => {
    expect(canEditBlocks({ readOnly: true, disabled: true })).toBe(false);
  });
});

/**
 * The fixture builders both `withoutSelf` suites read from.
 *
 * At module scope because the two suites ask one question of one graph — which
 * components a candidate reaches — and a second copy of the builders is a
 * second definition of what a component, an instance and the walk's inputs ARE.
 * Only the row shapes stay per suite: one offers components, the other patterns.
 */
const instanceOf = (componentId: string, id: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});
const componentOf = (nodes: BlockNode[]): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
});
const text = (id: string): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
});
/** What the walk reads: the canvas's lookup, the site's caps, and whether the library read was whole. */
const graphOf = (
  definitions: ComponentLookup,
  limits: DocumentLimits = DEFAULT_LIMITS,
  whole = true
): ComponentGraph => ({ definitions, limits, whole });
/** A component document being edited, and the form naming its row. */
const editing: BlockDocument = componentOf([text("own")]);
const identity = { documentId: "a" };

describe("withoutSelf", () => {
  const row = (id: string, document: ComponentDocument): SavedComponent => ({
    id,
    title: id,
    document,
  });

  it("leaves out the row being edited and every row that reaches it, at any depth", () => {
    const a = row("a", componentOf([text("t")]));
    const b = row("b", componentOf([instanceOf("a", "b-a")]));
    const c = row("c", componentOf([text("c1"), instanceOf("b", "c-b")]));
    const d = row("d", componentOf([instanceOf("footer", "d-f")]));
    const footer = row("footer", componentOf([text("f")]));
    const library = [a, b, c, d, footer];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(
        library,
        editing,
        identity,
        graphOf(lookup, DEFAULT_LIMITS)
      ).map(r => r.id)
    ).toEqual(["d", "footer"]);
  });

  it("follows the graph, not a composition: a reference under a gate or past the composition cap still counts", () => {
    // What is excluded is any row whose stored graph reaches the row being
    // edited, because a loop is a loop whatever a render happens to skip:
    // a gated instance is served when its condition holds, and a chain
    // deeper than the composition cap is refused at render, not absent.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "pro" }]] };
    const a = row("a", componentOf([text("t")]));
    const gated = row(
      "gated",
      componentOf([
        { ...instanceOf("a", "g-a"), visibility: gate } as BlockNode,
      ])
    );
    const chain: SavedComponent[] = [];
    for (let level = 0; level < 8; level += 1) {
      chain.push(
        row(
          `c${String(level)}`,
          componentOf([
            instanceOf(
              level === 7 ? "a" : `c${String(level + 1)}`,
              `i${String(level)}`
            ),
          ])
        )
      );
    }
    const library = [a, gated, ...chain];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(library, editing, identity, graphOf(lookup, DEFAULT_LIMITS))
    ).toEqual([]);
  });

  it("withholds a candidate whose PLACEMENT override re-points at the row being edited", () => {
    /*
     * The edge neither document names. `c` places `b` and carries overrides
     * aimed at `b`'s exposures; `b` exposes one of its own nested instances'
     * `componentId`, so the override re-points it at `a` — the row being
     * edited. `c` scans as referencing `b`, `b` scans as referencing `z`, and
     * the loop is in neither scan, while the resolver applies the placement's
     * overrides before expanding `b` and reaches it.
     *
     * Offering the tile is the failure that matters: the author is invited to
     * make an insert the write then refuses.
     */
    const a = row("a", componentOf([text("t")]));
    const z = row("z", componentOf([text("z1")]));
    const b = row("b", {
      ...componentOf([instanceOf("z", "b-z")]),
      exposed: [
        {
          id: "swap",
          label: "Which",
          nodeId: "b-z",
          propPath: "componentId",
          type: "select",
        },
      ],
    } as ComponentDocument);
    const c = row("c", {
      ...componentOf([
        {
          id: "c-b",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "b", overrides: { swap: "a" } },
        },
      ]),
    } as ComponentDocument);

    const library = [a, b, c, z];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    // `c` is withheld; `b` and `z`, which reach nothing back, are still offered.
    expect(
      withoutSelf(library, editing, identity, graphOf(lookup)).map(r => r.id)
    ).toEqual(["b", "z"]);
  });

  it("CONTROL: the same placement with a harmless override is still offered", () => {
    // It is the override's TARGET that decides, not the presence of overrides.
    // Without this, withholding every candidate that carries any override would
    // satisfy the case above and empty the panel for any site using variants.
    const a = row("a", componentOf([text("t")]));
    const z = row("z", componentOf([text("z1")]));
    const b = row("b", {
      ...componentOf([instanceOf("z", "b-z")]),
      exposed: [
        {
          id: "swap",
          label: "Which",
          nodeId: "b-z",
          propPath: "componentId",
          type: "select",
        },
      ],
    } as ComponentDocument);
    const c = row("c", {
      ...componentOf([
        {
          id: "c-b",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "b", overrides: { swap: "z" } },
        },
      ]),
    } as ComponentDocument);

    const library = [a, b, c, z];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(library, editing, identity, graphOf(lookup)).map(r => r.id)
    ).toEqual(["b", "c", "z"]);
  });

  it("ends a loop among other rows where it began, and follows nothing from a row the lookup does not hold", () => {
    // Each definition is read once per question, which is what makes a loop
    // finite: x names y, y names x, and the second visit to either is the
    // end of the walk rather than another round of it.
    const a = row("a", componentOf([text("t")]));
    const x = row("x", componentOf([instanceOf("y", "x-y")]));
    const y = row("y", componentOf([instanceOf("x", "y-x")]));
    const stranger = row("s", componentOf([instanceOf("nobody", "s-n")]));
    const library = [a, x, y, stranger];
    const base = new Map(library.map(r => [r.id, r.document!]));
    let reads = 0;
    const lookup = {
      has: (id: string) => base.has(id),
      get: (id: string) => {
        reads += 1;
        return base.get(id);
      },
    };

    expect(
      withoutSelf(
        library,
        editing,
        identity,
        graphOf(lookup, DEFAULT_LIMITS)
      ).map(r => r.id)
    ).toEqual(["x", "y", "s"]);
    // Each question reads the candidate's own definition through the lookup,
    // then what it names, once each: x reads x then y; y reads y then x; s
    // reads s then nobody.
    expect(reads).toBe(6);
  });

  it("leaves out a candidate whose graph could not be read whole under the site's cap, whether or not the readable prefix names the row", () => {
    /*
     * The walk over a definition is bounded by the site's node cap, and a
     * bound that ends it early leaves a PREFIX. A reference past the cap is
     * then invisible, so "names nothing" is what an unread definition looks
     * like too — and a candidate cleared on that answer can close a loop
     * through the part nobody read. So an incomplete read is not "no": the
     * candidate is left out. It costs no legitimate offer, because a
     * definition the cap cannot read whole is one the resolver cannot inline
     * under that cap either.
     */
    const limits = { ...DEFAULT_LIMITS, maxNodes: 3 };
    const a = row("a", componentOf([text("t")]));
    // Four entries before the reference: the cap reads three and stops.
    const late = row(
      "late",
      componentOf([
        text("l1"),
        text("l2"),
        text("l3"),
        text("l4"),
        instanceOf("a", "late-a"),
      ])
    );
    // Over the cap and naming nothing at all — the case a prefix would clear.
    const wide = row(
      "wide",
      componentOf([text("w1"), text("w2"), text("w3"), text("w4")])
    );
    // Under the cap and naming nothing: the control, kept.
    const small = row("small", componentOf([text("s1")]));
    const library = [a, late, wide, small];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(library, editing, identity, graphOf(lookup, limits)).map(
        r => r.id
      )
    ).toEqual(["small"]);
    // The SITE's cap, not the engine's default: under the default all three
    // are read whole, and only the one that names the row goes.
    expect(
      withoutSelf(
        library,
        editing,
        identity,
        graphOf(lookup, DEFAULT_LIMITS)
      ).map(r => r.id)
    ).toEqual(["wide", "small"]);
  });

  it("leaves out a candidate whose graph reaches, through the lookup, a definition the cap cannot read whole", () => {
    // The same rule one step out: a followed definition is read under the
    // same bound, and one that cannot be read whole may name the row past it.
    const limits = { ...DEFAULT_LIMITS, maxNodes: 3 };
    const a = row("a", componentOf([text("t")]));
    const wide = row(
      "wide",
      componentOf([text("w1"), text("w2"), text("w3"), text("w4")])
    );
    const viaWide = row("via-wide", componentOf([instanceOf("wide", "v-w")]));
    const library = [a, wide, viaWide];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(library, editing, identity, graphOf(lookup, limits)).map(
        r => r.id
      )
    ).toEqual([]);
  });

  it("fails closed on a reference the lookup cannot follow when the library read was cut, and follows nothing from it when it was whole", () => {
    // A library the ceiling or a permission cut leaves out rows the store
    // holds, so an id the lookup does not hold may be one of them — and may
    // name the row being edited, closing the loop once saved. Read whole, the
    // same id is one nobody supplied: it names nothing further, and the
    // resolver draws it as missing.
    const a = row("a", componentOf([text("t")]));
    const viaOmitted = row("c", componentOf([instanceOf("b", "c-b")]));
    const plain = row("p", componentOf([text("p1")]));
    const library = [a, viaOmitted, plain];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(
        library,
        editing,
        identity,
        graphOf(lookup, DEFAULT_LIMITS, false)
      ).map(r => r.id)
    ).toEqual(["p"]);
    expect(
      withoutSelf(library, editing, identity, graphOf(lookup)).map(r => r.id)
    ).toEqual(["c", "p"]);
  });

  it("reads each definition's references once per row, never its subtree", () => {
    // The question is reachability over the stored graph, answered by a walk
    // over which components each definition names. Composing every row to ask
    // it cloned every definition a row reached, once per row.
    let descents = 0;
    const box: BlockNode = { id: "b", type: "core/box", version: 1, props: {} };
    Object.defineProperty(box, "slots", {
      enumerable: true,
      get: () => {
        descents += 1;
        return { children: [instanceOf("a", "deep-a")] };
      },
    });
    const a = row("a", componentOf([text("t")]));
    const holder = row("holder", componentOf([box]));
    const library = [a, holder];
    const lookup = new Map(library.map(r => [r.id, r.document!]));

    expect(
      withoutSelf(library, editing, identity, graphOf(lookup, DEFAULT_LIMITS))
    ).toEqual([]);
    // One walk of the holder's own forest reads its slots once; a
    // composition would clone them.
    expect(descents).toBe(1);
  });
});

describe("withoutSelfPatterns", () => {
  const patternOf = (id: string, nodes: BlockNode[]): SavedPattern => ({
    id,
    title: id,
    document: {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "pattern",
      nodes,
    },
  });

  it("leaves out a pattern that places the component being edited, and one that reaches it through another", () => {
    // Saving a placed component as a pattern keeps its instance node, so a
    // pattern is a second way to copy a component into itself.
    const lookup: ComponentLookup = new Map([
      ["a", componentOf([text("t")])],
      ["b", componentOf([instanceOf("a", "b-a")])],
      ["far", componentOf([text("f")])],
    ]);
    const patterns = [
      patternOf("direct", [instanceOf("a", "p-a")]),
      patternOf("indirect", [text("t"), instanceOf("b", "p-b")]),
      patternOf("blocks", [text("t")]),
      patternOf("unrelated", [instanceOf("far", "p-f")]),
    ];

    expect(
      withoutSelfPatterns(patterns, editing, identity, graphOf(lookup)).map(
        p => p.id
      )
    ).toEqual(["blocks", "unrelated"]);
  });

  it("leaves out a pattern whose own forest the site's cap could not read whole", () => {
    // A prefix that names nothing is what an unread pattern looks like too,
    // so it is left out rather than offered on an answer nobody has.
    const lookup: ComponentLookup = new Map([["a", componentOf([text("t")])]]);
    const long = patternOf("long", [
      text("t1"),
      text("t2"),
      text("t3"),
      instanceOf("a", "p-a"),
    ]);

    expect(
      withoutSelfPatterns(
        [long],
        editing,
        identity,
        graphOf(lookup, {
          ...DEFAULT_LIMITS,
          maxNodes: 2,
        })
      ).map(p => p.id)
    ).toEqual([]);
  });

  it("offers every pattern when the document being edited is not a component, or the form names no row", () => {
    const lookup: ComponentLookup = new Map([["a", componentOf([text("t")])]]);
    const patterns = [patternOf("direct", [instanceOf("a", "p-a")])];
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [text("own")],
    };

    expect(withoutSelfPatterns(patterns, page, identity, graphOf(lookup))).toBe(
      patterns
    );
    expect(withoutSelfPatterns(patterns, editing, null, graphOf(lookup))).toBe(
      patterns
    );
  });

  it("keeps the same list when nothing was removed, so the catalogue memo keeps its key", () => {
    const lookup: ComponentLookup = new Map([["a", componentOf([text("t")])]]);
    const patterns = [patternOf("blocks", [text("t")])];

    expect(
      withoutSelfPatterns(patterns, editing, identity, graphOf(lookup))
    ).toBe(patterns);
  });

  it("offers a pattern carrying no document at all", () => {
    // A row whose blocks field was never filled is a legal stored row; it
    // names no component, and the catalogue skips it on its own.
    const lookup: ComponentLookup = new Map([["a", componentOf([text("t")])]]);
    const empty: SavedPattern = { id: "empty", title: "Empty" };

    expect(
      withoutSelfPatterns([empty], editing, identity, graphOf(lookup))
    ).toEqual([empty]);
  });
});
