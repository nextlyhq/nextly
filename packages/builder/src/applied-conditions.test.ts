/**
 * The page with its visibility conditions applied for the entry a template is
 * previewed with: each block that reads the entry judged as the published
 * page judges it, a hidden one drawn as a marker naming why.
 */
import {
  COLLECTION_LIST_TYPE,
  COMPONENT_INSTANCE_TYPE,
  CONDITION_HIDDEN_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  LIST_ENTRY_SLOT,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  appliedConditionsOf,
  conditionedBlocksIn,
  itemHiddenAsOf,
  revealedForCanvas,
  type ConditionsPreview,
} from "./applied-conditions";
import { conditionFieldsOfShapes } from "./condition-model";
import { conditionsPreviewOf } from "./use-applied-conditions";

const FIELDS: readonly BindingFieldShape[] = [
  { name: "category", type: "text" },
  { name: "readingTime", type: "number" },
];

/** The entry as a visitor reads it, with these published values. */
function previewFor(
  values: Readonly<Record<string, unknown>> | undefined
): ConditionsPreview {
  return {
    subject:
      values === undefined
        ? undefined
        : {
            fields: {
              declared: new Set(FIELDS.map(field => field.name)),
              readable: FIELDS,
            },
            values,
          },
    noun: "post",
    fields: conditionFieldsOfShapes(FIELDS).map(field =>
      field.name === "category" ? { ...field, label: "Category" } : field
    ),
  };
}

function block(id: string, extra: Partial<BlockNode> = {}): BlockNode {
  return { id, type: "core/text", version: 1, props: {}, ...extra };
}

const guides = { field: "category", op: "equals", value: "Guides" };
const long = { field: "readingTime", op: "greater_than", value: 5 };

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "template", nodes };
}

const worksheet = block("worksheet", {
  visibility: { conditions: [[guides]] },
});

const nameOf = (node: BlockNode): string =>
  node.id === "worksheet" ? "Members’ worksheet" : node.id;

