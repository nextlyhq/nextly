/**
 * The trace against the stylesheet it describes.
 *
 * One property carries this design: a trace entry exists for exactly the declarations the
 * compiler wrote, in exactly the order it wrote them. Everything an inspector later says about
 * where a value came from rests on that, so it is asserted against the emitted CSS rather than
 * against a second idea of what the compiler should have done.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { NamedClass } from "./named-class";

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

/** A document exercising all four tiers at once, so their relative order is observable. */
const everyTier = {
  formatVersion: 1,
  kind: "page",
  settings: { styles: styles({ color: "black" }) },
  nodes: [
    {
      id: "n1",
      type: "core/box",
      version: 1,
      props: {},
      classes: ["c1"],
      styles: styles({ color: "red" }),
    },
  ],
} as unknown as BlockDocument;

const compile = (document: BlockDocument, trace: boolean) =>
  compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses: [card],
    blockBases: { "core/box": styles({ color: "green" }) },
    trace,
  } as never);

/**
 * The same, with no class library and no block defaults.
 *
 * For the cases that are about ONE node's own values: compiled against the shared fixture they
 * would also carry the page, class and block-default declarations, and an assertion listing every
 * entry would be asserting the fixture rather than the behaviour under test.
 */
const compileNodeOnly = (document: BlockDocument) =>
  compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses: [],
    blockBases: {},
    trace: true,
  } as never);

/**
 * Every `property: value` in the stylesheet, in source order.
 *
 * Read back out of the CSS rather than out of the structures that built it: the trace is only
 * worth anything if it matches what a browser will actually read.
 */
function declarationsInCss(css: string): string[] {
  const found: string[] = [];
  for (const line of css.split("\n")) {
    const open = line.indexOf("{");
    const close = line.lastIndexOf("}");
    if (open === -1 || close <= open) continue;
    const body = line.slice(open + 1, close).trim();
    if (body === "") continue;
    for (const declaration of body.split(";")) {
      const text = declaration.trim();
      if (text !== "") found.push(text);
    }
  }
  return found;
}

describe("a trace is produced only when it is asked for", () => {
  it("is absent by default, so a page render pays nothing for it", () => {
    const { trace } = compilePageCss(everyTier, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [card],
      blockBases: {},
    } as never);

    // Absent rather than empty: a caller must not read "nothing was written" from "not asked".
    expect(trace).toBeUndefined();
  });

  it("is present when asked for, and the CSS is identical either way", () => {
    const off = compile(everyTier, false);
    const on = compile(everyTier, true);

    expect(on.trace).toBeDefined();
    // Asking changes what is REPORTED, never what is written.
    expect(on.css).toBe(off.css);
    expect(on.warnings).toEqual(off.warnings);
  });
});

describe("the trace accounts for the stylesheet", () => {
  it("holds one entry per declaration, in the order they were written", () => {
    const { css, trace } = compile(everyTier, true);

    expect(trace?.map(entry => `${entry.property}: ${entry.value}`)).toEqual(
      declarationsInCss(css)
    );
  });

  it("names the tier each declaration came from, in cascade order", () => {
    const { trace } = compile(everyTier, true);

    // Page first, then the block type's default, then the class, then the node's own value. At
    // one specificity that order IS which value the author sees, so it is the order an inspector
    // reads to answer the question.
    expect(trace?.map(entry => entry.origin)).toEqual([
      { kind: "page" },
      { kind: "blockType", type: "core/box" },
      { kind: "class", id: "c1", slug: "card" },
      { kind: "node", id: "n1" },
    ]);
  });

  it("carries the state and breakpoint a declaration was stored under", () => {
    const hovered = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: {
            base: { tablet: { color: "red" } },
            hover: { base: { color: "blue" } },
          },
        },
      ],
    } as unknown as BlockDocument;

    const { trace } = compileNodeOnly(hovered);

    // State is the outer loop and breakpoint the inner one, so every breakpoint of `base` is
    // written before any of `hover`. That is what makes a hover value beat a base value at every
    // width, and it is the order the trace has to carry for a later reader to see the same thing.
    expect(
      trace?.map(entry => `${entry.state}/${entry.breakpoint}=${entry.value}`)
    ).toEqual(["base/tablet=red", "hover/base=blue"]);
  });

  it("carries the at-rule a breakpoint was emitted under", () => {
    const narrow = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: styles({ color: "red" }, "tablet"),
        },
      ],
    } as unknown as BlockDocument;

    const { css, trace } = compileNodeOnly(narrow);
    const atRule = trace?.[0]?.atRule;

    expect(atRule).toBeDefined();
    // The same at-rule the stylesheet opened, not a second rendering of the breakpoint.
    expect(css).toContain(`${atRule} {`);
  });

  it("carries the descendant selector for a property that styles one", () => {
    const linked = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: styles({ linkColor: "blue" }),
        },
      ],
    } as unknown as BlockDocument;

    const { trace } = compileNodeOnly(linked);

    // Without it, a link colour and an element colour read as the same declaration on the same
    // element — and they are two rules, on two elements, that do not compete.
    expect(trace?.[0]?.descendant).toBe(" a");
  });

  it("holds each declaration once when one map writes two selectors", () => {
    // A map mixing a property that styles the block with one that styles something inside it is
    // emitted as TWO rules. The trace is built per rule, from the declarations that rule carries;
    // built from the map instead it would record every declaration once per rule, and claim the
    // page contains rules it does not.
    const mixed = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: styles({ color: "red", linkColor: "blue" }),
        },
      ],
    } as unknown as BlockDocument;

    const { css, trace } = compileNodeOnly(mixed);

    expect(trace?.map(entry => `${entry.property}: ${entry.value}`)).toEqual(
      declarationsInCss(css)
    );
    expect(trace?.map(entry => entry.descendant)).toEqual([undefined, " a"]);
  });

  it("leaves the descendant absent for a property that styles the block itself", () => {
    const { trace } = compile(everyTier, true);

    expect(trace?.every(entry => entry.descendant === undefined)).toBe(true);
  });
});

describe("the trace records what was written, not what was stored", () => {
  it("omits a value the compiler refused", () => {
    const refused = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: styles({ color: "not a color", width: "10px" }),
        },
      ],
    } as unknown as BlockDocument;

    const { css, trace } = compileNodeOnly(refused);

    // The refusal is explained in `warnings`. What the trace answers is a different question —
    // which value is on the page — so a value that never reached it has no entry.
    expect(css).not.toContain("not a color");
    expect(trace?.map(entry => entry.property)).toEqual(["width"]);
  });

  it("omits a class the stylesheet dropped", () => {
    const twoClaimingOneName = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["c2"],
        },
      ],
    } as unknown as BlockDocument;

    const { trace } = compilePageCss(twoClaimingOneName, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [
        card,
        {
          id: "c2",
          slug: "card",
          orderIndex: 1,
          styles: styles({ color: "green" }),
        },
      ],
      blockBases: {},
      trace: true,
    } as never);

    // Only the first of two classes claiming one name is written, so the second is not a source
    // of anything — reporting it would name a rule the page does not have.
    expect(trace?.map(entry => entry.origin)).toEqual([
      { kind: "class", id: "c1", slug: "card" },
    ]);
  });
});
