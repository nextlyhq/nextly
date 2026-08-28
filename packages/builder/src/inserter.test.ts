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
  registerBlocks,
  registryNestingSource,
  type AnyBlockDefinition,
  type BlockDocument,
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
  type InsertEntry,
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
function catalog(definitions: readonly unknown[]): InsertEntry[] {
  registerBlocks(definitions as never, { source: "acme" });
  return catalogFrom(allBlocks());
}

function entry(entries: readonly InsertEntry[], id: string): InsertEntry {
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
  let palette: InsertEntry[];
  const entries = (): InsertEntry[] => palette;

  const register = (): InsertEntry[] =>
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
  function palette(): InsertEntry[] {
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
      { at: "root" },
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
        { at: "slot", parentType: "acme/columns", slot: "children" },
        registryNestingSource()
      ).allowed
    ).toBe(true);
  });

  it("refuses it inside a container it does not declare", () => {
    const entries = palette();
    const verdict = entryAllowedAt(
      entry(entries, "acme/column"),
      { at: "slot", parentType: "acme/text", slot: "children" },
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
      entryAllowedAt(entry(entries, "acme/text"), { at: "root" }, source)
        .allowed
    ).toBe(true);
    expect(
      entryAllowedAt(
        entry(entries, "acme/text"),
        { at: "slot", parentType: "acme/columns", slot: "children" },
        source
      ).allowed
    ).toBe(true);
  });

  it("removes refused entries from the palette and keeps the rest", () => {
    const entries = palette();
    const offered = allowedEntries(
      entries,
      { at: "root" },
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
        { at: "root" },
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
      { at: "slot", parentType: "acme/gallery", slot: "children" },
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
        { at: "slot", parentType: "acme/gallery", slot: "children" },
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
      { at: "slot", parentType: "acme/grid", slot: "cells" },
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
      target: { at: "root" },
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
      target: { at: "root" },
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
      target: { at: "slot", parentType: "acme/columns", slot: "children" },
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
      target: { at: "slot", parentType: "acme/columns", slot: "children" },
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
      target: { at: "root" },
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