describe("the page with its conditions applied", () => {
  it("draws a block whose conditions hold as itself, with its conditions lifted", () => {
    const applied = appliedConditionsOf(
      page(worksheet),
      previewFor({ category: "Guides" }),
      nameOf
    );
    expect([...applied.shown]).toEqual(["worksheet"]);
    expect(applied.hidden).toEqual([]);
    expect(applied.unjudged).toBe(false);
    expect(applied.document.nodes[0]).toMatchObject({
      id: "worksheet",
      type: "core/text",
    });
    // Lifted, so the renderer draws it rather than leaving it out.
    expect(applied.document.nodes[0]?.visibility).toBeUndefined();
  });

  it("draws a block whose conditions fail as a marker with its id, naming the condition that fails", () => {
    const applied = appliedConditionsOf(
      page(block("intro"), worksheet),
      previewFor({ category: "News" }),
      nameOf
    );
    expect(applied.shown.size).toBe(0);
    expect(applied.hidden).toEqual([
      {
        id: "worksheet",
        name: "Members’ worksheet",
        reason: "hidden for this post: Category is not Guides",
        unchecked: false,
      },
    ]);
    // In its place, keeping its id, so the canvas selects the block.
    expect(applied.document.nodes.map(node => node.type)).toEqual([
      "core/text",
      CONDITION_HIDDEN_TYPE,
    ]);
    expect(applied.document.nodes[1]).toMatchObject({
      id: "worksheet",
      props: { name: "Members’ worksheet", unchecked: false },
    });
  });

  it("names the first failing condition and counts the rest, an order said with isn't", () => {
    const both = block("worksheet", {
      visibility: { conditions: [[long, guides]] },
    });
    const applied = appliedConditionsOf(
      page(both),
      previewFor({ category: "News", readingTime: 2 }),
      nameOf
    );
    expect(applied.hidden[0]?.reason).toBe(
      "hidden for this post: readingTime isn’t more than 5, and 1 more"
    );
  });

  it("hides every conditioned block for an entry a visitor reads none of, saying so", () => {
    const applied = appliedConditionsOf(
      page(worksheet),
      previewFor(undefined),
      nameOf
    );
    expect(applied.hidden[0]).toMatchObject({
      reason: "hidden: this post isn’t published yet",
      unchecked: false,
    });
  });

  it("hides a block whose conditions can't be checked, as the published page does, marked so", () => {
    const secret = block("worksheet", {
      visibility: { conditions: [[{ field: "secret", op: "exists" }]] },
    });
    const applied = appliedConditionsOf(
      page(secret),
      previewFor({ category: "Guides" }),
      nameOf
    );
    expect(applied.hidden[0]).toMatchObject({
      reason: "can’t be checked, so visitors never see it",
      unchecked: true,
    });
    expect(applied.document.nodes[0]).toMatchObject({
      type: CONDITION_HIDDEN_TYPE,
      props: { unchecked: true },
    });
  });

  it("leaves a block in a list's per-entry slot unjudged, drawn as when conditions aren't applied", () => {
    const featured = block("featured", {
      visibility: { conditions: [[guides]] },
    });
    const list = block("list", {
      type: COLLECTION_LIST_TYPE,
      props: { collection: "posts" },
      slots: { [LIST_ENTRY_SLOT]: [featured] },
    });
    const applied = appliedConditionsOf(
      page(list),
      previewFor({ category: "News" }),
      nameOf
    );
    // It reads each drawn item, not the previewed entry, and is said to be
    // unjudged, so nothing claims every conditioned block shows.
    expect(applied.shown.size).toBe(0);
    expect(applied.hidden).toEqual([]);
    expect(applied.unjudged).toBe(true);
    const drawn = applied.document.nodes[0]?.slots?.[LIST_ENTRY_SLOT]?.[0];
    expect(drawn).toMatchObject({ id: "featured", type: "core/text" });
    expect(drawn?.visibility).toBeUndefined();
  });

  it("keeps a list item's block's conditions for the renderer where the lists draw what a visitor reads", () => {
    const featured = block("featured", {
      visibility: { conditions: [[guides]], devices: { mobile: false } },
    });
    const intro = block("intro", { visibility: { conditions: [[guides]] } });
    const list = block("list", {
      type: COLLECTION_LIST_TYPE,
      props: { collection: "posts" },
      slots: { [LIST_ENTRY_SLOT]: [featured] },
    });
    const applied = appliedConditionsOf(
      page(intro, list),
      previewFor({ category: "Guides" }),
      nameOf,
      { itemsJudged: true }
    );
    // Judged for each item drawn, so nothing is left unjudged.
    expect(applied.unjudged).toBe(false);
    expect(applied.byEntry).toBe(true);
    expect(applied.shown).toEqual(new Set(["intro"]));
    // The page's own shown block is lifted, as before; the item's keeps its
    // conditions, and its devices, for the renderer to judge per item.
    expect(applied.document.nodes[0]?.visibility).toBeUndefined();
    const drawn = applied.document.nodes[1]?.slots?.[LIST_ENTRY_SLOT]?.[0];
    expect(drawn?.visibility).toEqual({
      conditions: [[guides]],
      devices: { mobile: false },
    });
  });
});

