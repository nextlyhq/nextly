/**
 * Where a clicked block lands, by what is selected and what is being added:
 * a content block goes inside a selected block that holds blocks, at the end;
 * a layout block goes after it; a Section or saved section goes after the
 * top-level block holding the selection.
 *
 * The places are asked of the same function every insert surface asks, and
 * judged here by a small allow-list standing in for the nesting rule, so each
 * case reads as "this selection, this block, lands here".
 *
 * @module insertion-candidates.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { InsertEntry, SlotSource } from "./inserter-types";
import {
  entryRoles,
  insertionCandidates,
  insertionFor,
  type EntryRole,
  type InsertionCandidate,
} from "./insertion-candidates";

afterEach(() => clearBlocks());

/** Each test block's regions, and what a region admits (absent: anything). */
const REGIONS: Record<string, Record<string, readonly string[] | undefined>> = {
  "core/section": { children: undefined },
  "core/box": { children: undefined },
  "core/columns": { children: ["core/column"] },
  "core/column": { children: undefined },
  "core/gallery": { items: ["core/image"] },
  "core/accordion": { items: ["core/accordion-item"] },
  "core/accordion-item": { children: undefined },
};

/** Blocks that may sit only inside the named parent. */
const PARENTS: Record<string, string> = {
  "core/column": "core/columns",
  "core/accordion-item": "core/accordion",
};

const slots: SlotSource = {
  slotsOf: type => {
    const declared = REGIONS[type];
    return declared === undefined ? undefined : Object.keys(declared);
  },
};

function node(
  id: string,
  type: string,
  children?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: children }),
  };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Whether a place takes a block of this type, by the allow-lists above. */
function takes(type: string) {
  return (candidate: InsertionCandidate) => {
    const target = candidate.target;
    if (target.kind === "root") {
      return PARENTS[type] === undefined ? candidate : undefined;
    }
    const allowed = REGIONS[target.parentType]?.[target.slot];
    if (allowed !== undefined && !allowed.includes(type)) return undefined;
    const parent = PARENTS[type];
    return parent === undefined || parent === target.parentType
      ? candidate
      : undefined;
  };
}

/** Where a block of this type and role lands with this selection. */
function lands(
  document: BlockDocument,
  selected: string | null,
  type: string,
  role: EntryRole
): InsertionCandidate | undefined {
  return insertionFor(
    insertionCandidates(document, selected, { slots, role }),
    takes(type)
  )?.answer;
}

/** A Hero section holding a Heading, and a Pricing section after it. */
function hero(): BlockDocument {
  return page(
    node("hero", "core/section", { children: [node("h", "core/heading")] }),
    node("pricing", "core/section", {
      children: [
        node("cols", "core/columns", {
          children: [
            node("col", "core/column", { children: [node("t", "core/text")] }),
          ],
        }),
      ],
    })
  );
}

