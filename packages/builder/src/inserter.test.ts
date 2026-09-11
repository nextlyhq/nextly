/**
 * What the inserter offers, and where a chosen entry lands.
 *
 * Driven through the real registry wherever a definition is involved, and
 * through the engine's real nesting source, rather than a hand-written stub
 * that restates what the registry would have answered. A stub reproduces the
 * resolution instead of observing it, so it keeps passing after the registry
 * changes what a definition means.
 *
 * @module inserter.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  allBlocks,
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  registryNestingSource,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";

import {
  UNCATEGORISED,
  type SlotSource,
  allowedEntries,
  blockSourceFor,
  catalogFrom,
  entryAllowedAt,
  filterEntries,
  groupByCategory,
  insertionPointFor,
  nodeForEntry,
  patternEntriesFrom,
  PATTERN_ENTRY_PREFIX,
  COMPONENT_ENTRY_PREFIX,
  componentEntriesFrom,
  compositionRefusal,
  nodeForComponentEntry,
  placementTypesOf,
  type BlockInsertEntry,
  type SavedComponent,
  type SavedPattern,
} from "./inserter";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(() => {
  clearBlocks();
});

/** Register a palette and return the catalog the panel would be handed. */
function catalog(definitions: readonly unknown[]): BlockInsertEntry[] {
  registerBlocks(definitions as never, { source: "acme" });
  return catalogFrom(allBlocks());
}

function entry(
  entries: readonly BlockInsertEntry[],
  id: string
): BlockInsertEntry {
  const found = entries.find(candidate => candidate.id === id);
  if (found === undefined) {
    throw new Error(
      `no entry ${id}; the catalog holds ${entries.map(e => e.id).join(", ")}`
    );
  }
  return found;
}

function documentOf(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function patternOf(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "pattern", nodes } as BlockDocument;
}

describe("catalogFrom", () => {
  it("offers every registered block, named by its editor label", () => {
    const entries = catalog([
      { ...base, name: "acme/zeta", editor: { label: "Zeta" } },
      { ...base, name: "acme/alpha", editor: { label: "Alpha" } },
    ]);

    // Membership, not a count: a selector that dropped one block and duplicated
    // another matches any total this could be compared against.
    expect(entries.map(e => e.id)).toEqual(["acme/alpha", "acme/zeta"]);
    expect(entry(entries, "acme/alpha").label).toBe("Alpha");
  });

  it("orders by the label an author reads, not by registration order", () => {
    // The separating property. Registration order here is the REVERSE of label
    // order, so a catalog that simply preserved input order would produce the
    // opposite list and no assertion on membership alone would notice.
    const entries = catalog([
      { ...base, name: "acme/one", editor: { label: "Zulu" } },
      { ...base, name: "acme/two", editor: { label: "Alpha" } },
    ]);

    expect(entries.map(e => e.label)).toEqual(["Alpha", "Zulu"]);
  });

  it("humanises the block name when no label is declared", () => {
    // Not the raw identity. A palette is read by whoever writes the page, and
    // an unlabelled block would otherwise present as an internal name.
    const entries = catalog([
      { ...base, name: "acme/collection-loop" },
      { ...base, name: "acme/card" },
    ]);

    expect(entry(entries, "acme/collection-loop").label).toBe(
      "Collection loop"
    );
    expect(entry(entries, "acme/card").label).toBe("Card");
    expect(entry(entries, "acme/card").category).toBe(UNCATEGORISED);
  });

  it("prefers a declared label over the humanised name", () => {
    // The separating control: both blocks would humanise identically, so only a
    // declared label distinguishes them.
    const entries = catalog([
      { ...base, name: "acme/card", editor: { label: "Fancy Card" } },
    ]);

    expect(entry(entries, "acme/card").label).toBe("Fancy Card");
  });

  it("emits one entry per variation, directly after its block", () => {
    const entries = catalog([
      {
        ...base,
        name: "acme/card",
        editor: {
          label: "Card",
          variations: [{ name: "wide", label: "Wide card" }, { name: "tall" }],
        },
      },
    ]);

    expect(entries.map(e => e.id)).toEqual([
      "acme/card",
      "acme/card#wide",
      "acme/card#tall",
    ]);
    expect(entry(entries, "acme/card#wide").label).toBe("Wide card");
    // A variation with no label is named by its own `name`. Falling back to the
    // block's label would render two rows reading "Card" with nothing to choose
    // between them.
    expect(entry(entries, "acme/card#tall").label).toBe("tall");
    expect(entry(entries, "acme/card#tall").variationName).toBe("tall");
    expect(entry(entries, "acme/card").variationName).toBeUndefined();
  });

  it("inserts the block's worked example, not its empty defaults", () => {
    // THE case an author sees. A block's defaults are deliberately blank —
    // `core/heading` defaults to `text: ""` — so inserting them renders an
    // empty element with no height and nothing to read: the block is added and
    // the page looks unchanged.
    const entries = catalog([
      {
        ...base,
        name: "acme/heading",
        defaultProps: { text: "", level: "h2" },
        example: { props: { text: "A section title" } },
      },
    ]);

    expect(entry(entries, "acme/heading").props).toEqual({
      // From the example: real content.
      text: "A section title",
      // From the defaults: the example says nothing about it, so it survives.
      level: "h2",
    });
  });

  it("overlays a variation's props onto the block's defaults", () => {
    const entries = catalog([
      {
        ...base,
        name: "acme/card",
        defaultProps: { tone: "plain", size: "md" },
        editor: { variations: [{ name: "loud", props: { tone: "shout" } }] },
      },
    ]);

    // The overlay REPLACES the named prop and leaves the rest, which is what
    // distinguishes an overlay from a replacement of the whole props object.
    expect(entry(entries, "acme/card#loud").props).toEqual({
      tone: "shout",
      size: "md",
    });
    expect(entry(entries, "acme/card").props).toEqual({
      tone: "plain",
      size: "md",
    });
  });

  it("gives an entry its own props, so the definition cannot be reached through it", () => {
    const defaults = { tone: "plain" };
    const entries = catalog([
      { ...base, name: "acme/card", defaultProps: defaults },
    ]);

    (entry(entries, "acme/card").props as Record<string, unknown>).tone =
      "mutated";

    expect(defaults.tone).toBe("plain");
  });

  it("returns nothing when nothing is registered", () => {
    // The vacuity control for every case above: they assert what a populated
    // catalog contains, and none of them would fail if `catalogFrom` returned
    // its input unread. This pins the empty case as empty rather than as
    // whatever a broken read happens to produce.
    expect(catalogFrom([])).toEqual([]);
  });
});