describe("the page with its conditions applied, as the canvas draws it", () => {
  it("keeps a hidden block's device hiding on its marker", () => {
    const mobileOff = block("worksheet", {
      visibility: { conditions: [[guides]], devices: { mobile: false } },
    });
    const applied = appliedConditionsOf(
      page(mobileOff),
      previewFor({ category: "News" }),
      nameOf
    );
    // Hidden on mobile whatever its conditions say, so its marker is too.
    expect(applied.document.nodes[0]).toMatchObject({
      type: CONDITION_HIDDEN_TYPE,
      visibility: { devices: { mobile: false } },
    });
    expect(JSON.stringify(applied.document.nodes[0])).not.toContain(
      "conditions"
    );
  });

  it("judges every block under a raised node limit, and none past the limit given", () => {
    // 5,000 blocks ahead of the conditioned one: past the default limit.
    const filler = Array.from({ length: 5_000 }, (_, index) =>
      block(`filler-${String(index)}`)
    );
    const document = page(...filler, worksheet);
    const raised = appliedConditionsOf(
      document,
      previewFor({ category: "News" }),
      nameOf,
      { limits: { ...DEFAULT_LIMITS, maxNodes: 10_000 } }
    );
    expect(raised.hidden.map(each => each.id)).toEqual(["worksheet"]);
    const defaults = appliedConditionsOf(
      document,
      previewFor({ category: "News" }),
      nameOf
    );
    expect(defaults.hidden).toEqual([]);
  });

  it("never draws a marker for a node the renderer drops", () => {
    // A stored node with an id and conditions but no type: the renderer's
    // repair drops it, so applying conditions must not bring it back.
    const corrupt = JSON.parse(
      JSON.stringify({ id: "corrupt", visibility: { conditions: [[guides]] } })
    ) as BlockNode;
    const applied = appliedConditionsOf(
      page(corrupt, worksheet),
      previewFor({ category: "News" }),
      nameOf
    );
    expect(applied.hidden.map(each => each.id)).toEqual(["worksheet"]);
    expect(
      applied.document.nodes.filter(node => node.type === CONDITION_HIDDEN_TYPE)
    ).toHaveLength(1);
  });

  it("judges a placed component's conditioned blocks for the entry, as the route does", () => {
    const placed = block("placed", {
      type: COMPONENT_INSTANCE_TYPE,
      props: { componentId: "promo" },
    });
    const definitions = new Map([
      [
        "promo",
        {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [worksheet],
        } as BlockDocument,
      ],
    ]);
    const passing = appliedConditionsOf(
      page(placed),
      previewFor({ category: "Guides" }),
      nameOf,
      { definitions }
    );
    // Judged, so nothing is left unjudged: shown, by the id it is drawn under.
    expect(passing.unjudged).toBe(false);
    expect(passing.hidden).toEqual([]);
    expect(passing.shown.size).toBe(1);
    expect(passing.shown.has("worksheet")).toBe(false);
    const failing = appliedConditionsOf(
      page(placed),
      previewFor({ category: "News" }),
      nameOf,
      { definitions }
    );
    expect(failing.shown.size).toBe(0);
    expect(failing.hidden).toHaveLength(1);
    expect(failing.hidden[0]).toMatchObject({
      reason: "hidden for this post: Category is not Guides",
      unchecked: false,
    });
    // The canvas draws its marker in its place, keeping its placement.
    const composed = {
      ...worksheet,
      id: failing.hidden[0]?.id ?? "",
      instanceOf: "placed",
    } as BlockNode;
    expect(failing.entryJudgement.hiddenAs(composed)).toMatchObject({
      id: composed.id,
      type: CONDITION_HIDDEN_TYPE,
      instanceOf: "placed",
    });
    // A component with no conditioned block leaves nothing unjudged.
    const plain = appliedConditionsOf(
      page(placed),
      previewFor({ category: "Guides" }),
      nameOf,
      {
        definitions: new Map([
          [
            "promo",
            {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [block("plain")],
            } as BlockDocument,
          ],
        ]),
      }
    );
    expect(plain.unjudged).toBe(false);
  });

  it("draws a duplicate id without the hidden block's conditions as itself", () => {
    // Stored data may repeat an id; only the occurrence whose conditions
    // fail becomes the marker.
    const twin = block("worksheet");
    const applied = appliedConditionsOf(
      page(worksheet, twin),
      previewFor({ category: "News" }),
      nameOf
    );
    expect(applied.document.nodes.map(node => node.type)).toEqual([
      CONDITION_HIDDEN_TYPE,
      "core/text",
    ]);
  });

  it("judges a component reached through another, and leaves a Layout region's unjudged", () => {
    const inner = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [worksheet],
    } as BlockDocument;
    const outer = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        block("nested", {
          type: COMPONENT_INSTANCE_TYPE,
          props: { componentId: "inner" },
        }),
      ],
    } as BlockDocument;
    const placed = block("placed", {
      type: COMPONENT_INSTANCE_TYPE,
      props: { componentId: "outer" },
    });
    const definitions = new Map([
      ["outer", outer],
      ["inner", inner],
    ]);
    // Reached as the resolver reaches it: the page places outer, which
    // places inner, which holds the conditioned block, judged there.
    const reached = appliedConditionsOf(
      page(placed),
      previewFor({ category: "News" }),
      nameOf,
      { definitions }
    );
    expect(reached.unjudged).toBe(false);
    expect(reached.hidden).toHaveLength(1);
    // A region of the page's Layout placing a conditioned component.
    const region = {
      document: page(
        block("region", {
          type: COMPONENT_INSTANCE_TYPE,
          props: { componentId: "inner" },
        })
      ),
      definitions: new Map([["inner", inner]]),
    };
    expect(
      appliedConditionsOf(
        page(block("plain")),
        previewFor({ category: "Guides" }),
        nameOf,
        {
          regions: [region],
        }
      ).unjudged
    ).toBe(true);
    expect(
      appliedConditionsOf(
        page(block("plain")),
        previewFor({ category: "Guides" }),
        nameOf
      ).unjudged
    ).toBe(false);
  });

  it("starts a day where the published page does, in the site's zone", () => {
    // Published at 23:30 UTC on 1 March: already 2 March in Tokyo.
    const fields: readonly BindingFieldShape[] = [
      { name: "publishedAt", type: "date" },
    ];
    const late = block("worksheet", {
      visibility: {
        conditions: [
          [{ field: "publishedAt", op: "less_than", value: "2026-03-02" }],
        ],
      },
    });
    const judged = (timeZone: string | undefined) =>
      appliedConditionsOf(
        page(late),
        conditionsPreviewOf(
          {
            kind: "entry",
            collection: "posts",
            id: "p1",
            title: "Post",
            publicValues: { publishedAt: "2026-03-01T23:30:00.000Z" },
            editorValues: {},
            fields,
          },
          "post",
          undefined,
          timeZone
        ) ?? previewFor(undefined),
        nameOf
      );
    // Before 2 March in UTC, so shown; not before it in Tokyo, so hidden.
    expect([...judged(undefined).shown]).toEqual(["worksheet"]);
    expect(judged("Asia/Tokyo").hidden.map(each => each.id)).toEqual([
      "worksheet",
    ]);
  });
});

