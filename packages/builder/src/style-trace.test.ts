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
    const trace = pageStyleTrace(doc(), BREAKPOINTS);

    // The POPULATION first. An empty trace satisfies every `toContain` below by
    // vacuity, and `undefined` is a documented answer here, so both have to be
    // excluded before anything is read out of it.
    expect(trace).toBeDefined();
    expect(trace ?? []).not.toHaveLength(0);
    expect(trace?.map(entry => entry.property)).toContain("color");
  });

  it("reports a breakpoint's own entry, which is what a badge names", () => {
    register();
    const trace = pageStyleTrace(doc(), BREAKPOINTS);

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
    expect(pageStyleTrace(page, BREAKPOINTS)?.length).toBe(
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

    const trace = pageStyleTrace(hidden, BREAKPOINTS);

    expect(trace?.map(entry => entry.property)).toContain("color");
  });
});
