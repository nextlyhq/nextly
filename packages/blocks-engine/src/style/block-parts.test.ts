/**
 * Styles a block states for an element it renders INSIDE its root.
 *
 * `blockBases` is keyed by block type and compiles to one rule on one class, so
 * a block drawing more than one element can reach only the element wearing that
 * class. These are the others, and three questions decide whether they work:
 * which element each rule lands on, what it weighs, and — the one a descendant
 * selector gets wrong — whether it stops at the block that declared it.
 *
 * @module style/block-parts.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import { blockPartClassName, PAGE_ROOT_CLASS } from "./node-class";

const TYPE = "core/image";
const PART_CLASS = `.${blockPartClassName(TYPE, "caption")}`;

/**
 * What a DEFAULT tier anchors to: ONE page-root class, not the doubled form.
 * The doubling is what makes an AUTHORED value outrank a host's stylesheet and
 * is deliberately withheld from defaults — so asserting against the doubled
 * selector would pass only if block defaults had been promoted above the CSS
 * they are meant to lose to.
 */
const DEFAULTS_ANCHOR = `.${PAGE_ROOT_CLASS}`;

function doc(type = TYPE): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type, version: 1, props: {} } as BlockNode],
  } as unknown as BlockDocument;
}

function compile(ctx: Partial<StyleCompileContext>, type = TYPE) {
  return compilePageCss(doc(type), {
    breakpoints: FIXTURE_BREAKPOINTS,
    ...ctx,
  } as StyleCompileContext);
}

/** One part named `caption`, carrying whatever styles the case needs. */
function caption(baseStyles: unknown, name = "caption") {
  return {
    [TYPE]: { [name]: { baseStyles } },
  } as StyleCompileContext["blockParts"];
}

describe("a block's styles for an element it renders", () => {
  it("lands on the class marking that element", () => {
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(${PART_CLASS}) { font-size: 0.875em }`
    );
  });

  it("does not reach elements a NESTED block renders", () => {
    // The defect a descendant selector has and a marker class cannot: written
    // as `.nx-bt-core--image figcaption`, a container's default also matches a
    // `figcaption` produced by another block sitting in one of its slots, so a
    // parent styles markup whose structure it does not own. The class carries
    // the owning type, so only elements the block itself marked can match.
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).not.toContain("figcaption");
    expect(out.css).not.toContain(" li");
    expect(out.css).toContain(blockPartClassName(TYPE, "caption"));
  });

  it("names the block that owns the part, so two blocks cannot collide", () => {
    expect(blockPartClassName("core/image", "caption")).not.toBe(
      blockPartClassName("core/quote", "caption")
    );
    // The doubled dash is the boundary, and a part name may not contain one —
    // otherwise these two would spell the same class.
    expect(blockPartClassName("core/image", "caption-wide")).not.toBe(
      blockPartClassName("core/image-caption", "wide")
    );
  });

  it("puts an interaction state on the PART, not on the block root", () => {
    // Focus does not propagate from a focused descendant to its ancestor, so a
    // state written onto the block root leaves a focusable part's `focus`
    // envelope unreachable: the input is focused and the rule waits for the
    // form to be.
    const out = compile({
      blockParts: caption({ focus: { base: { color: "#222" } } }),
    });
    expect(out.css).toContain(`${PART_CLASS}:where(:focus-visible)`);
    expect(out.css).not.toContain(":where(:focus-visible) ");
  });

  it("keeps the part inside :where(), so a site's own rule still wins", () => {
    // A default is not a choice anybody made, so it is anchored to one
    // page-root class with the rest wrapped: `.content .nx-bp-…` at 0-2-0 beats
    // this, and a bare element reset at 0-0-1 does not.
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css.startsWith(`${DEFAULTS_ANCHOR} :where(`)).toBe(true);
    expect(out.css).not.toContain(`${DEFAULTS_ANCHOR}${DEFAULTS_ANCHOR}`);
  });

  it("writes the root rule and the part rule for one block together", () => {
    const out = compile({
      blockBases: { [TYPE]: { base: { base: { color: "#111" } } } },
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toContain("color: #111");
    expect(out.css).toContain("font-size: 0.875em");
  });

  it("does not require the block to state root styles as well", () => {
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
    });
    expect(out.css).toContain("font-size: 0.875em");
    expect(out.warnings).toEqual([]);
  });

  it("records WHICH element a declaration landed on", () => {
    const { trace } = compilePageCss(doc(), {
      breakpoints: FIXTURE_BREAKPOINTS,
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }),
      trace: true,
    } as StyleCompileContext);
    // Without this the map below runs on `undefined` and the assertion passes
    // against an absent trace, which is the same green a correct one gives.
    expect(trace).toBeDefined();
    expect(trace?.map(entry => entry.origin)).toEqual([
      { kind: "blockType", type: TYPE, part: "caption" },
    ]);
  });

  it("leaves a block's own root rule reporting no part", () => {
    // The control for the assertion above: an origin that always carried a part
    // would satisfy it while telling a reader nothing.
    const { trace } = compilePageCss(doc(), {
      breakpoints: FIXTURE_BREAKPOINTS,
      blockBases: { [TYPE]: { base: { base: { color: "#111" } } } },
      trace: true,
    } as StyleCompileContext);
    expect(trace).toBeDefined();
    expect(trace?.map(entry => entry.origin)).toEqual([
      { kind: "blockType", type: TYPE },
    ]);
  });
});

describe("a part whose NAME is not a name", () => {
  // Every rejection needs the must-pass cases above it to mean anything: a gate
  // that refuses every name passes all of these while styling nothing.
  const REFUSED = [
    ["a doubled dash, which would make the class boundary ambiguous", "a--b"],
    ["an uppercase letter", "Caption"],
    ["a space", "my caption"],
    ["a dot", "caption.x"],
    ["a leading dash", "-caption"],
    ["a trailing dash", "caption-"],
    ["an empty string", ""],
  ] as const;

  it.each(REFUSED)("refuses %s", (_why, name) => {
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }, name),
    });
    expect(out.css).toBe("");
    expect(out.warnings.map(issue => issue.code)).toEqual([
      "invalid-block-part",
    ]);
  });

  it("names the block and the part it refused", () => {
    const out = compile({
      blockParts: caption({ base: { base: { fontSize: "0.875em" } } }, "a--b"),
    });
    expect(out.warnings[0]?.message).toContain("a--b");
    expect(out.warnings[0]?.message).toContain(TYPE);
  });

  it("refuses only the bad part, leaving its siblings styled", () => {
    // A block loses one part, not all of them — otherwise a typo in one
    // silently unstyles everything else the block declares.
    const out = compilePageCss(doc(), {
      breakpoints: FIXTURE_BREAKPOINTS,
      blockParts: {
        [TYPE]: {
          "a--b": { baseStyles: { base: { base: { color: "#111" } } } },
          marker: { baseStyles: { base: { base: { fontSize: "1em" } } } },
        },
      },
    } as StyleCompileContext);
    expect(out.css).toBe(
      `${DEFAULTS_ANCHOR} :where(.${blockPartClassName(TYPE, "marker")}) { font-size: 1em }`
    );
    expect(out.warnings.map(issue => issue.code)).toEqual([
      "invalid-block-part",
    ]);
  });
});
