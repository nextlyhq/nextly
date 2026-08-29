/**
 * Appending a stored artifact's per-node gated rules to the sheet it ships.
 *
 * The stylesheet is compiled when a document is SAVED and a condition is decided when the page is
 * READ, so the compiler holds each conditioned node's own rules out of `css` and returns them per
 * node. A reader appends the ones whose nodes survived.
 *
 * These exercise `resolvePageStyles` directly rather than through `PageRenderer`, because the case
 * that matters most — a gated node that SURVIVES — is not reachable through the renderer yet: the
 * visibility pass and the compiler now share one predicate, so a node the compiler gates is a node
 * the renderer prunes. The survivor arrives with the condition evaluator, and the delivery half has
 * to be correct before it does, or the first surviving node renders unstyled.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { compilePageCss } from "@nextlyhq/blocks-engine";
import type { StyleCompileContext } from "@nextlyhq/blocks-engine";

import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import {
  resolvePageStyles,
  resolvePageStylesWithTrace,
  toPageStyles,
  type PageStyles,
} from "./styles";
import { withTypographyDefaults } from "./blocks/typography-defaults";

const blocks = createBlockResolver([]);

const node = (id: string): BlockNode => ({
  id,
  type: "test/text",
  version: 1,
  props: {},
});

const doc = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

/** A stored artifact whose sheet is missing the rules its `gated` map holds. */
const stored = (gated?: Record<string, string>): PageStyles => ({
  css: ".nx-a { color: teal }",
  classes: { a: "nx-a", b: "nx-b" },
  ...(gated === undefined ? {} : { gated }),
});

describe("a stored artifact carrying gated rules", () => {
  it("appends the rules of a node that survived", () => {
    // The node is IN the document handed to the resolver, which is what "survived" means: the
    // visibility pass already removed the ones it withheld.
    const styles = resolvePageStyles(
      doc(node("a"), node("b")),
      stored({ b: ".nx-b { color: rebeccapurple }" }),
      undefined,
      blocks
    );

    expect(styles.css).toContain("color: teal");
    expect(styles.css).toContain("rebeccapurple");
  });

  it("does not append the rules of a node that was pruned", () => {
    // `b` is absent from the document, so its entry must not be appended — this is the leak the
    // split exists to stop, the rules of a block whose markup is withheld.
    const styles = resolvePageStyles(
      doc(node("a")),
      stored({ b: ".nx-b { background-image: url(/gated-asset.png) }" }),
      undefined,
      blocks
    );

    expect(styles.css).toContain("color: teal");
    expect(styles.css).not.toContain("gated-asset.png");
  });

  it("appends after the main sheet, never before", () => {
    // Everything is emitted at one specificity, so precedence is source order alone. A node's own
    // rules landing ahead of the sheet would let a block-type default beat them.
    const styles = resolvePageStyles(
      doc(node("a"), node("b")),
      stored({ b: ".nx-b { color: rebeccapurple }" }),
      undefined,
      blocks
    );

    expect(styles.css.indexOf("color: teal")).toBeLessThan(
      styles.css.indexOf("rebeccapurple")
    );
  });

  it("appends nothing when the map holds no surviving node", () => {
    // Distinct from having no map at all: the sheet is returned untouched rather than gaining a
    // trailing separator, so a page that gates nothing is byte-identical. Both nodes are present,
    // so the artifact accounts for everything it names and the sheet stays trusted — this test is
    // about the EMPTY map, not about a stale artifact.
    const styles = resolvePageStyles(
      doc(node("a"), node("b")),
      stored({}),
      undefined,
      blocks
    );

    expect(styles.css).toBe(".nx-a { color: teal }");
  });

  it("ignores an entry that is not a usable string", () => {
    // The artifact is a database record; a null or a number reaching the sheet would serialize
    // into the page as text the CSS parser then has to survive.
    const styles = resolvePageStyles(
      doc(node("a"), node("b")),
      {
        ...stored(),
        gated: { b: null } as unknown as Record<string, string>,
      },
      undefined,
      blocks
    );

    expect(styles.css).toBe(".nx-a { color: teal }");
  });

  it("appends to a legitimately EMPTY main sheet", () => {
    // A page whose only styled node is conditioned compiles to `css: ""` with every rule in
    // `gated` — verified against the compiler, not assumed. Treating that emptiness as a refusal
    // would discard the entire styling of exactly the page this split exists for.
    const styles = resolvePageStyles(
      doc(node("a")),
      {
        css: "",
        classes: { a: "nx-a" },
        gated: { a: ".nx-a { color: rebeccapurple }" },
      },
      undefined,
      blocks
    );

    expect(styles.css).toBe(".nx-a { color: rebeccapurple }");
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "nope"],
  ])("treats a gated map that is %s as absent", (_label, gated) => {
    // The artifact is database input. Indexing a null here throws while assembling the page's
    // styles, BEFORE any block boundary exists, so one malformed row would take down the whole
    // page rather than one block.
    const call = () =>
      resolvePageStyles(
        // Both nodes present, so the only thing under test is the malformed MAP.
        doc(node("a"), node("b")),
        {
          ...stored(),
          gated: gated as unknown as Record<string, string>,
        },
        undefined,
        blocks
      );

    expect(call).not.toThrow();
    expect(call().css).toBe(".nx-a { color: teal }");
  });

  it("does not trust a sheet compiled from a LARGER tree than it was handed", () => {
    // The documented direct-caller flow is `pruneHiddenNodes` then this. Without the repair flag
    // the pruned tree looks unrepaired, so a legacy artifact carrying the removed node's rules —
    // and any asset URL in them — would be served as-is while its markup is withheld. An artifact
    // holding classes for nodes that are not in this document was compiled from a different tree
    // and cannot be trusted whatever the caller says.
    const styles = resolvePageStyles(
      doc(node("a")),
      {
        css: ".nx-a { color: teal } .nx-gone { background-image: url(/pruned-asset.png) }",
        classes: { a: "nx-a", gone: "nx-gone" },
      },
      undefined,
      blocks
    );

    expect(styles.css).not.toContain("pruned-asset.png");
  });

  it("appends nothing to an artifact whose sheet was refused", () => {
    // A missing class entry makes `normalizeStoredStyles` rebuild the classes and drop the CSS.
    // The gated rules are written against the OLD classes, so appending them would ship selectors
    // matching nothing — and the artifact was already judged unusable.
    const styles = resolvePageStyles(
      doc(node("a"), node("b")),
      {
        css: ".nx-a { color: teal }",
        classes: { a: "nx-a" },
        gated: { b: ".nx-b { color: rebeccapurple }" },
      },
      undefined,
      blocks
    );

    expect(styles.css).toBe("");
    expect(styles.css).not.toContain("rebeccapurple");
  });
});

