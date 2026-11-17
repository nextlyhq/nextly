/**
 * Copied blocks: the format, reading it back, where a paste lands and what
 * refuses one. Each paste's ops are applied with the op layer's own
 * `applyOps`, so a plan the apply would refuse fails here.
 *
 * @module block-clipboard.test
 */
import {
  applyOps,
  bindingSchemaIssues,
  COMPONENT_INSTANCE_TYPE,
  tokenRef,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  BLOCK_CLIPBOARD_VERSION,
  copyOfSelection,
  FOREIGN_SITE_REFUSAL,
  OTHER_VERSION_REFUSAL,
  planPaste,
  readCopiedBlocks,
  serializeCopiedBlocks,
  type PasteSources,
} from "./block-clipboard";
import {
  slotsShowingEmpty,
  type SlotSource,
} from "./panels/add/inserter-types";

const SITE = "https://site.example";

/** Each test block's regions, and what a region admits (absent: anything). */
const REGIONS: Record<string, Record<string, readonly string[] | undefined>> = {
  "core/section": { children: undefined },
  "core/box": { children: undefined },
  "core/columns": { children: ["core/column"] },
  "core/column": { children: undefined },
  "core/collection-loop": { children: undefined, empty: undefined },
};

/** Blocks that may sit only inside the named parent. */
const PARENTS: Record<string, readonly string[]> = {
  "core/column": ["core/columns"],
};

const nesting: NestingSource = {
  parentsOf: type => PARENTS[type],
  slotAllowOf: (type, slot) => REGIONS[type]?.[slot],
};

const slots: SlotSource = {
  slotsOf: type => {
    const declared = REGIONS[type];
    return declared === undefined ? undefined : Object.keys(declared);
  },
};

/** The Box as a layout block, which goes after a selection rather than in it. */
const definitions = [
  {
    name: "core/box",
    version: 1,
    slots: { children: {} },
    editor: { category: "layout" },
  },
] as unknown as readonly AnyBlockDefinition[];

const sources: PasteSources = { nesting, slots, definitions };

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {},
  children?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...extra,
    ...(children === undefined ? {} : { slots: children }),
  };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** A Hero section holding a Heading, and a Box after it. */
function hero(): BlockDocument {
  return page(
    node("hero", "core/section", {}, { children: [node("h", "core/heading")] }),
    node("box", "core/box", {}, { children: [] })
  );
}

/** Copy `ids` of `from`, read the text back, and paste into `into`. */
function copyAndPaste(
  from: BlockDocument,
  ids: readonly string[],
  into: BlockDocument,
  selected: string | null
): { document: BlockDocument; newIds: readonly string[] } {
  const copied = copyOfSelection(from, ids, SITE);
  if (copied === null) throw new Error("nothing copied");
  const read = readCopiedBlocks(serializeCopiedBlocks(copied), SITE);
  if (read === null || read.blocks === undefined) throw new Error("not read");
  const plan = planPaste(into, selected, read.blocks, sources);
  if (plan.refusal !== undefined) throw new Error(plan.refusal);
  return {
    document: applyOps(into, [...plan.ops]).document,
    newIds: plan.newIds,
  };
}

describe("copying blocks", () => {
  it("copies the outermost selected blocks in page order, with their children", () => {
    const document = hero();
    const copied = copyOfSelection(document, ["box", "h", "hero"], SITE);
    // The Heading is inside the Hero, so it is copied once, as its child.
    expect(copied?.blocks.map(block => block.id)).toEqual(["hero", "box"]);
    expect(copied?.blocks[0]?.slots?.children?.[0]?.id).toBe("h");
    expect(copied?.origin).toBe(SITE);
    expect(copied?.nextlyBlocks).toBe(BLOCK_CLIPBOARD_VERSION);
  });

  it("copies nothing with nothing selected", () => {
    expect(copyOfSelection(hero(), [], SITE)).toBeNull();
  });
});