describe("where a clicked block lands", () => {
  it("adds anything at the end of the page when nothing is selected", () => {
    for (const role of ["content", "layout", "band"] as const) {
      expect(lands(hero(), null, "core/heading", role)).toEqual({
        kind: "document-end",
        at: { index: 2 },
        target: { kind: "root" },
      });
    }
  });

  it("puts a content block inside a selected Section, at the end", () => {
    expect(lands(hero(), "hero", "core/heading", "content")).toMatchObject({
      kind: "inside",
      insideId: "hero",
      at: { parentId: "hero", slot: "children", index: 1 },
    });
  });

  it("puts a content block inside a selected EMPTY Box", () => {
    const document = page(node("box", "core/box"));
    expect(lands(document, "box", "core/text", "content")).toMatchObject({
      kind: "inside",
      at: { parentId: "box", slot: "children", index: 0 },
    });
  });

  it("puts a layout block after a selected Section", () => {
    expect(lands(hero(), "hero", "core/box", "layout")).toMatchObject({
      kind: "after-selection",
      afterId: "hero",
      at: { index: 1 },
    });
  });

  it("puts a Box after a selected Box, so Box then Box gives two siblings", () => {
    let document = page(node("b1", "core/box"));
    const at = lands(document, "b1", "core/box", "layout")?.at;
    expect(at).toEqual({ index: 1 });
    document = page(node("b1", "core/box"), node("b2", "core/box"));
    expect(lands(document, "b2", "core/box", "layout")?.at).toEqual({
      index: 2,
    });
  });

  it("puts a Heading after selected Columns, which hold only Column blocks", () => {
    const document = page(
      node("cols", "core/columns", { children: [node("c1", "core/column")] })
    );
    expect(lands(document, "cols", "core/heading", "content")).toMatchObject({
      kind: "after-selection",
      afterId: "cols",
      at: { index: 1 },
    });
  });

  it("puts a Column inside selected Columns, as the last resort", () => {
    const document = page(
      node("cols", "core/columns", { children: [node("c1", "core/column")] })
    );
    expect(lands(document, "cols", "core/column", "layout")).toMatchObject({
      kind: "inside",
      insideId: "cols",
      at: { parentId: "cols", slot: "children", index: 1 },
    });
  });

  it("puts an Image inside a selected Gallery", () => {
    const document = page(node("g", "core/gallery", { items: [] }));
    expect(lands(document, "g", "core/image", "content")).toMatchObject({
      kind: "inside",
      at: { parentId: "g", slot: "items", index: 0 },
    });
  });

  it("puts Text inside a selected Accordion item", () => {
    const document = page(
      node("acc", "core/accordion", {
        items: [node("item", "core/accordion-item", { children: [] })],
      })
    );
    expect(lands(document, "item", "core/text", "content")).toMatchObject({
      kind: "inside",
      at: { parentId: "item", slot: "children", index: 0 },
    });
  });

  it("puts Text after a selected Heading inside Hero, inside Hero", () => {
    expect(lands(hero(), "h", "core/text", "content")).toMatchObject({
      kind: "after-selection",
      afterId: "h",
      at: { parentId: "hero", slot: "children", index: 1 },
    });
  });

  it("adds five Text blocks in a row inside a Section as five siblings", () => {
    let document = page(node("s", "core/section", { children: [] }));
    let selected = "s";
    for (const id of ["a", "b", "c", "d", "e"]) {
      const at = lands(document, selected, "core/text", "content")?.at;
      if (at === undefined || at.parentId !== "s") throw new Error(id);
      const section = document.nodes[0] as BlockNode;
      const held = [...(section.slots?.children ?? [])];
      held.splice(at.index, 0, node(id, "core/text"));
      document = page({ ...section, slots: { children: held } });
      selected = id;
    }
    const section = document.nodes[0] as BlockNode;
    expect(section.slots?.children?.map(child => child.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("puts a Section after the top-level block holding a nested selection", () => {
    expect(lands(hero(), "h", "core/section", "band")).toEqual({
      kind: "after-ancestor",
      afterId: "hero",
      at: { index: 1 },
      target: { kind: "root" },
    });
  });

  it("puts a saved section after Pricing when a Column inside its Columns is selected", () => {
    expect(insertionCandidates(hero(), "col", { slots, role: "band" })).toEqual(
      [
        {
          kind: "after-ancestor",
          afterId: "pricing",
          at: { index: 2 },
          target: { kind: "root" },
        },
      ]
    );
  });

  it("keeps a Box in that same case on the layout rule, inside Pricing", () => {
    // Columns hold only Column blocks, so the Box climbs one place out:
    // after the Columns, still inside Pricing, never after Pricing.
    expect(lands(hero(), "col", "core/box", "layout")).toMatchObject({
      kind: "after-ancestor",
      afterId: "cols",
      at: { parentId: "pricing", slot: "children", index: 1 },
    });
  });

  it("puts a Section after a selected top-level Section, never inside it", () => {
    expect(lands(hero(), "hero", "core/section", "band")).toMatchObject({
      kind: "after-selection",
      afterId: "hero",
      at: { index: 1 },
    });
  });

  it("puts any block after a selected block that holds none", () => {
    for (const role of ["content", "layout"] as const) {
      expect(
        insertionCandidates(page(node("x", "core/heading")), "x", {
          slots,
          role,
        })
      ).toEqual([
        {
          kind: "after-selection",
          afterId: "x",
          at: { index: 1 },
          target: { kind: "root" },
        },
      ]);
    }
  });

  it("falls back outward, out to the page, when the nearer places refuse", () => {
    // A Gallery inside a Section, selected: an Image goes inside it; a
    // Heading is refused there, and goes after it, inside the Section.
    const document = page(
      node("s", "core/section", {
        children: [node("g", "core/gallery", { items: [] })],
      })
    );
    expect(
      insertionCandidates(document, "g", { slots, role: "content" }).map(
        place => place.kind
      )
    ).toEqual(["inside", "after-selection", "after-ancestor"]);
    expect(lands(document, "g", "core/heading", "content")).toMatchObject({
      kind: "after-selection",
      at: { parentId: "s", slot: "children", index: 1 },
    });
  });

  it("adds only at an explicit container, whatever the block", () => {
    for (const role of ["content", "layout", "band"] as const) {
      expect(
        insertionCandidates(hero(), "h", { slots, role, inside: "pricing" })
      ).toEqual([
        {
          kind: "inside",
          at: { parentId: "pricing", slot: "children", index: 1 },
          target: {
            kind: "slot",
            parentType: "core/section",
            slot: "children",
          },
          insideId: "pricing",
        },
      ]);
    }
  });

  it("names an explicit place between two blocks, and after the last", () => {
    expect(insertionCandidates(hero(), null, { at: { index: 1 } })).toEqual([
      {
        kind: "between",
        at: { index: 1 },
        target: { kind: "root" },
        afterId: "hero",
        beforeId: "pricing",
      },
    ]);
    expect(insertionCandidates(hero(), "h", { at: { index: 2 } })).toEqual([
      {
        kind: "after-ancestor",
        at: { index: 2 },
        target: { kind: "root" },
        afterId: "pricing",
      },
    ]);
    expect(
      insertionCandidates(hero(), null, {
        at: { parentId: "hero", slot: "children", index: 0 },
      })
    ).toEqual([
      {
        kind: "between",
        at: { parentId: "hero", slot: "children", index: 0 },
        target: { kind: "slot", parentType: "core/section", slot: "children" },
        beforeId: "h",
      },
    ]);
    // A place whose container is gone offers nothing.
    expect(
      insertionCandidates(hero(), null, {
        at: { parentId: "gone", slot: "children", index: 0 },
      })
    ).toEqual([]);
  });
});

describe("what kind of block an entry adds", () => {
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };

  function register(): void {
    registerBlocks(
      [
        {
          ...base,
          name: "core/section",
          editor: { label: "Section", category: "layout" },
          slots: { children: {} },
        },
        {
          ...base,
          name: "core/box",
          editor: { label: "Box", category: "layout" },
          slots: { children: {} },
        },
        {
          ...base,
          name: "core/divider",
          editor: { label: "Divider", category: "layout" },
        },
        {
          ...base,
          name: "core/accordion",
          editor: { label: "Accordion", category: "interactive" },
          slots: { items: {} },
        },
        {
          ...base,
          name: "core/button",
          editor: { label: "Button", category: "interactive" },
        },
      ] as never,
      { source: "core" }
    );
  }

  function block(name: string, category: string): InsertEntry {
    return {
      kind: "block",
      id: name,
      blockName: name,
      label: name,
      description: "",
      category,
      keywords: [],
      version: 1,
      props: {},
    };
  }

  function component(id: string, roots: readonly string[]): InsertEntry {
    return {
      kind: "component",
      id,
      componentId: id,
      label: id,
      description: "",
      category: "nextly:components",
      keywords: [],
      document: { formatVersion: 1, kind: "component", nodes: [] } as never,
      roots,
    };
  }

  it("reads a block's role from its group and its regions", () => {
    register();
    const roles = entryRoles(
      [
        block("core/section", "layout"),
        block("core/box", "layout"),
        block("core/divider", "layout"),
        block("core/accordion", "interactive"),
        block("core/button", "interactive"),
      ],
      undefined
    );
    expect(Object.fromEntries(roles)).toEqual({
      "core/section": "band",
      "core/box": "layout",
      // In the Layout group but holding nothing: a content block.
      "core/divider": "content",
      // Holding blocks of its own kind, outside the Layout group.
      "core/accordion": "content",
      "core/button": "content",
    });
  });

  it("treats a saved section as a Section", () => {
    const pattern: InsertEntry = {
      kind: "pattern",
      id: "pattern:p",
      patternId: "p",
      label: "Pricing",
      description: "",
      category: "other",
      keywords: [],
      document: page(node("x", "core/heading")),
    };
    expect(entryRoles([pattern], []).get("pattern:p")).toBe("band");
  });

  it("treats a component as a layout block when one of its top-level blocks is one", () => {
    register();
    const roles = entryRoles(
      [
        component("rooted-in-section", ["core/section"]),
        component("rooted-in-button", ["core/button"]),
        component("mixed", ["core/button", "core/box"]),
      ],
      undefined
    );
    expect(roles.get("rooted-in-section")).toBe("layout");
    expect(roles.get("rooted-in-button")).toBe("content");
    expect(roles.get("mixed")).toBe("layout");
  });

  it("reads a supplied definition before the registry's", () => {
    register();
    const roles = entryRoles(
      [block("acme/panel", "layout")],
      [
        {
          ...base,
          name: "acme/panel",
          editor: { label: "Panel", category: "layout" },
          slots: { children: {} },
        } as never,
      ]
    );
    expect(roles.get("acme/panel")).toBe("layout");
  });
});