describe("the scope an artifact records", () => {
  // Declared here rather than imported: the engine's own fixture is internal to
  // that package, and this file only needs one axis with a base.
  const BREAKPOINTS = {
    viewport: [{ id: "base", label: "Base" }],
    container: [],
  };

  // A scope keeps two documents rendered into one DOM apart, and the renderer
  // attaches whatever the artifact names. So an artifact recording a scope the
  // COMPILER refused claims an isolation its own selectors do not carry, and
  // the rules reach whatever else is on the page — which is the collision
  // scoping exists to prevent, arriving with a scope class visibly present.
  const doc = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/box",
        version: 1,
        props: {},
        styles: { base: { base: { color: "#111" } } },
      },
    ],
  } as BlockDocument;

  it("records nothing when the compiler refused the scope", () => {
    // Whitespace is refused by shape rather than by length, so this holds
    // whatever the length bound is.
    const compiled = compilePageCss(doc, {
      breakpoints: BREAKPOINTS,
      scope: "two words",
    });
    expect(compiled.css).not.toContain("two words");
    expect(toPageStyles(compiled, "two words").scope).toBeUndefined();
  });

  it("records the scope when the compiler wrote it", () => {
    // The control. Without it, dropping every scope would satisfy the case
    // above and silently unscope every page in the product.
    const compiled = compilePageCss(doc, {
      breakpoints: BREAKPOINTS,
      scope: "nx-doc-1",
    });
    expect(compiled.css).toContain("nx-doc-1");
    expect(toPageStyles(compiled, "nx-doc-1").scope).toBe("nx-doc-1");
  });
});

