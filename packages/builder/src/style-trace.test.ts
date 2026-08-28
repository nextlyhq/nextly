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
import {
  registeredBlocks,
  resolvePageStyles,
  withTypographyDefaults,
} from "@nextlyhq/blocks-react";
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
    const cascade = pageStyleTrace(
      doc(),
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The POPULATION first. An empty trace satisfies every `toContain` below by
    // vacuity, and `undefined` is a documented answer here, so both have to be
    // excluded before anything is read out of it.
    expect(cascade).toBeDefined();
    expect(cascade?.entries ?? []).not.toHaveLength(0);
    expect(cascade?.entries.map(entry => entry.property)).toContain("color");
  });

  it("reports a breakpoint's own entry, which is what a badge names", () => {
    register();
    const cascade = pageStyleTrace(
      doc(),
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The separating property for C-6 specifically: the value authored at `md`
    // has to arrive as its OWN entry carrying that breakpoint, or the badge
    // cannot say which breakpoint a value came from and the whole affordance
    // reduces to "set somewhere".
    const breakpoints = cascade?.entries.map(entry => entry.breakpoint);
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
    // Through `withTypographyDefaults`, because a bare `compilePageCss` is now
    // a different question from a render: the library adds its typographic
    // baseline, and the engine on its own has no opinion about headings. Both
    // sides have to be asked the same thing or the comparison reports the tier
    // as a disagreement.
    const compiled = compilePageCss(
      page,
      withTypographyDefaults({ breakpoints: BREAKPOINTS })
    );

    expect(rendered.css).toBe(compiled.css);
    // The baseline is IN what they agreed on, rather than absent from both. A
    // comparison of two sheets that each lack the tier would pass while the
    // panel explained a cascade the page does not have.
    // The baseline is IN what they agreed on, and ANCHORED rather than merely
    // present. A rule wrapped whole weighs 0-0-0 and loses to a bare element
    // reset, so "contains `h1`" would pass on a sheet that changes nothing.
    expect(compiled.css).toContain(".nx-pb-page :where(h1)");
    // And the trace belongs to that same compile rather than to a different one.
    expect(
      pageStyleTrace(page, { breakpoints: BREAKPOINTS }, undefined)?.entries
        .length
    ).toBe(
      compilePageCss(
        page,
        withTypographyDefaults({ breakpoints: BREAKPOINTS, trace: true })
      ).trace?.length
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

    const cascade = pageStyleTrace(
      hidden,
      { breakpoints: BREAKPOINTS },
      undefined
    );

    expect(cascade?.entries.map(entry => entry.property)).toContain("color");
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
    const cascade = pageStyleTrace(
      classed(),
      { breakpoints: BREAKPOINTS },
      site
    );

    // The population first: an empty trace satisfies every search below.
    expect(cascade).toBeDefined();
    expect(cascade?.entries ?? []).not.toHaveLength(0);

    const fromClass = (cascade?.entries ?? []).filter(
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
    const cascade = pageStyleTrace(classed(), undefined, site);
    expect(
      (cascade?.entries ?? []).some(entry => entry.origin.kind === "class")
    ).toBe(true);
  });

  it("applies the SITE's own fetch predicate on a site-only compile", () => {
    /*
     * The renderer's site-only construction copies `siteInput.mayFetchUrl`
     * explicitly, and dropping it here would let the trace keep a `url(...)` the
     * site refuses and report it as active on a page that never fetched it. The
     * host's `remotePatterns` are a different tier's answer and do not stand in.
     */
    register();
    const refusing = {
      ...(site as unknown as Record<string, unknown>),
      mayFetchUrl: () => false,
    } as never;
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          styles: {
            base: {
              base: { background: { url: "https://cdn.example/a.png" } },
            },
          },
        },
      ],
    } as unknown as BlockDocument;

    const refused = pageStyleTrace(document, undefined, refusing);
    const allowed = pageStyleTrace(document, undefined, {
      ...(site as unknown as Record<string, unknown>),
      mayFetchUrl: () => true,
    } as never);

    /*
     * The population, and the separating half together: the permissive compile
     * MUST produce the url declaration, or the refusing one proving absent shows
     * only that nothing was written either way.
     */
    const urls = (entries: readonly { value: string }[] | undefined) =>
      (entries ?? []).filter(entry => entry.value.includes("cdn.example"));
    expect(urls(allowed?.entries)).not.toHaveLength(0);
    expect(urls(refused?.entries)).toHaveLength(0);
  });

  it("answers undefined when nothing names a breakpoint to compile against", () => {
    // A real answer rather than a failure, and the caller is documented not to
    // read it as "nothing is authored".
    register();
    expect(pageStyleTrace(classed(), undefined, undefined)).toBeUndefined();
  });
});

