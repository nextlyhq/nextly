/**
 * Typing into a component's exposed text: where the canvas's edit goes.
 *
 * Driven through the engine's own resolver in editor mode, so the composed
 * node and its exposure map are what the canvas really holds. The edit must
 * land on the placement, under the exposure's id, and nowhere else: not on
 * the component, not on another placement of it.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ResolvedBlockNode,
  walkNodes,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  composedTextAt,
  exposedPassage,
  exposedRichOp,
  exposedTextOp,
} from "./exposed-inline";
import { applyOps } from "./ops";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        render: () => null,
        props: {
          text: { type: "text", inline: true, role: "content" },
          kicker: { type: "text", inline: true, role: "content" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => clearBlocks());

const HEADER: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "h",
      type: "acme/heading",
      version: 1,
      props: { text: "Site name", kicker: "Welcome" },
    },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "h",
      propPath: "text",
      type: "text",
    },
  ],
};

const placed = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "header" },
  ...extra,
});

const LOOKUP = new Map<string, BlockDocument>([["header", HEADER]]);

function setUp(...nodes: BlockNode[]) {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const composed = resolveComponentInstances(document, LOOKUP, {
    exposures: true,
  }).document;
  const headingOf = (placementId: string) =>
    composed.nodes.find(
      (entry: ResolvedBlockNode) => entry.instanceOf === placementId
    )?.id ?? "";
  return { document, composed, headingOf };
}

describe("composedTextAt", () => {
  it("answers exposed text with its placement, exposure and shown value", () => {
    const { document, composed, headingOf } = setUp(placed("p1"));
    expect(composedTextAt(document, composed, headingOf("p1"), "text")).toEqual(
      {
        kind: "exposed",
        target: {
          nodeId: headingOf("p1"),
          prop: "text",
          placementId: "p1",
          exposureId: "title",
          multiline: false,
          value: "Site name",
        },
      }
    );
  });

  it("answers text the component does not expose as part of it", () => {
    const { document, composed, headingOf } = setUp(placed("p1"));
    expect(
      composedTextAt(document, composed, headingOf("p1"), "kicker")
    ).toEqual({ kind: "part-of", placementId: "p1" });
  });

  it("answers exposed text of a placement locked in Layers as part of it", () => {
    const { document, composed, headingOf } = setUp(
      placed("p1", { locked: true })
    );
    expect(
      composedTextAt(document, composed, headingOf("p1"), "text")?.kind
    ).toBe("part-of");
  });

  it("answers exposed text of a placement inside a block locked in Layers as part of it", () => {
    // The lock covers everything inside the block that holds it, a placement
    // included, so its exposed text is not editable in place either.
    const frame = (locked: boolean): BlockNode => ({
      id: "frame",
      type: "acme/heading",
      version: 1,
      props: {},
      ...(locked ? { locked: true } : {}),
      slots: { children: [placed("p1")] },
    });
    const kindIn = (locked: boolean) => {
      const { document, composed } = setUp(frame(locked));
      let heading = "";
      walkNodes(composed.nodes, entry => {
        if ((entry as ResolvedBlockNode).instanceOf === "p1")
          heading = entry.id;
      });
      return composedTextAt(document, composed, heading, "text")?.kind;
    };
    expect(kindIn(true)).toBe("part-of");
    // The control: the same placement with nothing locked around it.
    expect(kindIn(false)).toBe("exposed");
  });

  it("leaves the page's own nodes to the ordinary inline edit", () => {
    const own: BlockNode = {
      id: "own",
      type: "acme/heading",
      version: 1,
      props: { text: "Mine" },
    };
    const { document, composed } = setUp(own, placed("p1"));
    expect(composedTextAt(document, composed, "own", "text")).toBe(null);
  });

  it("answers nothing without the composition", () => {
    const { document, headingOf } = setUp(placed("p1"));
    expect(composedTextAt(document, undefined, headingOf("p1"), "text")).toBe(
      null
    );
  });
});

describe("exposed text inside an area locked to its content", () => {
  it("edits a content prop there, and answers a design prop as part of the component", () => {
    registerBlocks(
      [
        {
          name: "acme/sealed",
          version: 1,
          description: "A sealed box.",
          example: { props: {} },
          render: () => null,
          slots: {
            body: {
              defaultBlock: [{ type: "acme/heading" }],
              lock: "contentOnly",
            },
          },
        },
        {
          name: "acme/tagline",
          version: 1,
          description: "A tagline whose words are its design.",
          example: { props: {} },
          render: () => null,
          props: { motto: { type: "text", inline: true } },
        },
      ] as never,
      { source: "acme-sealed" }
    );
    const sealed: ComponentDocument = {
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
                id: "h",
                type: "acme/heading",
                version: 1,
                props: { text: "Site name" },
              },
              {
                id: "m",
                type: "acme/tagline",
                version: 1,
                props: { motto: "Always" },
              },
            ],
          },
        },
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h",
          propPath: "text",
          type: "text",
        },
        {
          id: "motto",
          label: "Motto",
          nodeId: "m",
          propPath: "motto",
          type: "text",
        },
      ],
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [{ ...placed("p1"), props: { componentId: "sealed" } }],
    };
    const composed = resolveComponentInstances(
      document,
      new Map([["sealed", sealed as BlockDocument]]),
      { exposures: true }
    ).document;
    const idOf = (type: string) => {
      const box = composed.nodes[0] as ResolvedBlockNode;
      return box.slots?.body?.find(entry => entry.type === type)?.id ?? "";
    };

    expect(
      composedTextAt(document, composed, idOf("acme/heading"), "text")?.kind
    ).toBe("exposed");
    expect(
      composedTextAt(document, composed, idOf("acme/tagline"), "motto")
    ).toEqual({ kind: "part-of", placementId: "p1", heldExposureId: "motto" });
  });
});

describe("a number stored where text is exposed", () => {
  it("is edited as the text the page draws, and an untouched edit writes nothing", () => {
    const numbered: ComponentDocument = {
      ...HEADER,
      nodes: [
        { id: "h", type: "acme/heading", version: 1, props: { text: 2024 } },
      ],
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [placed("p1")],
    };
    const composed = resolveComponentInstances(
      document,
      new Map([["header", numbered as BlockDocument]]),
      { exposures: true }
    ).document;
    const answer = composedTextAt(
      document,
      composed,
      composed.nodes[0]?.id ?? "",
      "text"
    );
    if (answer?.kind !== "exposed") throw new Error("expected exposed text");
    expect(answer.target.value).toBe("2024");
    expect(exposedTextOp(document, answer.target, "2024")).toBe(null);
  });
});

describe("a text prop another kind of exposure feeds", () => {
  it("is not typed into on the canvas: a choice keeps its options in the panel", () => {
    const toned: ComponentDocument = {
      ...HEADER,
      exposed: [
        {
          id: "tone",
          label: "Tone",
          nodeId: "h",
          propPath: "kicker",
          type: "select",
          options: [{ value: "Welcome", label: "Welcome" }],
        },
      ],
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [placed("p1")],
    };
    const composed = resolveComponentInstances(
      document,
      new Map([["header", toned as BlockDocument]]),
      { exposures: true }
    ).document;
    const id = composed.nodes[0]?.id ?? "";
    expect(composedTextAt(document, composed, id, "kicker")).toEqual({
      kind: "part-of",
      placementId: "p1",
    });
  });
});

describe("exposedTextOp", () => {
  it("stores the typed text on that placement only, leaving the component and its other placement alone", () => {
    const { document, composed, headingOf } = setUp(placed("p1"), placed("p2"));
    const answer = composedTextAt(document, composed, headingOf("p1"), "text");
    if (answer?.kind !== "exposed") throw new Error("expected exposed text");
    const op = exposedTextOp(document, answer.target, "Acme");
    if (op === null) throw new Error("expected an op");
    const after = applyOps(document, [op]).document;

    expect(findNode(after.nodes, "p1")?.props).toEqual({
      componentId: "header",
      overrides: { title: "Acme" },
    });
    expect(findNode(after.nodes, "p2")?.props).toEqual({
      componentId: "header",
    });
    expect(HEADER.nodes[0]?.props.text).toBe("Site name");
  });

  it("clears the field when the text is emptied", () => {
    const { document, composed, headingOf } = setUp(placed("p1"));
    const answer = composedTextAt(document, composed, headingOf("p1"), "text");
    if (answer?.kind !== "exposed") throw new Error("expected exposed text");
    const op = exposedTextOp(document, answer.target, "");
    if (op === null) throw new Error("expected an op");
    expect(
      findNode(applyOps(document, [op]).document.nodes, "p1")?.props
    ).toMatchObject({ overrides: { title: { $unset: true } } });
  });

  it("writes nothing for unchanged text", () => {
    const { document, composed, headingOf } = setUp(placed("p1"));
    const answer = composedTextAt(document, composed, headingOf("p1"), "text");
    if (answer?.kind !== "exposed") throw new Error("expected exposed text");
    expect(exposedTextOp(document, answer.target, "Site name")).toBe(null);
  });
});

describe("exposed text of a block the component locks in Layers", () => {
  it("answers it as held, by the exposure the panel holds, and leaves the free text editable", () => {
    const locked: ComponentDocument = {
      ...HEADER,
      nodes: [
        { ...HEADER.nodes[0]!, locked: true, name: "Hero" },
        {
          id: "k",
          type: "acme/heading",
          version: 1,
          props: { text: "Free" },
        },
      ],
      exposed: [
        ...(HEADER.exposed ?? []),
        {
          id: "strap",
          label: "Strap",
          nodeId: "k",
          propPath: "text",
          type: "text",
        },
      ],
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [placed("p1")],
    };
    const composed = resolveComponentInstances(
      document,
      new Map([["header", locked as BlockDocument]]),
      { exposures: true }
    ).document;
    const [hero, free] = composed.nodes as ResolvedBlockNode[];

    expect(composedTextAt(document, composed, hero!.id, "text")).toEqual({
      kind: "part-of",
      placementId: "p1",
      heldExposureId: "title",
    });
    expect(composedTextAt(document, composed, free!.id, "text")?.kind).toBe(
      "exposed"
    );
  });
});

describe("a component's exposed rich text, edited on the canvas", () => {
  /** A passage of one paragraph. */
  const passage = (text: string) => ({
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
      ],
    },
  });
  const CARD: ComponentDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "c",
        type: "acme/card",
        version: 1,
        props: { body: passage("From the component") },
      },
    ],
    exposed: [
      {
        id: "intro",
        label: "Intro",
        nodeId: "c",
        propPath: "body",
        type: "richText",
      },
    ],
  };

  beforeEach(() => {
    registerBlocks(
      [
        {
          name: "acme/card",
          version: 1,
          description: "A card.",
          example: { props: {} },
          render: () => null,
          props: {
            body: { type: "richText", inline: true, role: "content" },
          },
        },
      ] as never,
      { source: "acme-card" }
    );
  });

  function setUpCard(...nodes: BlockNode[]) {
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    };
    const composed = resolveComponentInstances(
      document,
      new Map<string, BlockDocument>([["card", CARD]]),
      { exposures: true }
    ).document;
    const cardOf = (placementId: string) =>
      composed.nodes.find(
        (entry: ResolvedBlockNode) => entry.instanceOf === placementId
      )?.id ?? "";
    return { document, composed, cardOf };
  }
  const card = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card" },
    ...extra,
  });

  it("answers an exposed passage with its placement and exposure", () => {
    const { document, composed, cardOf } = setUpCard(card("p1"));
    expect(composedTextAt(document, composed, cardOf("p1"), "body")).toEqual({
      kind: "exposed-rich",
      target: {
        nodeId: cardOf("p1"),
        prop: "body",
        placementId: "p1",
        exposureId: "intro",
      },
    });
  });

  it("answers an exposed passage of a placement locked in Layers as part of it", () => {
    const { document, composed, cardOf } = setUpCard(
      card("p1", { locked: true })
    );
    expect(composedTextAt(document, composed, cardOf("p1"), "body")?.kind).toBe(
      "part-of"
    );
  });

  it("reads the passage the page shows, and none once it stops being editable", () => {
    const { document, composed, cardOf } = setUpCard(card("p1"));
    const target = {
      nodeId: cardOf("p1"),
      prop: "body",
      placementId: "p1",
      exposureId: "intro",
    };
    expect(exposedPassage(document, composed, target)?.stored).toEqual(
      passage("From the component")
    );
    const locked = setUpCard(card("p1", { locked: true }));
    expect(exposedPassage(locked.document, locked.composed, target)).toBeNull();
  });

  it("stores the edit on that placement only, as one op", () => {
    const { document, composed, cardOf } = setUpCard(card("p1"), card("p2"));
    const target = {
      nodeId: cardOf("p1"),
      prop: "body",
      placementId: "p1",
      exposureId: "intro",
    };
    const opened = passage("From the component");
    const op = exposedRichOp(
      document,
      composed,
      target,
      passage("Ours"),
      opened,
      opened
    );
    expect(op).not.toBeNull();
    const after = applyOps(document, op === null ? [] : [op]).document;
    expect(
      (findNode(after.nodes, "p1")?.props as { overrides?: unknown }).overrides
    ).toEqual({ intro: passage("Ours") });
    expect(
      (findNode(after.nodes, "p2")?.props as { overrides?: unknown }).overrides
    ).toBeUndefined();
  });

  it("writes nothing for an unchanged passage, or one the page changed meanwhile", () => {
    const { document, composed, cardOf } = setUpCard(card("p1"));
    const target = {
      nodeId: cardOf("p1"),
      prop: "body",
      placementId: "p1",
      exposureId: "intro",
    };
    const opened = passage("From the component");
    expect(
      exposedRichOp(document, composed, target, opened, opened, opened)
    ).toBeNull();
    expect(
      exposedRichOp(
        document,
        composed,
        target,
        passage("Ours"),
        opened,
        passage("Something older")
      )
    ).toBeNull();
  });
});