describe("the conditioned blocks a page holds with its components", () => {
  it("counts a placed component's own conditioned blocks, in the scope they are drawn in", () => {
    const placed = block("placed", {
      type: COMPONENT_INSTANCE_TYPE,
      props: { componentId: "promo" },
    });
    const definitions = new Map([
      [
        "promo",
        {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [worksheet],
        } as BlockDocument,
      ],
    ]);
    // CONTROL: the page alone holds no conditioned block.
    expect(conditionedBlocksIn(page(placed)).any).toBe(false);
    expect(conditionedBlocksIn(page(placed), undefined, definitions)).toEqual({
      any: true,
      readingEntry: true,
      readingItems: false,
    });
  });
});

describe("a conditioned placement inside a placed component", () => {
  // The page places outer; outer places inner under conditions of its own;
  // inner's root has none, so the placement's gate is carried onto it.
  const inner = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [block("offer")],
  } as BlockDocument;
  const outer = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      block("nested", {
        type: COMPONENT_INSTANCE_TYPE,
        props: { componentId: "inner" },
        visibility: { conditions: [[guides]] },
      }),
    ],
  } as BlockDocument;
  const definitions = new Map([
    ["outer", outer],
    ["inner", inner],
  ]);
  const placed = page(
    block("placed", {
      type: COMPONENT_INSTANCE_TYPE,
      props: { componentId: "outer" },
    })
  );

  it("is a condition the page holds, so the switch is offered", () => {
    // CONTROL: read without the definitions, the page holds none.
    expect(conditionedBlocksIn(placed).readingEntry).toBe(false);
    expect(
      conditionedBlocksIn(placed, undefined, definitions).readingEntry
    ).toBe(true);
  });

  it("names the placement's condition that hides the block", () => {
    const applied = appliedConditionsOf(
      placed,
      previewFor({ category: "News" }),
      nameOf,
      { definitions }
    );
    expect(applied.hidden).toHaveLength(1);
    expect(applied.hidden[0]?.reason).toBe(
      "hidden for this post: Category is not Guides"
    );
  });
});

describe("the conditioned blocks a document holds", () => {
  it("tells a block reading the entry from one only a list's items read", () => {
    expect(conditionedBlocksIn(page(worksheet))).toEqual({
      any: true,
      readingEntry: true,
      readingItems: false,
    });
    const list = block("list", {
      type: COLLECTION_LIST_TYPE,
      props: { collection: "posts" },
      slots: { [LIST_ENTRY_SLOT]: [worksheet] },
    });
    expect(conditionedBlocksIn(page(list))).toEqual({
      any: true,
      readingEntry: false,
      readingItems: true,
    });
    expect(conditionedBlocksIn(page(worksheet, list))).toEqual({
      any: true,
      readingEntry: true,
      readingItems: true,
    });
    expect(conditionedBlocksIn(page(block("plain")))).toEqual({
      any: false,
      readingEntry: false,
      readingItems: false,
    });
  });
});

