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

import { createBlockResolver } from "./resolver";
import {
  resolvePageStyles,
  resolvePageStylesWithTrace,
  toPageStyles,
  type PageStyles,
} from "./styles";

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
