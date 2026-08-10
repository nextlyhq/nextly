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