describe("what the canvas draws where a list's item hides a block", () => {
  const hiddenAs = itemHiddenAsOf({
    fieldsOf: collection => (collection === "posts" ? FIELDS : undefined),
    labelledOf: collection =>
      collection === "posts"
        ? conditionFieldsOfShapes(FIELDS).map(field =>
            field.name === "category" ? { ...field, label: "Category" } : field
          )
        : undefined,
    nameOf: () => "Guide badge",
  });
  const badge = block("badge", {
    visibility: { conditions: [[guides]], devices: { mobile: false } },
  });

  it("is the block's marker, saying why this entry hides it, on the block's devices", () => {
    const marker = hiddenAs(badge, {
      values: { category: "News" },
      collection: "posts",
      fields: FIELDS,
    });
    expect(marker).toEqual({
      id: "badge",
      type: CONDITION_HIDDEN_TYPE,
      version: 1,
      props: {
        name: "Guide badge",
        reason: "hidden for this entry: Category is not Guides",
        unchecked: false,
      },
      visibility: { devices: { mobile: false } },
    });
  });

  it("says the block can't be checked for an item whose fields are not known", () => {
    for (const collection of ["authors", undefined]) {
      const marker = hiddenAs(badge, {
        values: { category: "News" },
        collection,
        fields: undefined,
      });
      expect(marker?.props).toEqual({
        name: "Guide badge",
        reason: "can’t be checked, so visitors never see it",
        unchecked: true,
      });
    }
  });

  it("draws nothing for an item its conditions hold for", () => {
    expect(
      hiddenAs(badge, {
        values: { category: "Guides" },
        collection: "posts",
        fields: FIELDS,
      })
    ).toBeUndefined();
  });

  it("is drawn for a component's root a placement's carried gate hides", () => {
    // A conditioned placement inside a list's entries: composition carries
    // its gate onto the component's root, which has no conditions of its own.
    const root = block("root", {
      visibility: {
        within: [{ conditions: [[guides]] }],
      } as unknown as BlockNode["visibility"],
    });
    const marker = hiddenAs(root, {
      values: { category: "News" },
      collection: "posts",
      fields: FIELDS,
    });
    expect(marker).toMatchObject({ id: "root", type: CONDITION_HIDDEN_TYPE });
    expect(
      hiddenAs(root, {
        values: { category: "Guides" },
        collection: "posts",
        fields: FIELDS,
      })
    ).toBeUndefined();
  });

  it("judges a named query's row by the fields the renderer judged it by", () => {
    // A row of a query with its own schema: no collection, its fields
    // handed over by the renderer, which just judged it with them.
    const marker = hiddenAs(badge, {
      values: { category: "News" },
      collection: undefined,
      fields: FIELDS,
    });
    expect(marker?.props).toMatchObject({ unchecked: false });
    expect(String(marker?.props.reason)).toMatch(/^hidden for this entry: /);
  });
});

describe("the page as the canvas draws it", () => {
  const featured = block("featured", {
    visibility: { conditions: [[guides]] },
  });
  const intro = block("intro", { visibility: { conditions: [[guides]] } });
  const list = block("list", {
    type: COLLECTION_LIST_TYPE,
    props: { collection: "posts" },
    slots: { [LIST_ENTRY_SLOT]: [featured] },
  });

  it("lifts every block's conditions while a list's entries are not judged", () => {
    for (const applied of [undefined, { byEntry: false }]) {
      const drawn = revealedForCanvas(page(intro, list), applied);
      expect(drawn.nodes[0]?.visibility).toBeUndefined();
      expect(
        drawn.nodes[1]?.slots?.[LIST_ENTRY_SLOT]?.[0]?.visibility
      ).toBeUndefined();
    }
  });

  it("keeps a list entry's block's conditions while the entries are judged", () => {
    const drawn = revealedForCanvas(page(intro, list), { byEntry: true });
    expect(drawn.nodes[0]?.visibility).toBeUndefined();
    expect(drawn.nodes[1]?.slots?.[LIST_ENTRY_SLOT]?.[0]?.visibility).toEqual({
      conditions: [[guides]],
    });
  });
});
