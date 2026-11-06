/**
 * Which of a placement's rows a `contentOnly` lock holds, and the variant the
 * panel names.
 *
 * Driven through the engine's resolver and lock walk, with a block source of
 * the test's own: the rule is "a value that is not content, inside an area
 * locked to its content", judged by the TARGET prop's declared role, and only
 * the composed page shows where a placement's values land.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolveComponentInstances,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { inspectInstance, partOfComponentSentence } from "./instance-inspector";

const BLOCKS: SlotDefaultSource = new Map<string, AnyBlockDefinition>([
  [
    "acme/sealed",
    {
      name: "acme/sealed",
      slots: {
        body: { defaultBlock: [{ type: "acme/quote" }], lock: "contentOnly" },
      },
    } as unknown as AnyBlockDefinition,
  ],
  [
    "acme/quote",
    {
      name: "acme/quote",
      props: {
        words: { type: "text", role: "content" },
        tone: {
          type: "select",
          options: [
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
        },
      },
    } as unknown as AnyBlockDefinition,
  ],
]);

/** A quote inside a `contentOnly` area, exposing its words and its tone. */
const SEALED: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "s",
      type: "acme/sealed",
      version: 1,
      props: {},
      slots: {
        body: [
          {
            id: "q",
            type: "acme/quote",
            version: 1,
            props: { words: "Hi", tone: "light" },
          },
        ],
      },
    },
    {
      id: "free",
      type: "acme/quote",
      version: 1,
      props: { words: "Outside" },
    },
  ],
  exposed: [
    {
      id: "quoteShown",
      label: "Quote shown",
      nodeId: "q",
      propPath: "visibility",
      type: "visibility",
    },
    {
      id: "freeShown",
      label: "Outside shown",
      nodeId: "free",
      propPath: "visibility",
      type: "visibility",
    },
    {
      id: "words",
      label: "Words",
      nodeId: "q",
      propPath: "words",
      type: "text",
    },
    {
      id: "tone",
      label: "Tone",
      nodeId: "q",
      propPath: "tone",
      type: "select",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
  ],
  variants: {
    v1: { label: "Dark", overrides: { tone: "dark" } },
    // Stored without the label the type requires, as an older writer left it.
    v2: { overrides: { tone: "light" } },
  },
} as unknown as ComponentDocument;

const placed = (props: Record<string, unknown> = {}): BlockNode => ({
  id: "p",
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "sealed", ...props },
});

const pageOf = (node: BlockNode): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [node],
});

function inspect(node: BlockNode, exposures = true) {
  const document = pageOf(node);
  const lookup = new Map([["sealed", SEALED as BlockDocument]]);
  const composed = resolveComponentInstances(document, lookup, {
    exposures,
  }).document;
  return inspectInstance(document, "p", lookup, [], {
    definitions: BLOCKS,
    composed,
  });
}

describe("rows a contentOnly lock holds", () => {
  it("holds a row driving a non-content prop and leaves the content row editable", () => {
    const rows = inspect(placed())?.rows ?? [];
    const words = rows.find(row => row.id === "words");
    const tone = rows.find(row => row.id === "tone");
    expect(words?.heldBy).toBe(undefined);
    expect(tone?.heldBy?.headline).toContain("is locked to its content");
  });

  it("holds a visibility row by the node it shows, not by any locked node of the placement", () => {
    const rows = inspect(placed())?.rows ?? [];
    expect(rows.find(row => row.id === "quoteShown")?.heldBy).toBeDefined();
    expect(rows.find(row => row.id === "freeShown")?.heldBy).toBe(undefined);
  });

  it("holds nothing without the composed page's exposure map", () => {
    const rows = inspect(placed(), false)?.rows ?? [];
    expect(rows.every(row => row.heldBy === undefined)).toBe(true);
  });
});

describe("the variant a placement uses", () => {
  it("is named by the definition's label", () => {
    expect(inspect(placed({ variant: "v1" }))?.variant).toEqual({
      key: "v1",
      label: "Dark",
    });
  });

  it("is named by its key when the definition gives it no label", () => {
    expect(inspect(placed({ variant: "v2" }))?.variant).toEqual({
      key: "v2",
      label: "v2",
    });
  });

  it("is said to be gone when the definition no longer offers it", () => {
    expect(inspect(placed({ variant: "gone" }))?.variant).toEqual({
      key: "gone",
    });
  });

  it("is absent when the placement chose none", () => {
    expect(inspect(placed())?.variant).toBe(undefined);
  });
});

describe("the sentence a double-click on unexposed text raises", () => {
  it("names the component and the variant, and points at the panel", () => {
    const inspection = inspect(placed({ variant: "v1" }));
    if (inspection === null) throw new Error("expected an inspection");
    expect(partOfComponentSentence({ ...inspection, label: "Header" })).toBe(
      "Part of Header, Dark variant. Its fields are in the panel; the rest is edited on the component itself."
    );
  });

  it("names no variant when the placement uses none, and says where content is when nothing is exposed", () => {
    expect(partOfComponentSentence({ label: "Footer", rows: [] })).toBe(
      "Part of Footer. Its content is edited on the component itself."
    );
  });
});

describe("rows a component's Layers lock holds", () => {
  /** The same quote and an outside block, the quote locked in Layers. */
  const LOCKED = {
    ...SEALED,
    nodes: [
      {
        ...SEALED.nodes[0],
        type: "acme/quote",
        slots: undefined,
        id: "q",
        locked: true,
        name: "Hero",
      },
      SEALED.nodes[1],
    ],
    variants: undefined,
  } as unknown as ComponentDocument;
  const outside = {
    id: "outside",
    label: "Outside",
    nodeId: "free",
    propPath: "words",
    type: "text",
  };

  it("holds a row driving the locked block, naming the component, and leaves the free block's row", () => {
    const document = pageOf(placed());
    const definition = {
      ...LOCKED,
      exposed: [...(LOCKED.exposed ?? []), outside],
    } as unknown as BlockDocument;
    const lookup = new Map([["sealed", definition]]);
    const composed = resolveComponentInstances(document, lookup, {
      exposures: true,
    }).document;
    const rows =
      inspectInstance(
        document,
        "p",
        lookup,
        [{ id: "sealed", title: "Promo" } as never],
        { definitions: BLOCKS, composed }
      )?.rows ?? [];

    expect(rows.find(row => row.id === "words")?.heldBy).toEqual({
      headline: "Set by the component Promo.",
      remedy: "Change it where the component is edited.",
    });
    expect(rows.find(row => row.id === "outside")?.heldBy).toBe(undefined);
  });
});
