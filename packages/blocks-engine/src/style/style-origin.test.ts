/**
 * Which recorded declaration a node is showing.
 *
 * Every case here compiles a real document and asks about the trace that compile produced, rather
 * than asserting against hand-built entries. The whole reason provenance is recorded instead of
 * derived is that a second idea of what the compiler does can disagree with it; a test written
 * against a hand-built trace would be exactly that second idea.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { NamedClass } from "./named-class";
import { styleOrigin } from "./style-origin";
import type { StyleSubject } from "./style-origin";
import type { StyleTraceEntry } from "./style-trace";

const styles = (
  values: Record<string, unknown>,
  breakpoint = "base"
): NodeStyles => ({ base: { [breakpoint]: values } }) as unknown as NodeStyles;

const card: NamedClass = {
  id: "c1",
  slug: "card",
  orderIndex: 0,
  styles: styles({ color: "blue" }),
};

function traceOf(
  document: BlockDocument,
  namedClasses: NamedClass[] = [],
  blockBases: Record<string, NodeStyles> = {}
): readonly StyleTraceEntry[] {
  const { trace } = compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses,
    blockBases,
    trace: true,
  } as never);
  // The suite is meaningless without one, and an absent trace would make every assertion below
  // pass against nothing.
  expect(trace).toBeDefined();
  return trace ?? [];
}

const node = (extra: Record<string, unknown>, id = "n1") => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...extra,
});

const page = (nodes: unknown[], settings?: unknown) =>
  ({
    formatVersion: 1,
    kind: "page",
    ...(settings === undefined ? {} : { settings }),
    nodes,
  }) as unknown as BlockDocument;

const box: StyleSubject = { nodeId: "n1", blockType: "core/box" };
const atBase = {
  property: "color",
  state: "base" as const,
  breakpoints: ["base"],
};

describe("which tier a node is showing", () => {
  it("prefers the node's own value over every other tier", () => {
    const trace = traceOf(
      page([node({ classes: ["c1"], styles: styles({ color: "red" }) })], {
        styles: styles({ color: "black" }),
      }),
      [card],
      { "core/box": styles({ color: "green" }) }
    );

    const showing = styleOrigin(trace, { ...box, classIds: ["c1"] }, atBase);

    expect(showing?.value).toBe("red");
    expect(showing?.origin).toEqual({ kind: "node", id: "n1" });
  });

  it("falls to the class when the node sets nothing", () => {
    const trace = traceOf(
      page([node({ classes: ["c1"] })], {
        styles: styles({ color: "black" }),
      }),
      [card],
      { "core/box": styles({ color: "green" }) }
    );

    const showing = styleOrigin(trace, { ...box, classIds: ["c1"] }, atBase);

    expect(showing?.origin).toEqual({ kind: "class", id: "c1", slug: "card" });
  });

  it("falls to the block type when no class applies", () => {
    const trace = traceOf(
      page([node({})], { styles: styles({ color: "black" }) }),
      [],
      {
        "core/box": styles({ color: "green" }),
      }
    );

    const showing = styleOrigin(trace, box, atBase);

    expect(showing?.origin).toEqual({ kind: "blockType", type: "core/box" });
  });

  it("falls to the page, which reaches a node that states nothing", () => {
    const trace = traceOf(
      page([node({})], { styles: styles({ color: "black" }) })
    );

    expect(styleOrigin(trace, box, atBase)?.origin).toEqual({ kind: "page" });
  });

  it("answers undefined when no tier wrote the property", () => {
    const trace = traceOf(page([node({ styles: styles({ color: "red" }) })]));

    expect(
      styleOrigin(trace, box, { ...atBase, property: "width" })
    ).toBeUndefined();
  });
});

describe("what a rule is allowed to reach", () => {
  it("does not report a class the node does not apply", () => {
    const trace = traceOf(page([node({})]), [card]);

    // The rule exists in the stylesheet; it just does not land on this element.
    expect(trace.some(entry => entry.origin.kind === "class")).toBe(true);
    expect(styleOrigin(trace, box, atBase)).toBeUndefined();
  });

  it("does not report another block type's default", () => {
    const trace = traceOf(page([node({}, "n1")]), [], {
      "core/text": styles({ color: "green" }),
    });

    expect(styleOrigin(trace, box, atBase)).toBeUndefined();
  });

  it("does not report another node's value", () => {
    const trace = traceOf(
      page([node({}), node({ styles: styles({ color: "red" }) }, "n2")])
    );

    expect(styleOrigin(trace, box, atBase)).toBeUndefined();
  });
});

describe("a rule that styles something inside the block", () => {
  const linkPage = () =>
    traceOf(
      page([
        node({
          styles: styles({ linkColor: "red" }),
          slots: { default: [node({ classes: ["link"] }, "child")] },
        }),
      ]),
      [
        {
          id: "link",
          slug: "link",
          orderIndex: 0,
          styles: styles({ linkColor: "blue" }),
        },
      ]
    );

  const child: StyleSubject = {
    nodeId: "child",
    blockType: "core/box",
    classIds: ["link"],
    ancestors: [{ nodeId: "n1", blockType: "core/box" }],
  };

  it("reaches a descendant node from its ancestor", () => {
    const showing = styleOrigin(linkPage(), child, {
      ...atBase,
      property: "color",
    });

    // `.n1 a` lands on this child's links directly, competing with the child's own class rule at
    // equal specificity — so the later one wins, and node rules are written after class rules.
    expect(showing?.origin).toEqual({ kind: "node", id: "n1" });
    expect(showing?.descendant).toBe(" a");
  });

  it("does not reach a node that is not inside it", () => {
    const sibling: StyleSubject = {
      nodeId: "other",
      blockType: "core/box",
      ancestors: [],
    };

    expect(
      styleOrigin(linkPage(), sibling, { ...atBase, property: "color" })
    ).toBeUndefined();
  });

  it("lets a more specific descendant selector win over a later-written one", () => {
    // The case where order and specificity DISAGREE, which is the only case that tests
    // specificity at all. Inside one map the compiler emits by property name, so `linkColor`
    // already precedes `linkColorHover` and taking the last would land on the right answer for
    // the wrong reason.
    //
    // Split across tiers it comes apart: the class writes `a:hover`, the node writes `a`, and the
    // node's rule is emitted LATER. On a hovered link both match, and the class's extra
    // pseudo-class outranks the node's position.
    const trace = traceOf(
      page([
        node({ classes: ["hover"], styles: styles({ linkColor: "blue" }) }),
      ]),
      [
        {
          id: "hover",
          slug: "hover",
          orderIndex: 0,
          styles: styles({ linkColorHover: "red" }),
        },
      ]
    );

    const order = trace.map(entry => entry.descendant);
    expect(order).toEqual([" a:hover", " a"]);

    const showing = styleOrigin(
      trace,
      { ...box, classIds: ["hover"] },
      { ...atBase, property: "color" }
    );

    expect(showing?.value).toBe("red");
    expect(showing?.descendant).toBe(" a:hover");
  });
});

describe("which breakpoints are live", () => {
  const responsive = () =>
    traceOf(
      page([
        node({
          styles: {
            base: { base: { color: "red" }, tablet: { color: "blue" } },
          },
        }),
      ])
    );

  it("takes the narrower rule when the viewer is at that width", () => {
    const showing = styleOrigin(responsive(), box, {
      ...atBase,
      breakpoints: ["base", "tablet"],
    });

    expect(showing?.value).toBe("blue");
    expect(showing?.breakpoint).toBe("tablet");
  });

  it("ignores a breakpoint the viewer is not at", () => {
    const showing = styleOrigin(responsive(), box, {
      ...atBase,
      breakpoints: ["base"],
    });

    expect(showing?.value).toBe("red");
  });
});

describe("which state is being asked about", () => {
  it("answers for the state asked, not whichever was written last", () => {
    const trace = traceOf(
      page([
        node({
          styles: {
            base: { base: { color: "red" } },
            hover: { base: { color: "blue" } },
          },
        }),
      ])
    );

    expect(styleOrigin(trace, box, atBase)?.value).toBe("red");
    expect(styleOrigin(trace, box, { ...atBase, state: "hover" })?.value).toBe(
      "blue"
    );
  });
});

describe("what a tier actually weighs", () => {
  /**
   * The default tiers are anchored to ONE page-root class with the rest of the
   * selector inside `:where()`, so a descendant and its pseudo-classes carry no
   * weight at all. Ranking that counted pseudo-classes alone therefore made a
   * block default's `a:hover` heavier than a node's own `a`.
   */
  it("does not let a block default's hover outrank a node's own link colour", () => {
    const document = page([node({ styles: styles({ linkColor: "blue" }) })]);
    const trace = traceOf(document, [], {
      "core/box": styles({ linkColorHover: "red" }),
    });

    // Both entries exist, asserted before the ranking: a trace missing either
    // makes the contest below vacuous.
    const kinds = trace
      .filter(entry => entry.property === "color")
      .map(entry => `${entry.origin.kind}${entry.descendant ?? ""}`);
    expect(kinds).toContain("blockType a:hover");
    expect(kinds).toContain("node a");

    // The browser gives the node's rule `0-3-1` and the default's `0-1-0`, so
    // a hovered link inside this block shows the node's blue.
    const showing = styleOrigin(trace, box, {
      property: "color",
      state: "base",
      breakpoints: ["base"],
      // The control addresses the hovered link, where BOTH rules match.
    });
    expect(showing?.origin).toEqual({ kind: "node", id: "n1" });
  });

  it("keeps an inherited page value below a block default that lands directly", () => {
    // Specificity settles a contest between rules matching the SAME element.
    // Page settings compile onto the page ROOT, so a block reads them by
    // inheritance and any rule of its own wins however little it weighs —
    // measured in a browser at `0-2-0` inherited against `0-1-0` direct.
    const document = page([node({})], { styles: styles({ color: "black" }) });
    const trace = traceOf(document, [], {
      "core/box": styles({ color: "green" }),
    });

    const showing = styleOrigin(trace, box, atBase);
    expect(showing?.origin).toEqual({ kind: "blockType", type: "core/box" });
  });
});