describe("a stored document that still needs reader repair", () => {
  const context = { breakpoints: BREAKPOINTS };

  it("does not throw on a malformed node the renderer survives", () => {
    /*
     * A stored document is untrusted. `{ nodes: [null] }` passes the envelope
     * guard, and compiling the RAW tree throws while the cascade is read — so an
     * editor that asked for the trace on open crashed there, before the renderer
     * could show the placeholder it keeps for exactly this.
     *
     * The renderer sanitises and migrates first; this now runs the same stages.
     */
    register();
    const malformed = {
      formatVersion: 1,
      kind: "page",
      nodes: [null],
    } as unknown as BlockDocument;

    expect(() => pageStyleTrace(malformed, context, undefined)).not.toThrow();
  });

  it("still reports the cascade of the nodes that survive repair", () => {
    /*
     * The separating half. Not throwing is satisfied by returning nothing for
     * every document, which would be the feature switched off — so a malformed
     * node beside a good one must leave the good one's declarations intact.
     */
    register();
    const mixed = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        null,
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          styles: { base: { base: { color: "teal" } } },
        },
      ],
    } as unknown as BlockDocument;

    const cascade = pageStyleTrace(mixed, context, undefined);
    expect(cascade).toBeDefined();
    expect((cascade?.entries ?? []).map(entry => entry.property)).toContain(
      "color"
    );
  });

  it("answers undefined for an envelope the format does not recognise", () => {
    // A real answer rather than a throw: nothing can be compiled from a document
    // this format cannot read, and the caller is documented not to treat that as
    // "nothing is authored".
    register();
    const alien = {
      formatVersion: 999,
      kind: "page",
      nodes: [],
    } as unknown as BlockDocument;
    expect(pageStyleTrace(alien, context, undefined)).toBeUndefined();
  });
});

describe("a node the reader would withhold", () => {
  it("keeps a node HIDDEN AT A BREAKPOINT in the trace", () => {
    /*
     * The deliberate difference from the renderer, and until now the only part
     * of it nothing asserted.
     *
     * A node an author has hidden at a breakpoint still has values they are owed
     * an account of — it remains selectable from the Layers panel — so its
     * declarations must reach the trace.
     *
     * What this does NOT establish, said plainly: that compiling the MIGRATED
     * tree rather than the pruned one is what achieves it. Measured, the two are
     * observationally equal here — a condition-gated node's declarations are
     * dropped by the compiler before any pruning, and a breakpoint-hidden node
     * survives both trees, being kept and given visibility rules rather than
     * removed. No input currently separates them. The property below is worth
     * pinning regardless of which tree delivers it.
     */
    register();
    const gated = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "hidden",
          type: "acme/text",
          version: 1,
          props: {},
          visibility: { devices: { base: false } },
          styles: { base: { base: { color: "rebeccapurple" } } },
        },
      ],
    } as unknown as BlockDocument;

    const cascade = pageStyleTrace(
      gated,
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The population first, then the property: an empty trace satisfies the
    // search below by vacuity.
    expect(cascade).toBeDefined();
    expect(cascade?.entries ?? []).not.toHaveLength(0);
    expect((cascade?.entries ?? []).map(entry => entry.value)).toContain(
      "rebeccapurple"
    );
  });
});

describe("a stored document with duplicate node ids", () => {
  it("reports the surviving node's own declarations", () => {
    /*
     * Address repair runs AFTER gating, so a tree taken before it still holds
     * both copies — and the compiler deliberately suppresses node-local rules
     * for every node sharing an id, because they cannot be addressed separately.
     * Compiled from that stage, the survivor's controls read as unset while its
     * CSS is plainly on the page.
     */
    register();
    const duplicated = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "same",
          type: "acme/text",
          version: 1,
          props: {},
          styles: { base: { base: { color: "teal" } } },
        },
        {
          id: "same",
          type: "acme/text",
          version: 1,
          props: {},
          styles: { base: { base: { color: "olive" } } },
        },
      ],
    } as unknown as BlockDocument;

    const cascade = pageStyleTrace(
      duplicated,
      { breakpoints: BREAKPOINTS },
      undefined
    );

    // The population first: an empty trace satisfies the search by vacuity.
    expect(cascade).toBeDefined();
    expect(cascade?.entries ?? []).not.toHaveLength(0);
    expect(
      (cascade?.entries ?? []).some(entry => entry.origin.kind === "node")
    ).toBe(true);
  });
});
