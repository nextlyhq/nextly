/**
 * Planning "Turn into": what a turned block keeps whatever its type, and what
 * it loses.
 *
 * Asked of definitions handed in rather than the registry, so each rule is
 * pinned against blocks that differ in exactly the way it is about: a style
 * one block supports and the other does not, a prop that takes words beside
 * one that takes rich text.
 */
import { describe, expect, it } from "vitest";

import type { AnyBlockDefinition, BlockConverter } from "./block";
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { applyOp } from "./ops";
import type { NamedClass } from "./style/named-class";
import { planTurnInto, turnIntoTargets, type TurnIntoPlan } from "./turn-into";

/** Words to words; the converter copies them and says nothing is lost. */
const TO_TITLE: BlockConverter = {
  carries: { words: "title" },
  convert: props => ({ props: { title: props.words, size: "big" } }),
};

/** Words to a passage, whose prop takes rich text: a binding cannot move. */
const TO_PASSAGE: BlockConverter = {
  carries: { words: "passage" },
  convert: props => ({
    props: { passage: { root: { type: "root", children: [] } } },
    dropped: String(props.words).includes("*")
      ? "Stars are removed"
      : undefined,
  }),
};

function definition(
  over: Partial<AnyBlockDefinition> & Pick<AnyBlockDefinition, "name">
): AnyBlockDefinition {
  return {
    version: 1,
    description: over.name,
    example: { props: {} },
    render: () => null,
    ...over,
  } as AnyBlockDefinition;
}

const DEFINITIONS: ReadonlyMap<string, AnyBlockDefinition> = new Map(
  [
    definition({
      name: "test/words",
      editor: { label: "Words" },
      props: { words: { type: "text" }, note: { type: "text" } },
      supports: { color: true, typography: true },
      converters: {
        "test/title": TO_TITLE,
        "test/passage": TO_PASSAGE,
        "test/unregistered": TO_TITLE,
      },
    }),
    definition({
      name: "test/title",
      version: 3,
      editor: { label: "Title" },
      props: { title: { type: "text" }, note: { type: "text" } },
      supports: { color: true },
      converters: {
        "test/words": {
          convert: () => ({ refused: "Titles stay titles." }),
        },
      },
    }),
    definition({
      name: "test/passage",
      editor: { label: "Passage" },
      props: { passage: { type: "richText" } },
      supports: { color: true, typography: true },
    }),
    definition({
      name: "test/box",
      editor: { label: "Box" },
      slots: { children: {} },
      converters: { "test/title": TO_TITLE },
    }),
  ].map(each => [each.name, each])
);

const lookup = (name: string) => DEFINITIONS.get(name);

function page(node: BlockNode): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  };
}

/** A block carrying every field "Turn into" keeps, and one style it may not. */
const WORDS: BlockNode = {
  id: "w1",
  type: "test/words",
  version: 1,
  props: { words: "Hello" },
  name: "Greeting",
  classes: ["look-loud", "shared-brand"],
  visibility: {
    devices: { mobile: false },
    conditions: [[{ field: "status", op: "eq", value: "vip" }]],
  },
  styles: {
    base: {
      desktop: { color: "#c00", fontSize: "2rem" },
      mobile: { fontSize: "1rem" },
    },
    hover: { desktop: { color: "#900" } },
  },
  bindings: { words: { $bind: "title" } },
  customCss: "& { outline: 0 }",
  cssId: "greeting",
  cssClasses: "intro",
  nosnippet: true,
  attributes: { "data-x": "1" },
};

function planned(node: BlockNode, to: string): TurnIntoPlan {
  const plan = planTurnInto(page(node), node.id, to, lookup);
  if ("refused" in plan) throw new Error(plan.refused);
  return plan;
}