describe("the cascade the compiler produced, alongside the sheet", () => {
  /**
   * A node with a value of its own, so the compile has something to record.
   *
   * A document whose nodes declare nothing compiles to an empty trace, and an
   * empty array satisfies "is defined" exactly as a populated one does — so
   * every assertion below would pass against a resolver that asked for the
   * trace and threw the entries away.
   */
  const styled = (): BlockDocument => ({
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "test/text",
        version: 1,
        props: {},
        styles: { base: { base: { color: "teal" } } },
      } as unknown as BlockNode,
    ],
  });

  const context = {
    breakpoints: { viewport: [{ id: "base" }], container: [] },
  };

  it("reports the declarations it wrote when asked", () => {
    const resolved = resolvePageStylesWithTrace(
      styled(),
      undefined,
      context as never,
      blocks,
      false,
      { trace: true }
    );

    // The POPULATION first: an empty trace would satisfy every assertion below
    // for a reason that has nothing to do with the trace being carried through.
    expect(resolved.trace ?? []).not.toHaveLength(0);
    expect(resolved.trace?.map(entry => entry.property)).toContain("color");
    // And the sheet is still the sheet — asking for the cascade must not change
    // what gets rendered or stored.
    expect(resolved.styles.css).toContain("teal");
  });

  it("reports nothing when it was not asked", () => {
    const resolved = resolvePageStylesWithTrace(
      styled(),
      undefined,
      context as never,
      blocks
    );

    expect(resolved.trace).toBeUndefined();
    // The control: the same document DOES produce a trace when asked, so the
    // absence above is the option being off rather than a document with
    // nothing to record.
    expect(
      resolvePageStylesWithTrace(
        styled(),
        undefined,
        context as never,
        blocks,
        false,
        {
          trace: true,
        }
      ).trace
    ).not.toBeUndefined();
  });

  it("reports nothing for a sheet no compile produced, even when asked", () => {
    /*
     * A page served from a STORED artifact is not recompiled, so there is no
     * cascade to report and absence is the honest answer. It matters that a
     * caller can tell this apart from "nothing is authored": an editor treating
     * absence as an empty cascade would tell an author every value came from
     * nowhere.
     */
    const resolved = resolvePageStylesWithTrace(
      // BOTH nodes, because the stored artifact names classes for both. An
      // artifact describing a node the document lacks was compiled from a
      // larger tree, which this resolver refuses outright — the sheet would
      // come back empty and the assertion below would pass for that reason
      // instead of the one it names.
      doc(node("a"), node("b")),
      stored(),
      undefined,
      blocks,
      false,
      { trace: true }
    );

    expect(resolved.trace).toBeUndefined();
    expect(resolved.styles.css).toContain("teal");
  });

  it("gives the narrow entry exactly the sheet the wide one carries", () => {
    // The derivation, asserted rather than assumed: two resolutions of one
    // question are what every staleness test in this module exists to catch.
    const args = [
      styled(),
      undefined,
      context as never,
      blocks,
      false,
      {},
    ] as const;

    expect(resolvePageStyles(...args)).toEqual(
      resolvePageStylesWithTrace(...args).styles
    );
  });
});

