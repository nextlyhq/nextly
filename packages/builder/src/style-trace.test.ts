/**
 * That the cascade fetched for the panel describes the page the canvas paints.
 *
 * The risk this file exists for is the one the module's own docblock names: the
 * compiler runs a second time here, so the answer could describe a document, a
 * registry or a breakpoint set other than the one on screen. Every assertion
 * below is about that agreement rather than about the compiler, which has its
 * own suite.
 *
 * @module style-trace.test
 */
import {
  clearBlocks,
  compilePageCss,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { registeredBlocks, resolvePageStyles } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it } from "vitest";

import { pageStyleTrace } from "./style-trace";

afterEach(() => {
  clearBlocks();
});

function register() {
  if (hasBlock("acme/text")) return;
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "Text.",
        example: { props: {} },
        render: () => null,
      },
    ] as never,
    { source: "style-trace-test" }
  );
}

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "base", label: "Base" },
    { id: "md", label: "Medium", maxWidth: 900 },
  ],
  container: [],
};

/** A document whose node authors a value, so there is a cascade to report. */
function doc(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/text",
        version: 1,
        props: {},
        styles: { base: { base: { color: "teal" }, md: { color: "olive" } } },
      },
    ],
  } as unknown as BlockDocument;
}

describe("the cascade fetched for the panel", () => {
  it("reports the declarations the document authored", () => {
    register();
    const trace = pageStyleTrace(
      doc(),
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The POPULATION first. An empty trace satisfies every `toContain` below by
    // vacuity, and `undefined` is a documented answer here, so both have to be
    // excluded before anything is read out of it.
    expect(trace).toBeDefined();
    expect(trace ?? []).not.toHaveLength(0);
    expect(trace?.map(entry => entry.property)).toContain("color");
  });

  it("reports a breakpoint's own entry, which is what a badge names", () => {
    register();
    const trace = pageStyleTrace(
      doc(),
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The separating property for C-6 specifically: the value authored at `md`
    // has to arrive as its OWN entry carrying that breakpoint, or the badge
    // cannot say which breakpoint a value came from and the whole affordance
    // reduces to "set somewhere".
    const breakpoints = trace?.map(entry => entry.breakpoint);
    expect(breakpoints).toContain("base");
    expect(breakpoints).toContain("md");
  });

  it("describes the SAME sheet the render path compiles", () => {
    /*
     * The agreement this module is on the hook for. `pageStyleTrace` asks the
     * compiler a second time, so the guard is that asking twice answers once:
     * the css it produced alongside the trace has to be the css the ordinary
     * resolver produces from the same document, registry and breakpoints.
     *
     * Compared through `resolvePageStyles` rather than a hand-built expectation,
     * because a literal would be a third answer to the same question and would
     * go stale the first time the compiler's output changed for a good reason.
     */
    register();
    const page = doc();
    const rendered = resolvePageStyles(
      page,
      undefined,
      { breakpoints: BREAKPOINTS },
      registeredBlocks()
    );
    const compiled = compilePageCss(page, { breakpoints: BREAKPOINTS });

    expect(rendered.css).toBe(compiled.css);
    // And the trace belongs to that same compile rather than to a different one.
    expect(
      pageStyleTrace(page, { breakpoints: BREAKPOINTS }, undefined)?.length
    ).toBe(
      compilePageCss(page, { breakpoints: BREAKPOINTS, trace: true }).trace
        ?.length
    );
  });

  it("keeps a node the canvas would hide, rather than pruning it away", () => {
    /*
     * Deliberately NOT pruned. A node hidden at the breakpoint being edited is
     * still selectable from the Layers panel and still has authored values an
     * author is owed an explanation of — compiled from a pruned tree it would
     * have no entries and every control would report having been set by nobody.
     *
     * The publishing precondition that argues for pruning does not apply: the
     * sheet is discarded and only the cascade is kept, in the editor.
     */
    register();
    const hidden = {
      ...doc(),
      nodes: [
        {
          ...(doc().nodes[0] as object),
          visibility: { md: false },
        },
      ],
    } as unknown as BlockDocument;

    const trace = pageStyleTrace(
      hidden,
      { breakpoints: BREAKPOINTS },
      undefined
    );

    expect(trace?.map(entry => entry.property)).toContain("color");
  });
});

describe("the SHARED inputs the page is compiled from", () => {
  /** A site library holding one class, as the canvas is given it. */
  const site = {
    breakpoints: BREAKPOINTS,
    classes: [
      {
        id: "cls-1",
        slug: "card",
        orderIndex: 0,
        styles: { base: { base: { color: "rebeccapurple" } } },
      },
    ],
  } as never;

  /** A node that applies that class and authors nothing of its own for it. */
  const classed = (): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          classes: ["cls-1"],
        },
      ],
    }) as unknown as BlockDocument;

  it("reports a NAMED CLASS declaration, which is the whole affordance", () => {
    /*
     * The case the indicator exists for — "this comes from `.card`" — and the
     * one a narrower context loses SILENTLY. `namedClasses` is reconciled from
     * the site tier by the renderer, so a trace compiled from breakpoints alone
     * carries no class declaration at all: every value arriving from a class
     * reports as set by nobody, and the dot never appears.
     *
     * A test that fed a class entry to the panel by hand would pass against that
     * bug, because it proves the RENDERING and not that a compile ever produces
     * one. This asks the compiler.
     */
    register();
    const trace = pageStyleTrace(classed(), { breakpoints: BREAKPOINTS }, site);

    // The population first: an empty trace satisfies every search below.
    expect(trace).toBeDefined();
    expect(trace ?? []).not.toHaveLength(0);

    const fromClass = (trace ?? []).filter(
      entry => entry.origin.kind === "class"
    );
    expect(fromClass).not.toHaveLength(0);
    expect(fromClass[0]?.origin).toEqual({
      kind: "class",
      id: "cls-1",
      slug: "card",
    });
    expect(fromClass[0]?.value).toBe("rebeccapurple");
  });

  it("carries the site's classes even when the route states no context", () => {
    // The site tier alone can compile, provided it named the breakpoints — the
    // one field a compile cannot proceed without. A host that passes only a site
    // sheet still gets an answer rather than silence.
    register();
    const trace = pageStyleTrace(classed(), undefined, site);
    expect((trace ?? []).some(entry => entry.origin.kind === "class")).toBe(
      true
    );
  });

  it("answers undefined when nothing names a breakpoint to compile against", () => {
    // A real answer rather than a failure, and the caller is documented not to
    // read it as "nothing is authored".
    register();
    expect(pageStyleTrace(classed(), undefined, undefined)).toBeUndefined();
  });
});
