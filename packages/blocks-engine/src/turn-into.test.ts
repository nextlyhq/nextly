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
        "test/framed": TO_PASSAGE,
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
        // Two props onto one: only one binding can land there.
        "test/contact": {
          carries: { title: "line", note: "line" },
          convert: (props: Record<string, unknown>) => ({
            props: { line: props.title },
          }),
        },
        // Words onto an address, which takes text and nothing else.
        "test/mail": {
          carries: { title: "address" },
          convert: (props: Record<string, unknown>) => ({
            props: { address: props.title },
          }),
        },
      },
    }),
    definition({
      name: "test/contact",
      editor: { label: "Contact" },
      props: { line: { type: "text" } },
    }),
    definition({
      name: "test/mail",
      editor: { label: "Mail" },
      props: { address: { type: "email" } },
    }),
    definition({
      name: "test/passage",
      editor: { label: "Passage" },
      props: { passage: { type: "richText" } },
      supports: { color: true, typography: true, spacing: true },
    }),
    definition({
      name: "test/framed",
      editor: { label: "Framed" },
      props: { passage: { type: "richText" } },
      supports: { border: true },
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

  it("keeps one binding where two would land on the same prop, and names the other", () => {
    const title: BlockNode = {
      id: "t1",
      type: "test/title",
      version: 3,
      props: { title: "Hi" },
      bindings: { title: { $bind: "name" }, note: { $bind: "role" } },
    };
    const plan = planTurnInto(page(title), "t1", "test/contact", lookup);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.bindings).toEqual({ line: { $bind: "name" } });
    expect(plan.unbound).toEqual(["note"]);
  });

  it("removes a binding the new prop takes fewer kinds of value for", () => {
    // A text prop fills from a number field; an email prop does not.
    const title: BlockNode = {
      id: "t1",
      type: "test/title",
      version: 3,
      props: { title: "Hi" },
      bindings: { title: { $bind: "count" } },
    };
    const plan = planTurnInto(page(title), "t1", "test/mail", lookup);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.bindings).toBeUndefined();
    expect(plan.unbound).toEqual(["title"]);
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
      // The shared style's colour beat the look's hover colour too: a
      // state's rule has no more weight than the base's, and the class came
      // later.
      base: { desktop: { fontSize: "3rem" } },
    });
    expect(plan.op.node.classes).toEqual(["shared-brand"]);
    expect(plan.lookTrimmed).toBe(true);
  });

  it("gives way to a shared style that sets the same thing at another width, and says so", () => {
    // The look colours the block on every width; the shared style colours it
    // on mobile only, where it won. Written into the block's own styles, the
    // look's colour would now win on mobile too, so it gives way.
    const mobileBrand: NamedClass = {
      id: "shared-brand",
      slug: "brand",
      orderIndex: 1,
      styles: { base: { mobile: { color: "#00c" } } },
    };
    const plan = planTurnInto(
      page({ ...WORDS, styles: undefined }),
      "w1",
      "test/passage",
      lookup,
      [LIBRARY[0] as NamedClass, mobileBrand]
    );
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      // The shared style's colour beat the look's hover colour too: a
      // state's rule has no more weight than the base's, and the class came
      // later.
      base: { desktop: { fontSize: "3rem" } },
    });
    expect(plan.lookTrimmed).toBe(true);
  });

  it("keeps the sides of a padding the block did not set itself", () => {
    const padded: NamedClass = {
      id: "look-padded",
      slug: "padded",
      orderIndex: 0,
      blockType: "test/words",
      styles: {
        base: { desktop: { padding: { blockStart: "4px", blockEnd: "4px" } } },
      },
    };
    const own = {
      ...WORDS,
      classes: ["look-padded"],
      styles: { base: { desktop: { padding: { blockStart: "8px" } } } },
    };
    const plan = planTurnInto(page(own), "w1", "test/passage", lookup, [
      padded,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { padding: { blockStart: "8px", blockEnd: "4px" } } },
    });
    expect(plan.lookTrimmed).toBeUndefined();
  });

  it("keeps a shared style's sides over the look's at the same width", () => {
    const padded: NamedClass = {
      id: "look-padded",
      slug: "padded",
      orderIndex: 0,
      blockType: "test/words",
      styles: {
        base: { desktop: { padding: { blockStart: "4px", blockEnd: "4px" } } },
      },
    };
    const roomy: NamedClass = {
      id: "roomy",
      slug: "roomy",
      orderIndex: 1,
      styles: { base: { desktop: { padding: { blockStart: "6px" } } } },
    };
    const worn = {
      ...WORDS,
      classes: ["look-padded", "roomy"],
      styles: undefined,
    };
    const plan = planTurnInto(page(worn), "w1", "test/passage", lookup, [
      padded,
      roomy,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { padding: { blockEnd: "4px" } } },
    });
    expect(plan.op.node.classes).toEqual(["roomy"]);
  });

  it("gives way to the block's own value at another width, and says so", () => {
    // The block's own size won at every width over the look's tablet size;
    // in one tier the look's tablet size would win on tablets, so it goes.
    const sized: NamedClass = {
      id: "look-sized",
      slug: "sized",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { tablet: { fontSize: "2rem" } } },
    };
    const own = {
      ...WORDS,
      classes: ["look-sized"],
      styles: { base: { desktop: { fontSize: "1rem" } } },
    };
    const plan = planTurnInto(page(own), "w1", "test/passage", lookup, [sized]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { fontSize: "1rem" } },
    });
    expect(plan.lookTrimmed).toBe(true);
  });

  it("gives way to the block's own value in another state, and says so", () => {
    // The block's own colour won over the look's hover colour even while
    // hovered; in one tier the hover colour would win, so it goes.
    const hovered: NamedClass = {
      id: "look-hovered",
      slug: "hovered",
      orderIndex: 0,
      blockType: "test/words",
      styles: { hover: { desktop: { color: "#f00" } } },
    };
    const own = {
      ...WORDS,
      classes: ["look-hovered"],
      styles: { base: { desktop: { color: "#c00" } } },
    };
    const plan = planTurnInto(page(own), "w1", "test/passage", lookup, [
      hovered,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#c00" } },
    });
    expect(plan.lookTrimmed).toBe(true);
  });

  it("keeps a look value the block's own value in a later state never beat", () => {
    // The look's red is the block's colour until it is hovered, when its own
    // blue wins; in one tier hover still comes after, so both stay.
    const red: NamedClass = {
      id: "look-red",
      slug: "red",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { desktop: { color: "#f00" } } },
    };
    const own = {
      ...WORDS,
      classes: ["look-red"],
      styles: { hover: { desktop: { color: "#00f" } } },
    };
    const plan = planTurnInto(page(own), "w1", "test/passage", lookup, [red]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#f00" } },
      hover: { desktop: { color: "#00f" } },
    });
    expect(plan.lookTrimmed).toBeUndefined();
  });

  it("is not beaten by a look of another type, which was never drawn", () => {
    const red: NamedClass = {
      id: "look-red",
      slug: "red",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { desktop: { color: "#f00" } } },
    };
    const otherBlue: NamedClass = {
      id: "look-blue",
      slug: "blue",
      orderIndex: 1,
      blockType: "test/title",
      styles: { base: { desktop: { color: "#00f" } } },
    };
    const worn = {
      ...WORDS,
      classes: ["look-red", "look-blue"],
      styles: undefined,
    };
    const plan = planTurnInto(page(worn), "w1", "test/passage", lookup, [
      red,
      otherBlue,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#f00" } },
    });
  });

  it("gives way between two worn looks as they were drawn, and says so", () => {
    // The later look's desktop blue beat the earlier look's tablet red at
    // every width; folded into one envelope the tablet red would win there.
    const red: NamedClass = {
      id: "look-red",
      slug: "red",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { tablet: { color: "#f00" } } },
    };
    const blue: NamedClass = {
      id: "look-blue",
      slug: "blue",
      orderIndex: 1,
      blockType: "test/words",
      styles: { base: { desktop: { color: "#00f" } } },
    };
    const worn = {
      ...WORDS,
      classes: ["look-red", "look-blue"],
      styles: undefined,
    };
    const plan = planTurnInto(page(worn), "w1", "test/passage", lookup, [
      red,
      blue,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#00f" } },
    });
    expect(plan.lookTrimmed).toBe(true);
  });

  it("keeps the sides of a value the block's own value never touched, in another state", () => {
    // The look pads the bottom while hovered; the block pads its own top.
    // Different sides are different CSS, so both stay.
    const hoverPad: NamedClass = {
      id: "look-hover-pad",
      slug: "hover-pad",
      orderIndex: 0,
      blockType: "test/words",
      styles: { hover: { desktop: { padding: { blockEnd: "16px" } } } },
    };
    const own = {
      ...WORDS,
      classes: ["look-hover-pad"],
      styles: { base: { desktop: { padding: { blockStart: "8px" } } } },
    };
    const plan = planTurnInto(page(own), "w1", "test/passage", lookup, [
      hoverPad,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { padding: { blockStart: "8px" } } },
      hover: { desktop: { padding: { blockEnd: "16px" } } },
    });
    expect(plan.lookTrimmed).toBeUndefined();
  });

  it("orders two worn looks as the stylesheet does, by id when their places tie", () => {
    // Both at place 0: the stylesheet writes "a" then "z", so "z" wins.
    const z: NamedClass = {
      id: "z",
      slug: "zed",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { desktop: { color: "#f00" } } },
    };
    const a: NamedClass = {
      id: "a",
      slug: "ay",
      orderIndex: 0,
      blockType: "test/words",
      styles: { base: { desktop: { color: "#00f" } } },
    };
    const worn = { ...WORDS, classes: ["z", "a"], styles: undefined };
    const plan = planTurnInto(page(worn), "w1", "test/passage", lookup, [z, a]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { color: "#f00" } },
    });
  });

  it("keeps the nested sides a shared style does not set", () => {
    // The look sets both border widths; the shared style only the top one.
    const framed: NamedClass = {
      id: "look-framed",
      slug: "framed",
      orderIndex: 0,
      blockType: "test/words",
      styles: {
        base: {
          desktop: {
            border: { width: { blockStart: "4px", blockEnd: "4px" } },
          },
        },
      },
    };
    const top: NamedClass = {
      id: "top",
      slug: "top",
      orderIndex: 1,
      styles: {
        base: { desktop: { border: { width: { blockStart: "6px" } } } },
      },
    };
    const worn = {
      ...WORDS,
      classes: ["look-framed", "top"],
      styles: undefined,
    };
    const plan = planTurnInto(page(worn), "w1", "test/framed", lookup, [
      framed,
      top,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toEqual({
      base: { desktop: { border: { width: { blockEnd: "4px" } } } },
    });
    expect(plan.lookTrimmed).toBeUndefined();
  });

  it("folds only a look the block was drawn with", () => {
    // A look of a third type was never drawn on this block, so nothing of it
    // comes along.
    const other: NamedClass = {
      id: "look-other",
      slug: "other",
      orderIndex: 0,
      blockType: "test/box",
      styles: { base: { desktop: { color: "#123" } } },
    };
    const worn = { ...WORDS, classes: ["look-other"], styles: undefined };
    const plan = planTurnInto(page(worn), "w1", "test/passage", lookup, [
      other,
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toBeUndefined();
  });

  it("says nothing gave way when no kept class sets what the look sets", () => {
    const plan = planTurnInto(
      page({ ...WORDS, styles: undefined }),
      "w1",
      "test/passage",
      lookup,
      [LIBRARY[0] as NamedClass]
    );
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.lookTrimmed).toBeUndefined();
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

describe("a block wearing no block style of its own", () => {
  const starred = (id: string, blockType: string): NamedClass => ({
    id,
    slug: id,
    orderIndex: 0,
    blockType,
    starred: true,
    styles: { base: { desktop: { color: "#0a0" } } },
  });
  const plain = { ...WORDS, classes: undefined, styles: undefined };

  it("takes the new type's default, and the plan says the look changes", () => {
    const plan = planTurnInto(page(plain), "w1", "test/passage", lookup, [
      starred("passage-star", "test/passage"),
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.op.node.styles).toBeUndefined();
    expect(plan.op.node.classes).toBeUndefined();
    expect(plan.defaultLookChanges).toBe(true);
  });

  it("says the look changes when it loses its own type's default", () => {
    const plan = planTurnInto(page(plain), "w1", "test/passage", lookup, [
      starred("words-star", "test/words"),
    ]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.defaultLookChanges).toBe(true);
  });

  it("says nothing when neither type has a default block style", () => {
    const plan = planTurnInto(page(plain), "w1", "test/passage", lookup, []);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.defaultLookChanges).toBeUndefined();
  });

  it("says nothing of defaults for a block that wears its own block style", () => {
    const own: NamedClass = {
      id: "look-own",
      slug: "own",
      orderIndex: 1,
      blockType: "test/words",
      styles: { base: { desktop: { fontSize: "2rem" } } },
    };
    const plan = planTurnInto(
      page({ ...plain, classes: ["look-own"] }),
      "w1",
      "test/passage",
      lookup,
      [starred("passage-star", "test/passage"), own]
    );
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.defaultLookChanges).toBeUndefined();
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
      "test/framed",
    ]);
  });

  it("lists nothing for a block that declares none", () => {
    expect(turnIntoTargets("test/passage", lookup)).toEqual([]);
    expect(turnIntoTargets("test/missing", lookup)).toEqual([]);
  });
});