describe("planTurnInto", () => {
  it("writes the new type at its version, with the converter's props", () => {
    const { op } = planned(WORDS, "test/title");
    expect(op.kind).toBe("turnInto");
    expect(op.id).toBe("w1");
    expect(op.node.id).toBe("w1");
    expect(op.node.type).toBe("test/title");
    expect(op.node.version).toBe(3);
    expect(op.node.props).toEqual({ title: "Hello", size: "big" });
  });

  it("keeps the name, block style and shared styles, visibility and conditions, and Advanced settings", () => {
    const { op } = planned(WORDS, "test/title");
    expect(op.node).toMatchObject({
      name: "Greeting",
      classes: ["look-loud", "shared-brand"],
      visibility: {
        devices: { mobile: false },
        conditions: [[{ field: "status", op: "eq", value: "vip" }]],
      },
      customCss: "& { outline: 0 }",
      cssId: "greeting",
      cssClasses: "intro",
      nosnippet: true,
      attributes: { "data-x": "1" },
    });
  });

  it("keeps each style the new block supports, and only those", () => {
    // The title takes colour but not typography: its font size goes, and the
    // breakpoint holding nothing else goes with it.
    expect(planned(WORDS, "test/title").op.node.styles).toEqual({
      base: { desktop: { color: "#c00" } },
      hover: { desktop: { color: "#900" } },
    });
    // The passage takes both, so every style stays.
    expect(planned(WORDS, "test/passage").op.node.styles).toEqual(WORDS.styles);
  });

  it("keeps a binding where the new prop shows the same kind of value", () => {
    const plan = planned(WORDS, "test/title");
    expect(plan.op.node.bindings).toEqual({ title: { $bind: "title" } });
    expect(plan.unbound).toEqual([]);
  });

  it("removes a binding the new prop cannot show, and names it", () => {
    const plan = planned(WORDS, "test/passage");
    expect(plan.op.node.bindings).toBeUndefined();
    expect(plan.unbound).toEqual(["words"]);
  });

  it("removes a binding on a prop the converter does not carry", () => {
    // Both blocks have a `note` taking words, but the converter does not say
    // the one becomes the other, so its binding does not move.
    const plan = planned(
      { ...WORDS, bindings: { note: { $bind: "x" } } },
      "test/title"
    );
    expect(plan.op.node.bindings).toBeUndefined();
    expect(plan.unbound).toEqual(["note"]);
  });

  it("passes on what the converter says is lost", () => {
    expect(planned(WORDS, "test/passage").dropped).toBeUndefined();
    expect(
      planned({ ...WORDS, props: { words: "*Hi*" } }, "test/passage").dropped
    ).toBe("Stars are removed");
  });

  it("shares nothing with the block it was planned from", () => {
    const { op } = planned(WORDS, "test/title");
    expect(op.node.visibility).not.toBe(WORDS.visibility);
    expect(op.node.classes).not.toBe(WORDS.classes);
    expect(op.node.styles?.base).not.toBe(WORDS.styles?.base);
  });

  it("is an op the document takes, whose undo gives the block back", () => {
    const before = page(WORDS);
    const { op } = planned(WORDS, "test/title");
    const applied = applyOp(before, op);
    expect(applied.document.nodes[0]).toEqual(op.node);
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  describe("refusals", () => {
    it("says why the converter refuses", () => {
      const title: BlockNode = {
        id: "t1",
        type: "test/title",
        version: 3,
        props: { title: "Hi" },
      };
      expect(planTurnInto(page(title), "t1", "test/words", lookup)).toEqual({
        refused: "Titles stay titles.",
      });
    });

    it("refuses a type the block declares no converter to", () => {
      expect(planTurnInto(page(WORDS), "w1", "test/box", lookup)).toEqual({
        refused: "Words can't be turned into Box.",
      });
    });

    it("refuses a target that is not registered", () => {
      expect(
        planTurnInto(page(WORDS), "w1", "test/unregistered", lookup)
      ).toHaveProperty("refused");
    });

    it("refuses a block holding blocks, which would be lost", () => {
      const box: BlockNode = {
        id: "b1",
        type: "test/box",
        version: 1,
        props: {},
        slots: { children: [{ ...WORDS, id: "inner" }] },
      };
      expect(planTurnInto(page(box), "b1", "test/title", lookup)).toEqual({
        refused: "It holds other blocks, which would be lost.",
      });
    });

    it("refuses a block that is not in the document", () => {
      expect(
        planTurnInto(page(WORDS), "gone", "test/title", lookup)
      ).toHaveProperty("refused");
    });
  });
});

describe("a block style, which belongs to one block type", () => {
  /** The words' "Loud" look, and a shared style any block may wear. */
  const LIBRARY: NamedClass[] = [
    {
      id: "look-loud",
      slug: "loud",
      orderIndex: 0,
      blockType: "test/words",
      styles: {
        base: { desktop: { color: "#0c0", fontSize: "3rem" } },
        hover: { desktop: { color: "#f00" } },
      },
    },
    {
      id: "shared-brand",
      slug: "brand",
      orderIndex: 1,
      styles: { base: { desktop: { color: "#00c" } } },
    },
  ];

  it("is kept as the new block's own styles, under the ones it set itself, and its id goes", () => {
    const plan = planTurnInto(
      page(WORDS),
      "w1",
      "test/passage",
      lookup,
      LIBRARY
    );
    if ("refused" in plan) throw new Error(plan.refused);
    // The look's styles first, the block's own over them: its own colour
    // wins, the look's font size and hover colour come through.
    expect(plan.op.node.styles).toEqual({
      base: {
        desktop: { color: "#c00", fontSize: "2rem" },
        mobile: { fontSize: "1rem" },
      },
      hover: { desktop: { color: "#900" } },
    });
    const looks = { ...WORDS, styles: undefined };
    const bare = planTurnInto(page(looks), "w1", "test/passage", lookup, [
      LIBRARY[0] as NamedClass,
    ]);
    if ("refused" in bare) throw new Error(bare.refused);
    expect(bare.op.node.styles).toEqual(LIBRARY[0]?.styles);
    // The shared style is any block's to wear, so it stays a class.
    expect(bare.op.node.classes).toEqual(["shared-brand"]);
  });

  it("stays under a shared style the block keeps, as it was drawn", () => {
    // The look is green, the shared style blue: the block was drawn blue, and
    // the look's colour must not now win over the shared style.
    const brand = LIBRARY[1] as NamedClass;
    const plan = planTurnInto(
      page({ ...WORDS, styles: undefined }),
      "w1",
      "test/passage",
      lookup,
      [LIBRARY[0] as NamedClass, brand]
    );
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { fontSize: "3rem" } },
      hover: { desktop: { color: "#f00" } },
    });
    expect(plan.op.node.classes).toEqual(["shared-brand"]);
  });

  it("keeps only what the new block supports of it", () => {
    const looks = { ...WORDS, styles: undefined };
    const plan = planTurnInto(page(looks), "w1", "test/title", lookup, [
      LIBRARY[0] as NamedClass,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#0c0" } },
      hover: { desktop: { color: "#f00" } },
    });
  });
});

describe("a component's offered words", () => {
  it("refuses to turn a block whose props the component offers to its placements", () => {
    const component = {
      ...page(WORDS),
      kind: "component",
      exposed: [
        {
          id: "x1",
          label: "Greeting",
          nodeId: "w1",
          propPath: "words",
          type: "text",
        },
      ],
    } as unknown as BlockDocument;
    expect(planTurnInto(component, "w1", "test/title", lookup)).toEqual({
      refused:
        "Placements of this component fill in this block, so it can't be turned into another.",
    });
  });
});

describe("turnIntoTargets", () => {
  it("lists the registered types the block declares converters to", () => {
    expect(turnIntoTargets("test/words", lookup)).toEqual([
      "test/title",
      "test/passage",
    ]);
  });

  it("lists nothing for a block that declares none", () => {
    expect(turnIntoTargets("test/passage", lookup)).toEqual([]);
    expect(turnIntoTargets("test/missing", lookup)).toEqual([]);
  });
});
