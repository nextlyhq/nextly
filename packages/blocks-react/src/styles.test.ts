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

import { createBlockResolver } from "./resolver";
import { resolvePageStyles, type PageStyles } from "./styles";

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