describe("reading copied blocks back", () => {
  const text = serializeCopiedBlocks({
    nextlyBlocks: 1,
    origin: SITE,
    blocks: [node("h", "core/heading")],
  });

  it("reads blocks copied on this site", () => {
    expect(readCopiedBlocks(text, SITE)?.blocks?.[0]?.id).toBe("h");
  });

  it("refuses blocks copied on another site, pointing to Export and Import", () => {
    const read = readCopiedBlocks(text, "https://other.example");
    expect(read?.refusal).toBe(FOREIGN_SITE_REFUSAL);
    expect(FOREIGN_SITE_REFUSAL).toContain("Export and Import");
  });

  it("refuses another version of the format", () => {
    const later = text.replace('"nextlyBlocks":1', '"nextlyBlocks":2');
    expect(readCopiedBlocks(later, SITE)?.refusal).toBe(OTHER_VERSION_REFUSAL);
  });

  it("leaves ordinary text alone", () => {
    expect(readCopiedBlocks("Hello", SITE)).toBeNull();
    expect(readCopiedBlocks('{"title":"Hello"}', SITE)).toBeNull();
  });

  it("refuses copied data whose blocks the page could not hold", () => {
    const broken = text.replace('"version":1,', "");
    expect(readCopiedBlocks(broken, SITE)?.refusal).toMatch(/cannot be copied/);
  });
});

describe("where pasted blocks land", () => {
  it("goes inside a selected container, at the end", () => {
    const { document, newIds } = copyAndPaste(hero(), ["h"], hero(), "hero");
    const inside = document.nodes[0]?.slots?.children ?? [];
    expect(inside).toHaveLength(2);
    expect(inside[1]?.id).toBe(newIds[0]);
  });

  it("goes after a selected block that holds none", () => {
    const { document, newIds } = copyAndPaste(hero(), ["box"], hero(), "h");
    const inside = document.nodes[0]?.slots?.children ?? [];
    // A Box is a layout block, after the Heading in its own region.
    expect(inside.map(block => block.id)).toEqual(["h", newIds[0]]);
  });

  it("puts a content block right after a selected block that holds none", () => {
    const { document, newIds } = copyAndPaste(hero(), ["h"], hero(), "h");
    const inside = document.nodes[0]?.slots?.children ?? [];
    expect(inside.map(block => block.id)).toEqual(["h", newIds[0]]);
  });

  it("passes over a place a lock refuses, for the next place, as a clicked tile does", () => {
    const copied = copyOfSelection(hero(), ["h"], SITE)?.blocks ?? [];
    // A lock refusing anything put inside the Hero: the Heading goes after it.
    const plan = planPaste(hero(), "hero", copied, {
      ...sources,
      lockRefusal: ops =>
        ops.some(op => op.kind === "insert" && op.at.parentId === "hero")
          ? "Hero is locked."
          : null,
    });
    if (plan.refusal !== undefined) throw new Error(plan.refusal);
    const after = applyOps(hero(), [...plan.ops]).document;
    expect(after.nodes.map(block => block.id)).toEqual([
      "hero",
      plan.newIds[0],
      "box",
    ]);
  });

  it("refuses with the lock's words when every place is locked", () => {
    const copied = copyOfSelection(hero(), ["h"], SITE)?.blocks ?? [];
    const plan = planPaste(hero(), null, copied, {
      ...sources,
      lockRefusal: () => "The page is locked.",
    });
    expect(plan.refusal).toBe("The page is locked.");
  });

  it("goes at the end of the page with nothing selected", () => {
    const { document, newIds } = copyAndPaste(hero(), ["h"], hero(), null);
    expect(document.nodes.at(-1)?.id).toBe(newIds[0]);
    expect(document.nodes).toHaveLength(3);
  });

  it("puts a layout block after a selected container, as a click on its tile would", () => {
    const { document, newIds } = copyAndPaste(hero(), ["box"], hero(), "box");
    expect(document.nodes.map(block => block.id)).toEqual([
      "hero",
      "box",
      newIds[0],
    ]);
  });

  it("gives every pasted block a new id and keeps the run's order", () => {
    const { document, newIds } = copyAndPaste(
      hero(),
      ["hero", "box"],
      hero(),
      null
    );
    expect(newIds).toHaveLength(2);
    expect(newIds.some(id => ["hero", "box", "h"].includes(id))).toBe(false);
    expect(document.nodes.slice(2).map(block => block.type)).toEqual([
      "core/section",
      "core/box",
    ]);
  });

  it("refuses a place no candidate accepts, in the words other refused inserts use", () => {
    // A Column belongs only in Columns, and nothing here is one.
    const copied = [node("col", "core/column")];
    const plan = planPaste(hero(), "h", copied, sources);
    expect(plan.refusal).toMatch(/cannot sit in that container/);
    expect(plan.ops).toBeUndefined();
  });

  it("refuses Entry content in a page, which only a template can hold", () => {
    const entry = node("entry", "core/entry-content", {
      props: { field: "body" },
    });
    const plan = planPaste(page(), null, [entry], sources);
    expect(plan.refusal).toMatch(/only in a template/);
  });

  it("refuses Entry content naming a field the template's collection doesn't have", () => {
    const entry = node("entry", "core/entry-content", {
      props: { field: "body" },
    });
    const template = {
      formatVersion: 1,
      kind: "template",
      nodes: [],
    } as unknown as BlockDocument;
    const elsewhere = planPaste(template, null, [entry], {
      ...sources,
      entryFields: ["content"],
    });
    expect(elsewhere.refusal).toMatch(/field this template’s collection doesn’t have/);
    // The control: the same block pastes where the collection has the field.
    const here = planPaste(template, null, [entry], {
      ...sources,
      entryFields: ["body"],
    });
    expect(here.refusal).toBeUndefined();
  });

  it("refuses a second Entry content block in a template", () => {
    const entry = node("entry", "core/entry-content", {
      props: { field: "body" },
    });
    const template = {
      formatVersion: 1,
      kind: "template",
      nodes: [entry],
    } as BlockDocument;
    const plan = planPaste(template, null, [entry], {
      ...sources,
      entryFields: ["body"],
    });
    expect(plan.refusal).toBe("A template holds one Entry content block.");
  });
});