describe("filterEntries", () => {
  // Registered once per case rather than per call. `registerBlocks` refuses a
  // redefinition, so a helper invoked twice inside one test fails on the
  // collision rather than on anything it was asserting.
  let palette: BlockInsertEntry[];
  const entries = (): BlockInsertEntry[] => palette;

  const register = (): BlockInsertEntry[] =>
    catalog([
      {
        ...base,
        name: "acme/heading",
        description: "A title for a section.",
        editor: { label: "Heading", keywords: ["title", "h1"] },
      },
      {
        ...base,
        name: "acme/image",
        description: "A picture.",
        editor: { label: "Image" },
      },
    ]);

  beforeEach(() => {
    palette = register();
  });

  it("matches the label", () => {
    expect(filterEntries(entries(), "head").map(e => e.id)).toEqual([
      "acme/heading",
    ]);
  });

  it("matches the namespaced block name", () => {
    // Someone reading docs or an agent's output knows `acme/image`, not
    // necessarily that it is labelled "Image".
    expect(filterEntries(entries(), "acme/image").map(e => e.id)).toEqual([
      "acme/image",
    ]);
  });

  it("matches a declared keyword", () => {
    expect(filterEntries(entries(), "h1").map(e => e.id)).toEqual([
      "acme/heading",
    ]);
  });

  it("matches the description", () => {
    expect(filterEntries(entries(), "picture").map(e => e.id)).toEqual([
      "acme/image",
    ]);
  });

  it("ignores case", () => {
    expect(filterEntries(entries(), "HEADING").map(e => e.id)).toEqual([
      "acme/heading",
    ]);
  });

  it("returns everything for an empty or whitespace query", () => {
    // The panel opens with no query. A filter treating that as "match nothing"
    // would show an empty palette on open, which is the state this guards.
    expect(filterEntries(entries(), "").map(e => e.id)).toEqual([
      "acme/heading",
      "acme/image",
    ]);
    expect(filterEntries(entries(), "   ")).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    // The negative control. Without it every assertion above is satisfied by a
    // filter that returns its input unchanged.
    expect(filterEntries(entries(), "nonexistent")).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("groups under declared categories and preserves arrival order", () => {
    const entries = catalog([
      { ...base, name: "acme/b", editor: { label: "B", category: "media" } },
      { ...base, name: "acme/a", editor: { label: "A", category: "text" } },
      { ...base, name: "acme/c", editor: { label: "C", category: "media" } },
    ]);

    // Sorted by label, so arrival order is A(text), B(media), C(media) — which
    // makes "text" the first category even though "media" is alphabetically
    // first. That is the separating property between preserving arrival order
    // and sorting the headings.
    expect(groupByCategory(entries)).toEqual([
      { category: "text", entries: [entry(entries, "acme/a")] },
      {
        category: "media",
        entries: [entry(entries, "acme/b"), entry(entries, "acme/c")],
      },
    ]);
  });

  it("offers preferred categories first, in the order declared", () => {
    // The separating case. Sorted by label these arrive Accordion(interactive)
    // then Box(layout), so first-appearance puts "interactive" on top — which
    // is what the panel actually showed before this existed. A page starts as
    // structure, so "layout" belongs above it.
    const entries = catalog([
      {
        ...base,
        name: "acme/accordion",
        editor: { label: "Accordion", category: "interactive" },
      },
      {
        ...base,
        name: "acme/box",
        editor: { label: "Box", category: "layout" },
      },
    ]);

    expect(groupByCategory(entries).map(g => g.category)).toEqual([
      "interactive",
      "layout",
    ]);
    expect(
      groupByCategory(entries, ["layout", "interactive"]).map(g => g.category)
    ).toEqual(["layout", "interactive"]);
  });

  it("keeps a category the preferred list never names", () => {
    // A plugin shipping its own category must still get a heading. Dropping it
    // would make its blocks unreachable through the panel that exists to reach
    // them, and the failure is silent because a shorter list looks tidy.
    const entries = catalog([
      {
        ...base,
        name: "acme/box",
        editor: { label: "Box", category: "layout" },
      },
      {
        ...base,
        name: "acme/chart",
        editor: { label: "Chart", category: "acme-data" },
      },
    ]);

    expect(groupByCategory(entries, ["layout"]).map(g => g.category)).toEqual([
      "layout",
      "acme-data",
    ]);
  });

  it("ignores a preferred category nothing claims", () => {
    // The preferred list describes intent, not this catalogue. A heading with
    // no blocks under it would render as an empty section.
    const entries = catalog([
      {
        ...base,
        name: "acme/box",
        editor: { label: "Box", category: "layout" },
      },
    ]);

    expect(
      groupByCategory(entries, ["media", "layout"]).map(g => g.category)
    ).toEqual(["layout"]);
  });

  it("puts uncategorised blocks under one heading rather than dropping them", () => {
    const entries = catalog([{ ...base, name: "acme/loose" }]);

    expect(groupByCategory(entries)).toEqual([
      { category: UNCATEGORISED, entries: [entry(entries, "acme/loose")] },
    ]);
  });
});

describe("entryAllowedAt and allowedEntries", () => {
  function palette(): BlockInsertEntry[] {
    return catalog([
      { ...base, name: "acme/columns" },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
      { ...base, name: "acme/text" },
    ]);
  }

  it("refuses a parent-restricted block at the root, naming the rule", () => {
    const entries = palette();
    const verdict = entryAllowedAt(
      entry(entries, "acme/column"),
      { kind: "root" },
      registryNestingSource()
    );

    expect(verdict.allowed).toBe(false);
    // The REASON, not just the refusal. "Restricted at root" and "wrong parent"
    // need different sentences: one says choose another container, the other
    // says put it inside something.
    expect(verdict.reason).toBe("restricted-at-root");
    expect(verdict.permitted).toEqual(["acme/columns"]);
  });

  it("permits that block inside the container it declares", () => {
    const entries = palette();

    expect(
      entryAllowedAt(
        entry(entries, "acme/column"),
        { kind: "slot", parentType: "acme/columns", slot: "children" },
        registryNestingSource()
      ).allowed
    ).toBe(true);
  });

  it("refuses it inside a container it does not declare", () => {
    const entries = palette();
    const verdict = entryAllowedAt(
      entry(entries, "acme/column"),
      { kind: "slot", parentType: "acme/text", slot: "children" },
      registryNestingSource()
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("wrong-parent");
  });

  it("permits an unrestricted block everywhere", () => {
    // The control for the three refusals above. A rule that refused by default
    // would satisfy all of them while making the palette permanently empty.
    const entries = palette();
    const source = registryNestingSource();

    expect(
      entryAllowedAt(entry(entries, "acme/text"), { kind: "root" }, source)
        .allowed
    ).toBe(true);
    expect(
      entryAllowedAt(
        entry(entries, "acme/text"),
        { kind: "slot", parentType: "acme/columns", slot: "children" },
        source
      ).allowed
    ).toBe(true);
  });

  it("removes refused entries from the palette and keeps the rest", () => {
    const entries = palette();
    const offered = allowedEntries(
      entries,
      { kind: "root" },
      registryNestingSource()
    );

    // Both halves asserted: the refused one is gone AND the permitted ones
    // remain. Asserting only the absence passes on a filter that returns
    // nothing at all.
    expect(offered.map(e => e.id)).toEqual(["acme/columns", "acme/text"]);
  });

  it("derives a variation's placement from its block, not from its own name", () => {
    // A variation is an instance of its block, so it inherits the block's
    // nesting rule. Keying the rule on the entry id would look up
    // "acme/column#narrow", find no definition, and permit it everywhere.
    const entries = catalog([
      {
        ...base,
        name: "acme/column",
        parent: ["acme/columns"],
        editor: { variations: [{ name: "narrow" }] },
      },
    ]);

    expect(
      entryAllowedAt(
        entry(entries, "acme/column#narrow"),
        { kind: "root" },
        registryNestingSource()
      ).allowed
    ).toBe(false);
  });

  it("refuses a block a slot's allow-list does not admit", () => {
    // The CONTAINER's half. This block declares no `parent`, so the child's
    // half permits it everywhere — only the slot's allow-list can refuse it,
    // which is what makes this case separate rather than a restatement.
    registerBlocks(
      [
        {
          ...base,
          name: "acme/gallery",
          slots: { children: { allow: ["acme/photo"] } },
        },
        { ...base, name: "acme/photo" },
        { ...base, name: "acme/text" },
      ] as never,
      { source: "acme" }
    );
    const entries = catalogFrom(allBlocks());
    const source = registryNestingSource();

    const refused = entryAllowedAt(
      entry(entries, "acme/text"),
      { kind: "slot", parentType: "acme/gallery", slot: "children" },
      source
    );
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe("not-allowed-in-slot");
    expect(refused.permitted).toEqual(["acme/photo"]);

    // The control: the admitted block passes the same call. Without it a rule
    // refusing everything in a slot would satisfy the assertion above.
    expect(
      entryAllowedAt(
        entry(entries, "acme/photo"),
        { kind: "slot", parentType: "acme/gallery", slot: "children" },
        source
      ).allowed
    ).toBe(true);
  });

  it("reports the CHILD's reason when both halves would refuse", () => {
    // Both rules reject this placement. The child's reason is the actionable
    // one — it names a container to aim at — so it is the one that survives.
    registerBlocks(
      [
        {
          ...base,
          name: "acme/grid",
          slots: { cells: { allow: ["acme/cell"] } },
        },
        { ...base, name: "acme/cell", parent: ["acme/grid"] },
        { ...base, name: "acme/stray", parent: ["acme/elsewhere"] },
        { ...base, name: "acme/elsewhere" },
      ] as never,
      { source: "acme" }
    );
    const entries = catalogFrom(allBlocks());

    const verdict = entryAllowedAt(
      entry(entries, "acme/stray"),
      { kind: "slot", parentType: "acme/grid", slot: "cells" },
      registryNestingSource()
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("wrong-parent");
  });
});

/** A slot source over a fixed map, standing in for the registry. */
function slotsFor(map: Record<string, readonly string[]>): SlotSource {
  return { slotsOf: type => map[type] };
}

describe("insertionPointFor", () => {
  it("appends at the end of the document when nothing is selected", () => {
    const document = documentOf([
      { id: "a", type: "acme/text", version: 1, props: {} },
    ]);

    expect(insertionPointFor(document, null)).toEqual({
      kind: "document-end",
      at: { index: 1 },
      target: { kind: "root" },
    });
  });

  it("places a new block directly after the selected one", () => {
    const document = documentOf([
      { id: "a", type: "acme/text", version: 1, props: {} },
      { id: "b", type: "acme/text", version: 1, props: {} },
    ]);

    // Index 1, not 0 and not 2: after "a" and before "b". A position that
    // merely named the selection's own index would insert BEFORE it.
    expect(insertionPointFor(document, "a")).toEqual({
      kind: "after-selection",
      at: { index: 1 },
      target: { kind: "root" },
    });
  });

  it("stays inside the selected block's own region", () => {
    const document = documentOf([
      {
        id: "wrap",
        type: "acme/columns",
        version: 1,
        props: {},
        slots: {
          children: [{ id: "inner", type: "acme/text", version: 1, props: {} }],
        },
      },
    ]);

    const point = insertionPointFor(document, "inner");

    // The position AND the target, together. This is the property the module
    // exists for: a panel filtering against the root while inserting into a
    // slot would offer blocks the op layer then refuses.
    expect(point).toEqual({
      kind: "after-selection",
      at: { parentId: "wrap", slot: "children", index: 1 },
      target: { kind: "slot", parentType: "acme/columns", slot: "children" },
    });
  });

  it("falls back to the end when the selection names a node the document lost", () => {
    // A stale id after an undo, or a selection made against a document that has
    // since been replaced. Appending is right here because there is no
    // surrounding region to be surprised about.
    const document = documentOf([
      { id: "a", type: "acme/text", version: 1, props: {} },
    ]);

    expect(insertionPointFor(document, "gone")?.kind).toBe("document-end");
    expect(insertionPointFor(document, "gone")?.at).toEqual({ index: 1 });
  });

  it("places into an EMPTY container rather than beside it", () => {
    // THE case. Without this a container can be inserted and never filled:
    // every insert lands as a sibling, so a columns block arrives empty and
    // stays empty, and every container in the library is decorative.
    const document = documentOf([
      { id: "wrap", type: "acme/columns", version: 1, props: {} },
    ]);

    expect(
      insertionPointFor(
        document,
        "wrap",
        slotsFor({ "acme/columns": ["children"] })
      )
    ).toEqual({
      kind: "inside-selection",
      at: { parentId: "wrap", slot: "children", index: 0 },
      target: { kind: "slot", parentType: "acme/columns", slot: "children" },
    });
  });

  it("places BESIDE a container that already holds something", () => {
    // The separating case, and what keeps a sibling reachable at all. A
    // container the author has filled takes a sibling; adding a third child is
    // done by selecting the second and inserting after it.
    const document = documentOf([
      {
        id: "wrap",
        type: "acme/columns",
        version: 1,
        props: {},
        slots: {
          children: [{ id: "kid", type: "acme/text", version: 1, props: {} }],
        },
      },
    ]);

    expect(
      insertionPointFor(
        document,
        "wrap",
        slotsFor({ "acme/columns": ["children"] })
      )?.kind
    ).toBe("after-selection");
  });

  it("reads the DEFINITION's slots, not the node's", () => {
    // A container inserted from the palette carries no `slots` key at all, so a
    // rule asking the node whether it is a container answers "no" for exactly
    // the empty ones that need filling. Same node as the first case; without a
    // source it can only be a sibling.
    const document = documentOf([
      { id: "wrap", type: "acme/columns", version: 1, props: {} },
    ]);

    expect(insertionPointFor(document, "wrap")?.kind).toBe("after-selection");
  });

  it("places beside a leaf, whatever the source says", () => {
    // The control: a block declaring no slots is not a container, so the rule
    // must not claim one. Without it, a source answering for every type would
    // send every insert inside its own selection.
    const document = documentOf([
      { id: "a", type: "acme/text", version: 1, props: {} },
    ]);

    expect(
      insertionPointFor(
        document,
        "a",
        slotsFor({ "acme/columns": ["children"] })
      )?.kind
    ).toBe("after-selection");
  });

  it("is empty-document safe", () => {
    expect(insertionPointFor(documentOf([]), null)).toEqual({
      kind: "document-end",
      at: { index: 0 },
      target: { kind: "root" },
    });
  });
});

/**
 * A definition source resolving nothing, for the cases about props and ids.
 *
 * Those blocks declare no starting children, so expansion has nothing to do and
 * an empty source says exactly that. It also keeps them off the global
 * registry, which no test here registers into.
 */
const noDefaults = { get: () => undefined };

describe("nodeForEntry", () => {
  it("stamps the type and the version the entry carries", () => {
    // Version 3 with its migration steps, rather than the default 1: a stamp
    // hardcoded to 1 would pass every assertion a version-1 fixture can make.
    const entries = catalog([
      {
        ...base,
        name: "acme/text",
        version: 3,
        migrate: {
          1: (p: Record<string, unknown>) => p,
          2: (p: Record<string, unknown>) => p,
        },
      },
    ]);
    const node = nodeForEntry(entry(entries, "acme/text"), noDefaults);

    expect(node.type).toBe("acme/text");
    expect(node.version).toBe(3);
    expect(typeof node.id).toBe("string");
    expect(node.id.length).toBeGreaterThan(0);
  });

  it("inserts a variation as its block, carrying the variation's props", () => {
    // The node records what it IS — a block — not which palette row produced
    // it. A node typed "acme/card#loud" would match no registered block and
    // would render as unknown.
    const entries = catalog([
      {
        ...base,
        name: "acme/card",
        defaultProps: { tone: "plain" },
        editor: { variations: [{ name: "loud", props: { tone: "shout" } }] },
      },
    ]);

    const node = nodeForEntry(entry(entries, "acme/card#loud"), noDefaults);

    expect(node.type).toBe("acme/card");
    expect(node.props).toEqual({ tone: "shout" });
  });

  it("gives every inserted node its own props, nested values included", () => {
    // The failure this prevents is delayed and looks unrelated: editing one
    // inserted block changes another inserted long before it, because both
    // share the catalog's object. A shallow copy passes a top-level check and
    // still shares the array.
    const entries = catalog([
      {
        ...base,
        name: "acme/list",
        defaultProps: { items: ["one"], meta: { deep: true } },
      },
    ]);
    const source = entry(entries, "acme/list");

    const first = nodeForEntry(source, noDefaults);
    const second = nodeForEntry(source, noDefaults);
    (first.props.items as string[]).push("two");
    (first.props.meta as { deep: boolean }).deep = false;

    expect(second.props.items).toEqual(["one"]);
    expect(second.props.meta).toEqual({ deep: true });
    expect(source.props.items).toEqual(["one"]);
  });

  it("gives two inserts distinct ids", () => {
    const entries = catalog([{ ...base, name: "acme/text" }]);
    const source = entry(entries, "acme/text");

    expect(nodeForEntry(source, noDefaults).id).not.toBe(
      nodeForEntry(source, noDefaults).id
    );
  });

  describe("a block that declares what its slot starts with", () => {
    /**
     * A row declaring two columns, and the column it names.
     *
     * Mirrors `core/columns` without depending on it: the property under test
     * is that the inserter EXPANDS a declaration, which must hold for a plugin
     * container nobody here wrote.
     */
    const rowDefinitions = {
      get: (type: string) =>
        type === "acme/row"
          ? {
              version: 1,
              slots: {
                children: {
                  defaultBlock: [{ type: "acme/cell" }, { type: "acme/cell" }],
                },
              },
            }
          : type === "acme/cell"
            ? { version: 2 }
            : undefined,
    };

    const rowEntry = () =>
      entry(catalog([{ ...base, name: "acme/row" }]), "acme/row");

    it("arrives carrying the children the block declares", () => {
      const node = nodeForEntry(rowEntry(), rowDefinitions);

      expect(node.slots?.children?.map(child => child.type)).toEqual([
        "acme/cell",
        "acme/cell",
      ]);
      // The child's own version, not the row's.
      expect(node.slots?.children?.map(child => child.version)).toEqual([2, 2]);
    });

    it("gives the two children of ONE insert distinct ids", () => {
      const node = nodeForEntry(rowEntry(), rowDefinitions);
      const ids = (node.slots?.children ?? []).map(child => child.id);

      // Length alone passes on an implementation that expands one child and
      // repeats the reference, which is the collision this design removes.
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it("gives TWO inserted rows no id in common, parents included", () => {
      // The collision that matters is across instances, and one parent cannot
      // produce it: an implementation caching the expanded children per type
      // passes the test above and fails here. Two rows dropped on one page are
      // exactly this situation, and `duplicate-node-id` is what the document
      // validator answers if it is got wrong.
      const source = rowEntry();
      const first = nodeForEntry(source, rowDefinitions);
      const second = nodeForEntry(source, rowDefinitions);

      const everyId = [
        first.id,
        second.id,
        ...(first.slots?.children ?? []).map(child => child.id),
        ...(second.slots?.children ?? []).map(child => child.id),
      ];

      expect(everyId).toHaveLength(6);
      expect(new Set(everyId).size).toBe(6);
    });

    it("leaves a block declaring no default with no slots key at all", () => {
      // Not an empty record: the editor's empty-container check reads the
      // absence of `slots`, so a container claiming an empty slot it never
      // filled would be a different state to it.
      const plain = entry(
        catalog([{ ...base, name: "acme/text" }]),
        "acme/text"
      );

      expect(nodeForEntry(plain, rowDefinitions).slots).toBeUndefined();
    });
  });

  describe("choosing the definitions an insert expands from", () => {
    /**
     * A container and its child that are NEVER registered.
     *
     * `catalogFrom` rather than the `catalog` helper above, because that helper
     * REGISTERS what it is handed — which would erase the very condition under
     * test. The palette offers whatever a caller supplies, so these are blocks
     * an author can see and choose while the registry knows nothing about them.
     */
    const suppliedRow = {
      ...base,
      name: "acme/supplied-row",
      slots: { children: { defaultBlock: [{ type: "acme/supplied-cell" }] } },
    };
    const suppliedCell = { ...base, name: "acme/supplied-cell", version: 4 };

    /** Supplied, but naming a child only the registry holds. */
    const mixedRow = {
      ...base,
      name: "acme/mixed-row",
      slots: { children: { defaultBlock: [{ type: "acme/registered-cell" }] } },
    };
    // Version 1: registration refuses a higher version with no migration
    // chain, so the registered fixtures cannot carry a distinguishing version
    // the way the supplied ones do. The child's PRESENCE is the proof of
    // resolution anyway — an unresolvable type contributes no child at all.
    const registeredCell = { ...base, name: "acme/registered-cell" };

    it("expands a supplied definition the registry does not hold", () => {
      const source = blockSourceFor([
        suppliedRow,
        suppliedCell,
      ] as unknown as readonly AnyBlockDefinition[]);
      const node = nodeForEntry(
        entry(catalogFrom([suppliedRow] as never), "acme/supplied-row"),
        source
      );

      // The separating property is the CHILD being there. Resolving only
      // through the registry finds no declaration for a supplied block, and an
      // absent declaration is indistinguishable from a declared emptiness — so
      // the block is offered and then inserted stripped of what it declares,
      // with nothing reported.
      expect(node.slots?.children?.map(child => child.type)).toEqual([
        "acme/supplied-cell",
      ]);
      // The child's own version, which proves the CHILD resolved through the
      // supplied list too rather than the parent alone.
      expect(node.slots?.children?.[0]?.version).toBe(4);
    });

    it("falls back to the registry for a type the supplied list omits", () => {
      registerBlocks([registeredCell] as never, { source: "acme" });
      const source = blockSourceFor([
        mixedRow,
      ] as unknown as readonly AnyBlockDefinition[]);
      const node = nodeForEntry(
        entry(catalogFrom([mixedRow] as never), "acme/mixed-row"),
        source
      );

      // A declaration names child TYPES the supplied list has no reason to
      // carry. Consulting the supplied list FIRST must not stop the registry
      // answering for the rest, or the fix for the case above would break
      // every ordinary insert.
      expect(node.slots?.children?.map(child => child.type)).toEqual([
        "acme/registered-cell",
      ]);
    });

    it("expands from the snapshot it was built with, not the live registry", () => {
      // The row is registered BEFORE the source is built; the child it names is
      // registered AFTER. A source that resolved live would find the child and
      // seed it.
      registerBlocks([mixedRow] as never, { source: "acme" });
      const source = blockSourceFor(undefined);
      registerBlocks([registeredCell] as never, { source: "acme" });

      const node = nodeForEntry(
        entry(catalogFrom([mixedRow] as never), "acme/mixed-row"),
        source
      );

      // The panel documents its palette as read once per mount, and the row an
      // author sees must be the row an insert builds. A live source would let a
      // plugin registering while the panel is open change what a stale row
      // inserts — same version and props, different children.
      expect(node.slots).toBeUndefined();
    });

    it("uses the registry when no definitions are supplied", () => {
      const node = nodeForEntry(
        entry(catalog([mixedRow, registeredCell]), "acme/mixed-row"),
        blockSourceFor(undefined)
      );

      expect(node.slots?.children?.map(child => child.type)).toEqual([
        "acme/registered-cell",
      ]);
    });
  });
});

describe("the pattern tier", () => {
  /** The registry's nesting rule, which the catalogue now judges patterns by. */
  const nest = () => registryNestingSource();

  function saved(overrides: Partial<SavedPattern> = {}): SavedPattern {
    return {
      id: "hero",
      title: "Hero",
      // A PATTERN document, which is what a row in the patterns collection
      // holds: the field refuses any other kind, and the planner refuses one
      // too.
      document: patternOf([
        { id: "a", type: "acme/text", version: 1, props: {} },
      ]),
      ...overrides,
    };
  }

  it("keys a pattern out of the block namespace", () => {
    // A stored pattern may be saved under any string, a registered block name
    // included. Two entries answering to one id make the panel reuse one row's
    // state for the other, and a highlighted entry stop naming what it names.
    const blocks = catalog([{ ...base, name: "acme/text" }]);
    const [pattern] = patternEntriesFrom([saved({ id: "acme/text" })], nest());

    expect(pattern?.id).toBe(`${PATTERN_ENTRY_PREFIX}acme/text`);
    expect(blocks.some(entry => entry.id === pattern?.id)).toBe(false);
    expect(pattern?.patternId).toBe("acme/text");
  });

  it("offers no entry for a pattern with no roots", () => {
    // Inserting it would add nothing, so a row for it reads as an action and is
    // not one. The control is the same call with a root, which must produce one.
    const empty = patternEntriesFrom(
      [saved({ document: patternOf([]) })],
      nest()
    );
    const populated = patternEntriesFrom([saved()], nest());

    expect(empty).toEqual([]);
    expect(populated).toHaveLength(1);
  });

  it("treats a stored NULL keyword field as no keywords", () => {
    // Not a hypothetical shape: `keywords` is not required, Nextly writes an
    // unset non-required field as SQL NULL and reads it back with the key
    // present, so the ordinary pattern — one saved without keywords — arrives
    // as null. An undefined-only check reached `null.split` and took catalog
    // construction down with it.
    const [pattern] = patternEntriesFrom([saved({ keywords: null })], nest());

    expect(pattern?.keywords).toEqual([]);
  });

  it("offers nothing for a document that is not a pattern", () => {
    // `SavedPattern.document` is a `BlockDocument`, so a page or a component
    // row handed to this by mistake is a legal value — and the planner refuses
    // exactly that as `not-a-pattern`. A tile for one accepts a click and
    // cannot succeed.
    const only = [{ id: "a", type: "acme/text", version: 1, props: {} }];
    const offered = patternEntriesFrom(
      [
        saved({ id: "a-page", document: documentOf(only) }),
        saved({
          id: "a-component",
          document: { ...documentOf(only), kind: "component" } as BlockDocument,
        }),
      ],
      nest()
    );
    const control = patternEntriesFrom([saved()], nest());

    expect(offered).toEqual([]);
    expect(control).toHaveLength(1);
  });

  it("offers nothing for a row whose document was never filled in", () => {
    // The collection does not mark its blocks field required and the field
    // layer persists an omitted document as SQL NULL, so a published row with
    // a title, a slug and a granularity but no content is legal. Reading
    // `kind` off one took catalogue construction down.
    const absent = patternEntriesFrom(
      [
        { id: "never-filled", title: "Empty" },
        { id: "explicit-null", title: "Null", document: null },
      ],
      nest()
    );
    const control = patternEntriesFrom([saved()], nest());

    expect(absent).toEqual([]);
    expect(control).toHaveLength(1);
  });

  it("offers nothing for a pattern whose own nesting no longer holds", () => {
    // A pattern is saved once and inserted for as long as it exists, so a
    // block that later declares a `parent` restriction invalidates edges inside
    // documents nobody has touched. The planner refuses such a pattern wherever
    // it is put, so a tile for one accepts a click that cannot succeed.
    catalog([
      { ...base, name: "acme/wrap" },
      { ...base, name: "acme/col", parent: ["acme/grid"] },
    ]);
    const stranded = patternOf([
      {
        id: "w",
        type: "acme/wrap",
        version: 1,
        props: {},
        slots: {
          children: [{ id: "c", type: "acme/col", version: 1, props: {} }],
        },
      },
    ]);

    // The control is the same forest with the offending child removed: it must
    // still be offered, or this would pass on a catalogue that offers nothing.
    const intact = patternOf([
      { id: "w", type: "acme/wrap", version: 1, props: {} },
    ]);

    expect(patternEntriesFrom([saved({ document: stranded })], nest())).toEqual(
      []
    );
    expect(
      patternEntriesFrom([saved({ id: "ok", document: intact })], nest())
    ).toHaveLength(1);
  });

  it("offers nothing for a pattern the planner refuses on its shape", () => {
    // The palette used to keep its own list of what makes a stored row
    // unusable — kind, emptiness, nesting — and the planner's is longer. Two
    // nodes rendering one DOM id is one of the ways it is longer, and a tile
    // for such a row accepts a click that cannot succeed.
    catalog([{ ...base, name: "acme/text" }]);
    const twice = patternOf([
      { id: "a", type: "acme/text", version: 1, props: {}, cssId: "hero" },
      { id: "b", type: "acme/text", version: 1, props: {}, cssId: "hero" },
    ]);
    // The control is the same forest with the collision removed, so this cannot
    // pass on a catalogue that offers nothing.
    const once = patternOf([
      { id: "a", type: "acme/text", version: 1, props: {}, cssId: "hero" },
      { id: "b", type: "acme/text", version: 1, props: {} },
    ]);

    expect(patternEntriesFrom([saved({ document: twice })], nest())).toEqual(
      []
    );
    expect(
      patternEntriesFrom([saved({ id: "ok", document: once })], nest())
    ).toHaveLength(1);
  });

  it("splits the stored keyword string on every separator an author uses", () => {
    // Stored as ONE string because the field is matched rather than
    // enumerated, and the collection's own note says authors separate them
    // however they like. Empty runs between two separators produce nothing: a
    // blank term matches every query, so it would make the pattern universal.
    const [pattern] = patternEntriesFrom(
      [saved({ keywords: "landing,  banner; splash ,, " })],
      nest()
    );

    expect(pattern?.keywords).toEqual(["landing", "banner", "splash"]);
  });

  it("gives a pattern that declares neither a category nor a description one anyway", () => {
    const [pattern] = patternEntriesFrom([saved()], nest());

    expect(pattern?.category).toBe(UNCATEGORISED);
    expect(pattern?.description).toBe("");
  });

  it("refuses a pattern whose SECOND root the destination will not take", () => {
    // The root that refuses is deliberately not the first: judging a forest by
    // its head passes this pattern, the panel accepts the click, and the
    // planner then rejects the whole insert — the palette-and-drop
    // disagreement the module exists to prevent.
    catalog([
      { ...base, name: "acme/text" },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
    ]);
    const [pattern] = patternEntriesFrom(
      [
        saved({
          document: patternOf([
            { id: "a", type: "acme/text", version: 1, props: {} },
            { id: "b", type: "acme/column", version: 1, props: {} },
          ]),
        }),
      ],
      nest()
    );

    const verdict = entryAllowedAt(
      pattern as never,
      { kind: "root" },
      registryNestingSource()
    );

    expect(verdict.allowed).toBe(false);
    // The reason belongs to the root that produced it, so an author is told
    // where that block can go rather than that "something" was refused.
    expect(verdict.reason).toBe("restricted-at-root");
    expect(verdict.permitted).toEqual(["acme/columns"]);
  });

  it("allows a pattern every one of whose roots the destination takes", () => {
    catalog([{ ...base, name: "acme/text" }]);
    const [pattern] = patternEntriesFrom(
      [
        saved({
          document: patternOf([
            { id: "a", type: "acme/text", version: 1, props: {} },
            { id: "b", type: "acme/text", version: 1, props: {} },
          ]),
        }),
      ],
      nest()
    );

    expect(
      entryAllowedAt(
        pattern as never,
        { kind: "root" },
        registryNestingSource()
      ).allowed
    ).toBe(true);
  });

  it("drops a refused pattern from what a target will accept", () => {
    catalog([
      { ...base, name: "acme/text" },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
    ]);
    const patterns = patternEntriesFrom(
      [
        saved({ id: "ok" }),
        saved({
          id: "bad",
          document: patternOf([
            { id: "b", type: "acme/column", version: 1, props: {} },
          ]),
        }),
      ],
      nest()
    );

    expect(
      allowedEntries(patterns, { kind: "root" }, registryNestingSource()).map(
        offered => offered.patternId
      )
    ).toEqual(["ok"]);
  });

  it("searches a pattern by its own words and not by a block name it has none of", () => {
    const [pattern] = patternEntriesFrom(
      [
        saved({
          title: "Hero",
          description: "A big opener.",
          keywords: "splash",
        }),
      ],
      nest()
    );
    const entries = [pattern as never];

    expect(filterEntries(entries, "hero")).toHaveLength(1);
    expect(filterEntries(entries, "opener")).toHaveLength(1);
    expect(filterEntries(entries, "splash")).toHaveLength(1);
    // `acme/text` is the type of the pattern's only root. A block entry is
    // matched on its namespaced name because that is the identity an author
    // reads in documentation; a pattern has no such identity, and matching it
    // through the blocks it happens to contain would offer it for a query
    // about something it is not.
    expect(filterEntries(entries, "acme/text")).toEqual([]);
  });

  it("groups a pattern under its own category, beside the blocks", () => {
    const blocks = catalog([
      { ...base, name: "acme/text", editor: { category: "text" } },
    ]);
    const patterns = patternEntriesFrom([saved({ category: "text" })], nest());

    const groups = groupByCategory([...blocks, ...patterns]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("text");
    expect(groups[0]?.entries.map(offered => offered.id)).toEqual([
      "acme/text",
      `${PATTERN_ENTRY_PREFIX}hero`,
    ]);
  });
});

describe("the component tier", () => {
  /** A component definition, which is what a row in the components collection holds. */
  function componentOf(nodes: ComponentDocument["nodes"]): ComponentDocument {
    return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "component", nodes };
  }

  function stored(overrides: Partial<SavedComponent> = {}): SavedComponent {
    return {
      id: "header",
      title: "Header",
      document: componentOf([
        { id: "d1", type: "acme/text", version: 1, props: { text: "Site" } },
      ]),
      ...overrides,
    };
  }

  /** A host that supplies no lookup: nothing resolves. */
  const NONE: ComponentLookup = new Map();

  /** An instance node pointing at a definition, as a stored document holds one. */
  function instanceOf(componentId: string, id = `i-${componentId}`): BlockNode {
    return {
      id,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId },
    };
  }

  /** The lookup the canvas would resolve against, holding these definitions. */
  function lookupOf(...rows: SavedComponent[]): ComponentLookup {
    return new Map(
      rows.flatMap(row =>
        row.document === undefined || row.document === null
          ? []
          : [[row.id, row.document] as const]
      )
    );
  }

  it("keys a component out of the block namespace, and apart from patterns", () => {
    // A definition may be saved under any id. Its catalog key carries the
    // tier, so it can share an id with a block AND with a pattern without any
    // two entries answering to one key.
    const blocks = catalog([{ ...base, name: "acme/text" }]);
    const [component] = componentEntriesFrom(
      [stored({ id: "acme/text" })],
      NONE
    );

    expect(component?.id).toBe(`${COMPONENT_ENTRY_PREFIX}acme/text`);
    expect(component?.id).not.toBe(`${PATTERN_ENTRY_PREFIX}acme/text`);
    expect(blocks.some(entry => entry.id === component?.id)).toBe(false);
    expect(component?.componentId).toBe("acme/text");
  });

  it("offers nothing for a definition the canvas would refuse: another format, or nodes that are not a list", () => {
    // The tile and the canvas read the same rule for a supplied definition,
    // the resolver's own. Judged by kind alone, a definition in a format this
    // build does not read was offered, placed, and drawn as a placeholder;
    // one whose nodes are not a list crashed the catalogue on `.length`.
    catalog([{ ...base, name: "acme/text" }]);
    const stale = stored({
      id: "stale",
      document: {
        ...componentOf([
          { id: "d1", type: "acme/text", version: 1, props: {} },
        ]),
        formatVersion: DOCUMENT_FORMAT_VERSION + 1,
      } as unknown as ComponentDocument,
    });
    const broken = stored({
      id: "broken",
      document: {
        ...componentOf([]),
        nodes: "oops",
      } as unknown as ComponentDocument,
    });

    expect(
      componentEntriesFrom([stale, broken, stored()], NONE).map(
        e => e.componentId
      )
    ).toEqual(["header"]);
  });

  it("offers nothing for a row with no document, or one that is not a component", () => {
    // Both are legal stored rows — a published definition saved without
    // content, and a row a migration left holding a pattern — and both are
    // rows the palette has nothing to place for. A tile that accepted a click
    // and then failed would be worse than no tile.
    const entries = componentEntriesFrom(
      [
        stored({ id: "empty", document: null }),
        stored({
          id: "wrong-kind",
          // WITH roots, so that only the kind check can exclude it. Given none,
          // the empty-roots check below would drop it first and this case would
          // pass whether or not the kind was ever looked at.
          document: {
            ...componentOf([
              { id: "d1", type: "acme/text", version: 1, props: {} },
            ]),
            kind: "pattern",
          } as never,
        }),
        stored({ id: "no-roots", document: componentOf([]) }),
        stored({ id: "fine" }),
      ],
      NONE
    );

    expect(entries.map(entry => entry.componentId)).toEqual(["fine"]);
  });

  it("carries the usage count only when the library supplied one", () => {
    // A tile saying "used on 0 pages" about a count nobody took would be
    // stating a fact it does not hold.
    const [counted, uncounted] = componentEntriesFrom(
      [stored({ id: "a", usedOn: 12 }), stored({ id: "b" })],
      NONE
    );

    expect(counted?.usedOn).toBe(12);
    expect(uncounted).not.toHaveProperty("usedOn");
  });

  it("judges placement by the definition's ROOTS, not by the instance node's type", () => {
    // The instance node's own type is not a registered block, and the nesting
    // source answers "no restriction" for a type it cannot resolve. Judged by
    // that, a component whose root may only live inside columns could be
    // placed at the page root — and would render there.
    catalog([{ ...base, name: "acme/column", parent: ["acme/columns"] }]);
    const [component] = componentEntriesFrom(
      [
        stored({
          document: componentOf([
            { id: "d1", type: "acme/column", version: 1, props: {} },
          ]),
        }),
      ],
      NONE
    );

    const verdict = entryAllowedAt(
      component as never,
      { kind: "root" },
      registryNestingSource()
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("restricted-at-root");
    expect(verdict.permitted).toEqual(["acme/columns"]);
  });

  it("allows a component whose roots the destination takes", () => {
    catalog([{ ...base, name: "acme/text" }]);
    const [component] = componentEntriesFrom([stored()], NONE);

    expect(
      entryAllowedAt(
        component as never,
        { kind: "root" },
        registryNestingSource()
      ).allowed
    ).toBe(true);
  });

  it("judges a root that is ITSELF an instance by what the canvas will draw there", () => {
    // A definition may hold instances of other components, at its root
    // included. The instance node's type is not a registered block, so judged
    // as stored the root answers "no restriction" and a component whose real
    // root is confined to columns is offered — and drawn — at the page root.
    // Resolved through the lookup, the root IS the column.
    catalog([{ ...base, name: "acme/column", parent: ["acme/columns"] }]);
    const column = stored({
      id: "column",
      document: componentOf([
        { id: "c1", type: "acme/column", version: 1, props: {} },
      ]),
    });
    const wrapper = stored({
      id: "wrapper",
      document: componentOf([instanceOf("column")]),
    });

    const [offered] = componentEntriesFrom([wrapper], lookupOf(column));
    const verdict = entryAllowedAt(
      offered as never,
      { kind: "root" },
      registryNestingSource()
    );

    expect(offered?.componentId).toBe("wrapper");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("restricted-at-root");
  });

  it("withholds a component whose root instance the lookup cannot resolve", () => {
    // Its roots cannot be determined, so its placement cannot be judged, and
    // the canvas would draw that root as could-not-be-loaded. The lookup is
    // what decides: the same definition IS offered once the component its root
    // points at is present.
    catalog([{ ...base, name: "acme/text" }]);
    const header = stored({ id: "header" });
    const wrapper = stored({
      id: "wrapper",
      document: componentOf([instanceOf("header")]),
    });

    const withheld = componentEntriesFrom([wrapper], NONE);
    const offered = componentEntriesFrom([wrapper], lookupOf(header));

    expect(withheld).toEqual([]);
    expect(offered.map(entry => entry.componentId)).toEqual(["wrapper"]);
    // And judged by the header's root, which the destination takes.
    expect(
      entryAllowedAt(
        offered[0] as never,
        { kind: "root" },
        registryNestingSource()
      ).allowed
    ).toBe(true);
  });

  it("withholds a component whose root is an instance of itself", () => {
    // The resolver detects the cycle and leaves the root standing; nothing
    // here recurses to find it, and nothing here needs to.
    catalog([{ ...base, name: "acme/text" }]);
    const loop = stored({
      id: "loop",
      document: componentOf([instanceOf("loop")]),
    });

    expect(componentEntriesFrom([loop], lookupOf(loop))).toEqual([]);
  });

  it("withholds a component whose root resolves to NOTHING", () => {
    // A root that is an instance of a component with no roots resolves to an
    // empty forest: there is no root type to refuse, so placement would pass
    // vacuously and the placed node would render nothing. Emptiness has to be
    // asked of the RESOLVED forest, not only the stored one.
    catalog([{ ...base, name: "acme/text" }]);
    const hollow = stored({ id: "hollow", document: componentOf([]) });
    const wrapper = stored({
      id: "wrapper",
      document: componentOf([instanceOf("hollow")]),
    });

    expect(componentEntriesFrom([wrapper], lookupOf(hollow))).toEqual([]);
  });

  it("offers a component on its roots whatever the caps, and leaves room to the click", () => {
    // Room is a property of the page, asked at the click with the page in
    // hand: the tile is judged by what its roots ARE, not by whether they fit
    // a cap. A wrapper whose header has two nodes is offered under a cap of
    // one, and placing it on any page under that cap is refused for budget
    // with the sentence — never drawn as could-not-be-loaded, because the
    // preflight runs before the apply.
    catalog([{ ...base, name: "acme/text" }]);
    const header = stored({
      id: "header",
      document: componentOf([
        { id: "d1", type: "acme/text", version: 1, props: {} },
        { id: "d2", type: "acme/text", version: 1, props: {} },
      ]),
    });
    const wrapper = stored({
      id: "wrapper",
      document: componentOf([instanceOf("header")]),
    });
    const lookup = lookupOf(header, wrapper);
    const tight = { ...DEFAULT_LIMITS, maxNodes: 1 };

    const [offered] = componentEntriesFrom([wrapper], lookup);
    expect(offered?.componentId).toBe("wrapper");
    expect(
      compositionRefusal(
        documentOf([]),
        {
          kind: "insert",
          node: nodeForComponentEntry(offered!),
          at: { index: 0 },
        },
        lookup,
        tight
      )?.reason
    ).toBe("budget");
  });

  it("reads a root's types without composing the definition, so a library of wrappers costs its roots", () => {
    // Three thousand one-node wrappers around one large definition composed
    // whole, once per wrapper, was fifteen million nodes on opening the
    // panel. The roots are read through the lookup instead: the large
    // definition is asked for once per wrapper, never cloned.
    catalog([
      { ...base, name: "acme/box", slots: { children: {} } },
      { ...base, name: "acme/text" },
    ]);
    // The large definition's root is a box whose children are behind a
    // counting accessor: reading the roots never opens it, composing does.
    let descents = 0;
    const children = Array.from({ length: 500 }, (_, i) => ({
      id: `t${String(i)}`,
      type: "acme/text",
      version: 1,
      props: {},
    }));
    const box: BlockNode = {
      id: "b1",
      type: "acme/box",
      version: 1,
      props: {},
    };
    Object.defineProperty(box, "slots", {
      enumerable: true,
      get: () => {
        descents += 1;
        return { children };
      },
    });
    const big = stored({ id: "big", document: componentOf([box]) });
    const wrappers = Array.from({ length: 50 }, (_, i) =>
      stored({
        id: `w${String(i)}`,
        document: componentOf([instanceOf("big")]),
      })
    );

    const offered = componentEntriesFrom(wrappers, lookupOf(big, ...wrappers));

    expect(offered).toHaveLength(50);
    expect(offered.every(entry => entry.roots.join() === "acme/box")).toBe(
      true
    );
    expect(descents).toBe(0);
    // And what each entry carries is the stored one-node wrapper, not a
    // composed forest.
    expect(offered.every(entry => entry.document.nodes.length === 1)).toBe(
      true
    );
  });

  it("still offers a component with an unresolvable instance BELOW its root", () => {
    // What sits inside the definition is the definition's own concern, exactly
    // as its internal nesting is: the root is a real block the destination can
    // judge, and the placeholder inside it is what the author saved.
    catalog([
      { ...base, name: "acme/box", slots: { children: {} } },
      { ...base, name: "acme/text" },
    ]);
    const boxed = stored({
      id: "boxed",
      document: componentOf([
        {
          id: "b1",
          type: "acme/box",
          version: 1,
          props: {},
          slots: { children: [instanceOf("missing")] },
        },
      ]),
    });

    const [offered] = componentEntriesFrom([boxed], NONE);

    expect(offered?.componentId).toBe("boxed");
    expect(offered?.roots).toEqual(["acme/box"]);
  });

  it("hands over the STORED document, by identity, beside the roots it draws", () => {
    // The catalogue and everything keyed on it would otherwise rebuild for a
    // document that did not change. The roots are what placement is judged
    // by; the document is what a preview of the tile would draw.
    catalog([{ ...base, name: "acme/text" }]);
    const row = stored();

    const [offered] = componentEntriesFrom([row], NONE);

    expect(offered?.document).toBe(row.document);
    expect(offered?.roots).toEqual(["acme/text"]);
  });

  describe("whether the page has room for it", () => {
    /** A page holding `count` plain text nodes at the root. */
    function pageWith(count: number): BlockDocument {
      return documentOf(
        Array.from({ length: count }, (_, i) => ({
          id: `p${i}`,
          type: "acme/text",
          version: 1,
          props: {},
        }))
      );
    }
    const three = stored({
      id: "three",
      document: componentOf([
        { id: "d1", type: "acme/text", version: 1, props: {} },
        { id: "d2", type: "acme/text", version: 1, props: {} },
        { id: "d3", type: "acme/text", version: 1, props: {} },
      ]),
    });
    const node = () =>
      nodeForComponentEntry(componentEntriesFrom([three], lookupOf(three))[0]!);

    it("answers nothing for a page with room", () => {
      catalog([{ ...base, name: "acme/text" }]);
      const limits = { ...DEFAULT_LIMITS, maxNodes: 10 };

      expect(
        compositionRefusal(
          pageWith(2),
          { kind: "insert", node: node(), at: { index: 2 } },
          lookupOf(three),
          limits
        )
      ).toBeUndefined();
    });

    it("refuses a page whose composed size would pass the node cap, and says so", () => {
      // The apply would accept it — one stored node — and the canvas would then
      // leave it unresolved: the resolver spends one budget across every
      // instance it inlines. Two stored nodes plus a three-node definition
      // under a cap of four is the case.
      catalog([{ ...base, name: "acme/text" }]);
      const limits = { ...DEFAULT_LIMITS, maxNodes: 4 };

      const refusal = compositionRefusal(
        pageWith(2),
        { kind: "insert", node: node(), at: { index: 2 } },
        lookupOf(three),
        limits
      );

      expect(refusal?.reason).toBe("budget");
      expect(refusal?.sentence).toMatch(/no room left/);
    });

    it("asks the resolver, so a definition too deep for the cap is refused as the resolver refuses it", () => {
      // The resolver judges a definition's own depth from its own root — a
      // placement's depth in the page is not part of that judgement — so what
      // this can refuse is exactly what the canvas would leave unresolved,
      // and nothing more.
      catalog([
        { ...base, name: "acme/box", slots: { children: {} } },
        { ...base, name: "acme/text" },
      ]);
      const nested = stored({
        id: "nested",
        document: componentOf([
          {
            id: "d1",
            type: "acme/box",
            version: 1,
            props: {},
            slots: {
              children: [
                { id: "d2", type: "acme/text", version: 1, props: {} },
              ],
            },
          },
        ]),
      });
      const instance = nodeForComponentEntry(
        componentEntriesFrom([nested], lookupOf(nested))[0]!
      );

      const tooDeep = compositionRefusal(
        pageWith(0),
        { kind: "insert", node: instance, at: { index: 0 } },
        lookupOf(nested),
        { ...DEFAULT_LIMITS, maxDepth: 1 }
      );
      const fits = compositionRefusal(
        pageWith(0),
        { kind: "insert", node: instance, at: { index: 0 } },
        lookupOf(nested),
        { ...DEFAULT_LIMITS, maxDepth: 2 }
      );

      expect(tooDeep?.reason).toBe("node-depth");
      expect(fits).toBeUndefined();
    });

    it("judges the dry run under the SITE's limits, so the resolver reaches a page legal only under a raised cap", () => {
      // The apply is the first stage of the preflight and takes limits of its
      // own. A page longer than the engine's default cap is legal on a site
      // that raised it; judged by the default, the dry run refuses it before
      // the resolver ever runs, and the click then fails on a page the editor
      // and the canvas both accept. The RESOLVER's verdict is what proves it
      // ran: under a cap with room for one more node but not for three, the
      // placement is refused for budget; with room for three, it is placed.
      catalog([{ ...base, name: "acme/text" }]);
      const page = pageWith(DEFAULT_LIMITS.maxNodes);
      const at = { index: page.nodes.length };
      const lookup = lookupOf(three);
      const tight = {
        ...DEFAULT_LIMITS,
        maxNodes: DEFAULT_LIMITS.maxNodes + 2,
      };
      const roomy = {
        ...DEFAULT_LIMITS,
        maxNodes: DEFAULT_LIMITS.maxNodes + 4,
      };

      const insert = { kind: "insert" as const, node: node(), at };
      expect(compositionRefusal(page, insert, lookup, tight)?.reason).toBe(
        "budget"
      );
      expect(compositionRefusal(page, insert, lookup, roomy)).toBeUndefined();
    });

    it("leaves a refusal the apply itself makes to the apply, rather than throwing", () => {
      // A page already at the stored-node cap cannot take the one instance
      // node either. That is the editor's own refusal, made the same way for
      // a block, and not a sentence about composition: nothing here throws,
      // and nothing here answers for it.
      catalog([{ ...base, name: "acme/text" }]);
      const full = { ...DEFAULT_LIMITS, maxNodes: 2 };

      expect(
        compositionRefusal(
          pageWith(2),
          { kind: "insert", node: node(), at: { index: 2 } },
          lookupOf(three),
          full
        )
      ).toBeUndefined();
    });

    describe("an instance the click leaves unresolved that is not the placed one", () => {
      const wrapper = stored({
        id: "wrapper",
        document: componentOf([
          {
            id: "w1",
            type: "acme/box",
            version: 1,
            props: {},
            slots: { children: [instanceOf("three", "w-three")] },
          },
        ]),
      });
      const one = stored({
        id: "one",
        document: componentOf([
          { id: "o1", type: "acme/text", version: 1, props: {} },
        ]),
      });
      const both = lookupOf(three, wrapper, one);
      const placed = (row: SavedComponent) =>
        nodeForComponentEntry(componentEntriesFrom([row], both)[0]!);

      beforeEach(() => {
        catalog([
          { ...base, name: "acme/box", slots: { children: {} } },
          { ...base, name: "acme/text" },
        ]);
      });

      it("refuses a definition whose NESTED instance the page has no room for", () => {
        // The wrapper's own root fits and is inlined; the instance inside it
        // does not, and the resolver leaves it standing under an id it minted
        // — never the placed node's. The click would place a component that
        // draws a placeholder inside itself.
        const tight = { ...DEFAULT_LIMITS, maxNodes: 5 };
        const roomy = { ...DEFAULT_LIMITS, maxNodes: 6 };

        expect(
          compositionRefusal(
            pageWith(2),
            { kind: "insert", node: placed(wrapper), at: { index: 2 } },
            both,
            tight
          )?.reason
        ).toBe("budget");
        expect(
          compositionRefusal(
            pageWith(2),
            { kind: "insert", node: placed(wrapper), at: { index: 2 } },
            both,
            roomy
          )
        ).toBeUndefined();
      });

      it("refuses a placement that pushes an instance already on the page past the budget", () => {
        // The budget is spent in document order. Placed BEFORE an instance
        // that fitted, the new one takes the room the old one had, and the
        // page would draw a placeholder where something used to be.
        const page = documentOf([
          { id: "p0", type: "acme/text", version: 1, props: {} },
          instanceOf("three", "old"),
        ]);
        const limits = { ...DEFAULT_LIMITS, maxNodes: 6 };

        expect(
          compositionRefusal(
            page,
            { kind: "insert", node: placed(three), at: { index: 1 } },
            both,
            limits
          )?.reason
        ).toBe("budget");
      });

      it("tells instances apart by THEIR ids, not by their definition", () => {
        // Two instances of one definition are two ids. One the page already
        // leaves standing does not excuse the next, which is a placeholder
        // the click would put on the page in its own right.
        const deep = stored({
          id: "deep",
          document: componentOf([
            {
              id: "w1",
              type: "acme/box",
              version: 1,
              props: {},
              slots: {
                children: [
                  {
                    id: "w2",
                    type: "acme/box",
                    version: 1,
                    props: {},
                    slots: { children: [instanceOf("three", "w-three")] },
                  },
                ],
              },
            },
          ]),
        });
        const lookup = lookupOf(three, deep);
        const page = documentOf([
          instanceOf("deep", "old"),
          { id: "p0", type: "acme/text", version: 1, props: {} },
        ]);
        const limits = { ...DEFAULT_LIMITS, maxDepth: 2 };
        const instance = nodeForComponentEntry(
          componentEntriesFrom([deep], lookup)[0]!
        );

        expect(
          compositionRefusal(
            page,
            { kind: "insert", node: instance, at: { index: 2 } },
            lookup,
            limits
          )?.reason
        ).toBe("node-depth");
      });

      it("judges a MOVE by the same rule: an instance carried before another takes its budget", () => {
        // The budget is spent in document order, so moving an instance
        // ahead of one that fitted can leave that one standing. The same
        // comparison, with a move op instead of an insert: the preflight
        // judges what the op leaves standing, whatever the op is.
        const page = documentOf([
          { id: "p0", type: "acme/text", version: 1, props: {} },
          instanceOf("three", "first"),
          instanceOf("three", "second"),
        ]);
        // Room for one of the two, whichever comes first.
        const limits = { ...DEFAULT_LIMITS, maxNodes: 6 };

        expect(
          compositionRefusal(
            page,
            { kind: "move", id: "second", to: { index: 1 } },
            both,
            limits
          )?.reason
        ).toBe("budget");
        expect(
          compositionRefusal(
            page,
            { kind: "move", id: "p0", to: { index: 2 } },
            both,
            limits
          )
        ).toBeUndefined();
      });

      it("does not blame the click for an instance the page already could not hold", () => {
        // Only what the placement INTRODUCES refuses it. An instance refused
        // for budget before the click is refused after it too, and a one-node
        // component that fits beside it is placed.
        const page = documentOf([
          instanceOf("three", "old"),
          { id: "p1", type: "acme/text", version: 1, props: {} },
          { id: "p2", type: "acme/text", version: 1, props: {} },
        ]);
        const limits = { ...DEFAULT_LIMITS, maxNodes: 4 };

        expect(
          compositionRefusal(
            page,
            { kind: "insert", node: placed(one), at: { index: 3 } },
            both,
            limits
          )
        ).toBeUndefined();
      });
    });

    it("leaves a reason that is not about room to the tile", () => {
      // A missing definition was the tile's concern when it was offered; the
      // insert refuses only what the page cannot hold.
      catalog([{ ...base, name: "acme/text" }]);

      expect(
        compositionRefusal(
          pageWith(2),
          { kind: "insert", node: node(), at: { index: 2 } },
          NONE
        )
      ).toBeUndefined();
    });
  });

  describe("what a node already on the page is judged by when it moves", () => {
    it("judges a block by its own type", () => {
      const block: BlockNode = {
        id: "p0",
        type: "acme/text",
        version: 1,
        props: {},
      };

      expect(placementTypesOf(block, NONE)).toEqual(["acme/text"]);
    });

    it("judges an instance by the ROOTS of the definition it draws, resolved as its tile was", () => {
      // The instance node's own type is not a registered block, and the
      // nesting source answers "no restriction" for it — so a move judged by
      // the node's type would let a component whose root belongs only inside
      // a Columns be dragged into a paragraph after its insert was refused
      // there. Through the lookup, so a definition whose root is itself an
      // instance is judged by what that root draws.
      catalog([
        { ...base, name: "acme/box", slots: { children: {} } },
        { ...base, name: "acme/text" },
      ]);
      const boxed = stored({
        id: "boxed",
        document: componentOf([
          { id: "d1", type: "acme/box", version: 1, props: {}, slots: {} },
          instanceOf("header"),
        ]),
      });
      const lookup = lookupOf(stored(), boxed);

      expect(placementTypesOf(instanceOf("boxed"), lookup)).toEqual([
        "acme/box",
        "acme/text",
      ]);
    });

    it("judges an instance it cannot resolve by its own type, which restricts nothing", () => {
      // A placeholder is drawn wherever it sits; refusing to move one would
      // pin it to the spot it was left in.
      expect(placementTypesOf(instanceOf("missing"), NONE)).toEqual([
        COMPONENT_INSTANCE_TYPE,
      ]);
      expect(placementTypesOf(instanceOf("missing"))).toEqual([
        COMPONENT_INSTANCE_TYPE,
      ]);
    });
  });

  it("places ONE instance node pointing at the definition, copying nothing", () => {
    // The whole difference from a pattern. The definition's content is not in
    // the page; the renderer inlines it at read time, which is what makes an
    // edit to the definition reach this page later.
    const [component] = componentEntriesFrom([stored()], NONE);
    const node = nodeForComponentEntry(component!);

    expect(node.type).toBe(COMPONENT_INSTANCE_TYPE);
    expect(node.props).toEqual({ componentId: "header" });
    expect(node.slots).toBeUndefined();
    // And a fresh id each time, so two placements are two nodes.
    expect(nodeForComponentEntry(component!).id).not.toBe(node.id);
  });
});