describe("a stored artifact that was compiled for a PREVIEW", () => {
  /*
   * `resolvePageStyles` is exported, so this path is reachable rather than
   * theoretical: a caller can compile with a preview container, persist what
   * comes back, and hand it to a published render later with no context.
   */
  const breakpoints = {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  } as never;

  /*
   * A node carrying a real declaration at a real breakpoint.
   *
   * `node()` above has no styles, so compiling it produces an EMPTY sheet — and
   * a refusal assertion of `css === ""` against that passes without the refusal
   * ever running. The control below is what exposed that, which is the reason
   * it is here rather than as a courtesy.
   */
  const styled: BlockNode = {
    id: "a",
    type: "test/text",
    version: 1,
    props: {},
    styles: { base: { base: { color: "teal" }, tablet: { color: "salmon" } } },
  } as never;

  const compiled = (previewContainer?: string): PageStyles =>
    toPageStyles(
      compilePageCss(doc(styled), {
        breakpoints,
        ...(previewContainer === undefined ? {} : { previewContainer }),
      })
    );

  it("records the container the compiler AIMED AT, not the one requested", () => {
    // The population for everything below: without the stamp there is nothing
    // for a context-free read to judge, so the refusal could not be reached.
    // The population first: the fixture must really compile a breakpoint rule,
    // or every assertion below is about an empty sheet.
    expect(compiled().css).toContain("@media (max-width: 991px)");
    expect(compiled("nx-preview-viewport").css).toContain(
      "@container nx-preview-viewport (max-width: 991px)"
    );
    expect(compiled("nx-preview-viewport").previewContainer).toBe(
      "nx-preview-viewport"
    );
    // A REFUSED name compiles published, so the artifact must not claim to be a
    // preview — stamped on request rather than on outcome, every surface that
    // passed a bad name would have its perfectly publishable sheet withheld.
    expect(compiled("none").previewContainer).toBeUndefined();
    expect(compiled().previewContainer).toBeUndefined();
  });

  it("is REFUSED on a context-free read, which no other staleness rule is", () => {
    /*
     * Every other check in `resolvePageStyles` compares the artifact against an
     * input the compile context supplies, so with no context there is nothing
     * to compare and the sheet is trusted. This one is a property of the
     * artifact alone and has to survive that.
     *
     * Served instead, the page renders its base tier and silently loses every
     * breakpoint above it: the `@container` rules name a box only a previewing
     * surface declares, so they match nothing. It looks deliberately styled at
     * one width and stops responding at every other, which is the failure mode
     * worth refusing a sheet over.
     */
    const styles = resolvePageStyles(
      doc(styled),
      compiled("nx-preview-viewport"),
      undefined,
      blocks
    );

    expect(styles.css).toBe("");
    // The classes survive the refusal, so a host stylesheet still has something
    // to select: refusing the CSS is not refusing the artifact.
    expect(styles.classes).toHaveProperty("a");
  });

  it("SERVES a published artifact on the same path, which is the control", () => {
    /*
     * Without this the refusal above is satisfied by absence — a resolver that
     * returned an empty sheet for every context-free read would pass it while
     * making stored styles useless.
     *
     * Same document, same call, same absent context; only the stamp differs.
     */
    const styles = resolvePageStyles(
      doc(styled),
      compiled(),
      undefined,
      blocks
    );

    expect(styles.css).not.toBe("");
  });

  it("SERVES an artifact whose preview name the compiler refused", () => {
    // The other direction of the stamp-on-outcome rule: a refused name means a
    // published sheet, and withholding it would break previewing surfaces that
    // passed a bad name rather than protecting anyone.
    const styles = resolvePageStyles(
      doc(styled),
      compiled("none"),
      undefined,
      blocks
    );

    expect(styles.css).not.toBe("");
  });
});

describe("a preview artifact read back UNDER a context", () => {
  /*
   * The context-free refusal above must not become a blanket one. A preview
   * render supplies the same context it compiled under, and the stamp already
   * proves the inputs match — so recompiling there buys nothing and costs a
   * full compile of the document on every render of the editor's canvas.
   */
  const breakpoints = {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  } as never;

  const styled: BlockNode = {
    id: "a",
    type: "test/text",
    version: 1,
    props: {},
    styles: { base: { base: { color: "teal" }, tablet: { color: "salmon" } } },
  } as never;

  const context = (previewContainer?: string): StyleCompileContext =>
    ({
      breakpoints,
      ...(previewContainer === undefined ? {} : { previewContainer }),
    }) as never;

  /*
   * A stored artifact whose CSS is recognisable, which is what separates the
   * two outcomes.
   *
   * Reuse and recompilation both return a sheet, and for an unmodified artifact
   * they return equal ones — so asserting on the CSS alone cannot tell them
   * apart. Marking the stored copy makes reuse observable: the marker survives
   * only if the stored bytes were served rather than regenerated.
   */
  const marked = (previewContainer?: string): PageStyles => {
    const compiled = toPageStyles(
      compilePageCss(doc(styled), context(previewContainer) as never),
      undefined,
      undefined,
      sharedStyleInputsId(withTypographyDefaults(context(previewContainer)))
    );
    return { ...compiled, css: `${compiled.css}\n/* stored-copy */` };
  };

  it("is REUSED when the context it is read under matches", () => {
    const styles = resolvePageStyles(
      doc(styled),
      marked("nx-preview-viewport"),
      context("nx-preview-viewport"),
      blocks
    );

    expect(styles.css).toContain("stored-copy");
  });

  it("is REFUSED when read under a published context, which is the control", () => {
    /*
     * Without this the reuse above is satisfied by a resolver that trusts every
     * artifact it is handed — which is the defect the context-free refusal
     * exists to stop, reintroduced one layer up.
     *
     * The stamp is what discriminates: `sharedStyleInputsId` folds the preview
     * container into its breakpoint contexts, so the preview artifact's stamp
     * cannot match a published context's.
     */
    const styles = resolvePageStyles(
      doc(styled),
      marked("nx-preview-viewport"),
      context(),
      blocks
    );

    expect(styles.css).not.toContain("stored-copy");
    // Recompiled rather than withheld: a context was available, so the right
    // answer is a correct sheet rather than an empty one.
    expect(styles.css).toContain("@media (max-width: 991px)");
  });
});