describe("a paste into a list showing its empty message", () => {
  it("goes into the empty message the canvas shows, not the entries", () => {
    const list = node(
      "list",
      "core/collection-loop",
      { props: { limit: 3, collection: "posts" } },
      { children: [node("entry-h", "core/heading")], empty: [] }
    );
    const document = page(list);
    const copied = [node("note", "core/heading")];
    const plan = planPaste(document, "list", copied, {
      ...sources,
      slots: slotsShowingEmpty(slots, new Set(["list"])),
    });
    if (plan.refusal !== undefined) throw new Error(plan.refusal);
    const after = applyOps(document, [...plan.ops]).document;
    expect(after.nodes[0]?.slots?.empty?.map(each => each.id)).toEqual(
      plan.newIds
    );
    expect(after.nodes[0]?.slots?.children).toHaveLength(1);
  });
});

describe("references kept by a paste on the same site", () => {
  it("points at the same shared styles, block style, variables, components and media", () => {
    const card = node(
      "card",
      "core/box",
      {
        classes: ["cls_hero", "look:core/box:outline"],
        styles: { base: { desktop: { color: tokenRef("t-accent") } } },
      },
      {
        children: [
          node("pic", "core/image", {
            props: { image: { id: "media-42", url: "/media/42.webp" } },
          }),
          node("placed", COMPONENT_INSTANCE_TYPE, {
            props: { componentId: "cmp-pricing" },
          }),
        ],
      }
    );
    const from = page(card);
    const { document, newIds } = copyAndPaste(from, ["card"], page(), null);
    const pasted = document.nodes[0];
    expect(pasted?.id).toBe(newIds[0]);
    expect(pasted?.classes).toEqual(["cls_hero", "look:core/box:outline"]);
    expect(pasted?.styles).toEqual(card.styles);
    const [pic, placed] = pasted?.slots?.children ?? [];
    expect(pic?.props).toEqual({
      image: { id: "media-42", url: "/media/42.webp" },
    });
    expect(placed?.props).toEqual({ componentId: "cmp-pricing" });
    expect(pic?.id).not.toBe("pic");
  });
});

describe("a binding pasted where it cannot be read", () => {
  it("is kept as copied, and the page still saves", () => {
    const title = node("title", "core/heading", {
      props: { text: "Own text", level: "h2" },
      bindings: { text: { $bind: "title", source: "item" } },
    });
    const list = node(
      "list",
      "core/collection-loop",
      { props: { limit: 3, collection: "posts" } },
      { children: [title], empty: [] }
    );
    const document = page(list);
    const { document: after, newIds } = copyAndPaste(
      document,
      ["title"],
      document,
      null
    );
    const pasted = after.nodes.at(-1);
    expect(pasted?.id).toBe(newIds[0]);
    // Outside the list, and kept exactly as copied: not dropped or rewritten.
    expect(after.nodes.map(each => each.type)).toEqual([
      "core/collection-loop",
      "core/heading",
    ]);
    expect(pasted?.bindings).toEqual(title.bindings);

    // The judgement a save runs refuses nothing for it, so a paste never
    // leaves a page that cannot be saved.
    const errors = bindingSchemaIssues(
      { nodes: after.nodes },
      {
        schema: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? [{ name: "title", type: "text" }]
              : undefined,
        },
        entry: { collection: "pages" },
      }
    ).filter(issue => issue.severity === "error");
    expect(errors).toEqual([]);
  });
});