describe("the typographic baseline's origin", () => {
  /** A compile carrying element defaults, which only this tier produces. */
  function elementTrace(): readonly StyleTraceEntry[] {
    const { trace } = compilePageCss(page([node({})]), {
      breakpoints: FIXTURE_BREAKPOINTS,
      elementBases: { h1: styles({ fontSize: "2.25em" }) },
      trace: true,
    } as never);
    expect(trace).toBeDefined();
    return trace ?? [];
  }

  const askFontSize = {
    property: "font-size",
    state: "base" as const,
    breakpoints: ["base"],
  };

  it("records the ELEMENT rather than the page", () => {
    // Recorded as `page`, a heading's size looks like a value inherited from
    // the page root — and a reader filtering page entries that carry no
    // descendant then reports a visibly applied size as unset.
    const entries = elementTrace().filter(
      entry => entry.property === "font-size"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.origin).toEqual({ kind: "element", tag: "h1" });
  });

  it("reaches a node rendering that element", () => {
    const heading: StyleSubject = {
      nodeId: "n1",
      blockType: "core/box",
      tag: "h1",
    };
    expect(styleOrigin(elementTrace(), heading, askFontSize)?.origin).toEqual({
      kind: "element",
      tag: "h1",
    });
  });

  it("does not reach a node rendering a different element", () => {
    const paragraph: StyleSubject = {
      nodeId: "n1",
      blockType: "core/box",
      tag: "p",
    };
    expect(styleOrigin(elementTrace(), paragraph, askFontSize)).toBeUndefined();
  });

  it("stays quiet for a subject that does not state its element", () => {
    // The tag lives in a block's render. A caller that cannot say gets no
    // answer rather than a guessed one — a heading's baseline reported as
    // styling a paragraph would be worse than reporting nothing.
    expect(styleOrigin(elementTrace(), box, askFontSize)).toBeUndefined();
  });
});
