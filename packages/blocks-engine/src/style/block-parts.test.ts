/**
 * Styles a block states for an element it renders INSIDE its root.
 *
 * `blockBases` is keyed by block type and compiles to one rule on one class, so
 * a block drawing more than one element can reach only the element wearing that
 * class. These are the others, and the questions here are which element each
 * rule lands on and what it weighs — a rule emitted correctly against the right
 * class is still wrong if it attaches to the wrong element, and a default that
 * outranks the host's own stylesheet is wrong however well it lands.
 *
 * @module style/block-parts.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import { PAGE_ROOT_CLASS } from "./node-class";

const TYPE = "core/image";
const TYPE_CLASS = ".nx-bt-core--image";
/**
 * What a DEFAULT tier anchors to: ONE page-root class, not the doubled form.
 * The doubling is what makes an AUTHORED value outrank a host's stylesheet, and
 * it is deliberately withheld from defaults — so asserting against the doubled
 * selector here would pass only if block defaults had been promoted above the
 * CSS they are meant to lose to.
 */
const DEFAULTS_ANCHOR = `.${PAGE_ROOT_CLASS}`;

function doc(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: TYPE, version: 1, props: {} }],
  } as unknown as BlockDocument;
}

function compile(ctx: Partial<StyleCompileContext>) {
  return compilePageCss(doc(), {
    breakpoints: FIXTURE_BREAKPOINTS,
    ...ctx,
  } as StyleCompileContext);
}

/** One part named `caption`, carrying whatever styles the case needs. */
function caption(
  baseStyles: unknown,
  selector = "figcaption"
): StyleCompileContext["blockParts"] {
  return {
    [TYPE]: { caption: { selector, baseStyles } },
  } as StyleCompileContext["blockParts"];
}

describe("a block's styles for an element it renders", () => {
  it("lands on that element rather than on the block's root", () => {
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(${TYPE_CLASS} figcaption) { font-size: 0.875em }`
    );
  });

  it("does not require the block to state root styles as well", () => {
    // The two tiers are independent: `blockBases` styles the element the
    // block-type class is on, `blockParts` styles elements it is not, and a
    // block declaring only the second is ordinary rather than a caller error.
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toContain("figcaption");
    expect(out.warnings).toEqual([]);
  });

  it("writes the root rule and the part rule against the same block class", () => {
    const out = compile({
      blockBases: { [TYPE]: { base: { base: { color: "#111" } } } },
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(${TYPE_CLASS}) { color: #111 }\n` +
        `${DEFAULTS_ANCHOR} :where(${TYPE_CLASS} figcaption) { font-size: 0.875em }`
    );
  });

  it("keeps the part inside :where(), so a site's own rule still wins", () => {
    // The weight question, and the reason it is asked separately from where the
    // rule lands. A default is not a choice anybody made, so it is anchored to
    // one page-root class with the rest wrapped: `.content figcaption` at 0-1-1
    // beats this, and a bare element reset at 0-0-1 does not. Emitting the part
    // OUTSIDE the wrapper would add its own weight and quietly promote every
    // block default above the host stylesheet it is meant to defer to.
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toContain(":where(");
    expect(out.css).not.toContain(`:where(${TYPE_CLASS}) figcaption`);
  });

  it("composes a property's own descendant after the part's element", () => {
    // `linkColor` carries the catalog's own descendant (`a`). The two are
    // different questions — one is block-scoped and structural, the other is
    // property-scoped and crosses every block — so a link inside a caption has
    // to reach `figcaption a` rather than either one alone.
    const out = compile({
      blockParts: caption({ base: { base: { linkColor: "#00f" } } }),
    });
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(${TYPE_CLASS} figcaption a) { color: #00f }`
    );
  });

  it("records which element a declaration landed on", () => {
    const { trace } = compilePageCss(doc(), {
      breakpoints: FIXTURE_BREAKPOINTS,
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
      trace: true,
    } as StyleCompileContext);
    // Without this the map below runs on `undefined` and the assertion passes
    // against an absent trace, which is the same green a correct one gives.
    expect(trace).toBeDefined();
    expect(trace?.map(entry => entry.descendant)).toEqual([" figcaption"]);
  });
});

describe("a part naming something that is not an element", () => {
  // Every rejection below needs the must-pass control above it to mean
  // anything: a gate that refuses every selector passes all of these while
  // styling nothing, and the emitted-rule assertion is what separates the two.
  const REFUSED = [
    ["a selector list, which would open a rule of its own", "figcaption, body"],
    ["a descendant combinator", "figure figcaption"],
    ["a class", ".caption"],
    ["a pseudo-element", "figcaption::after"],
    ["an attribute selector", "figcaption[data-x]"],
    ["the universal selector", "*"],
    ["an empty string", ""],
    ["a value that is not a string", 42],
  ] as const;

  it.each(REFUSED)("refuses %s", (_why, selector) => {
    const out = compile({
      blockParts: caption(
        { base: { base: { fontSize: "0.875em" } } },
        selector as string
      ),
    });
    expect(out.css).toBe("");
    expect(out.warnings.map(issue => issue.code)).toEqual([
      "invalid-block-part",
    ]);
  });

  it("names the block and the part it refused", () => {
    const out = compile({
      blockParts: caption(
        { base: { base: { fontSize: "0.875em" } } },
        "figcaption, body"
      ),
    });
    expect(out.warnings[0]?.message).toContain("caption");
    expect(out.warnings[0]?.message).toContain(TYPE);
    expect(out.warnings[0]?.path).toBe("/blockParts/core~1image/caption");
  });

  it("refuses only the bad part, leaving its siblings styled", () => {
    // A block is refused one part, not all of them — otherwise a typo in one
    // silently unstyles everything else the block declares.
    const out = compilePageCss(doc(), {
      breakpoints: FIXTURE_BREAKPOINTS,
      blockParts: {
        [TYPE]: {
          caption: { selector: "figcaption, body", baseStyles: {} },
          marker: {
            selector: "li",
            baseStyles: { base: { base: { fontSize: "1em" } } },
          },
        },
      },
    } as StyleCompileContext);
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(${TYPE_CLASS} li) { font-size: 1em }`
    );
    expect(out.warnings.map(issue => issue.code)).toEqual([
      "invalid-block-part",
    ]);
  });
});
