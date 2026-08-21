import {
  escapeIdentifier,
  nodeClassName,
  PAGE_ROOT_SELECTOR,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  scrubCommitOp,
  scrubPreviewCss,
  type ScrubTarget,
} from "./style-scrub";

/** Scrubbing the bottom margin of one node. */
const TARGET: ScrubTarget = {
  nodeId: "n1",
  nodeClass: nodeClassName("n1"),
  address: {
    state: "base",
    breakpoint: "desktop",
    property: "margin",
    path: ["blockEnd"],
  },
};

describe("the CSS a drag shows", () => {
  it("emits the property the catalog maps this path to", () => {
    const preview = scrubPreviewCss(TARGET, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("margin-block-end: 32px");
  });

  it("anchors to the compiler's own root selector rather than a stronger one", () => {
    // The number of repetitions in that selector IS the override contract. A
    // preview that outranked the committed rule would land where the stored
    // value will not, and the difference would only appear on release.
    const preview = scrubPreviewCss(TARGET, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css.startsWith(PAGE_ROOT_SELECTOR)).toBe(true);
    expect(preview.css).toContain(`.${nodeClassName("n1")}`);
  });

  it("emits ONLY the property being scrubbed", () => {
    // Everything else the node carries still comes from the sheet underneath,
    // so previewing one side must not restate — or drop — the other three.
    const preview = scrubPreviewCss(TARGET, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).not.toContain("margin-block-start");
    expect(preview.css).not.toContain("margin-inline");
  });

  it("compiles a token reference the way the published sheet does", () => {
    // The separating property against a preview that formatted the value
    // itself: a token is a `var()` on the page, and a hand-written preview
    // would show the literal `[object Object]` or the raw name.
    const preview = scrubPreviewCss(TARGET, { $token: "space.large" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("var(--site-space-large)");
  });

  it("refuses a value the compiler would not write, so it never reaches the screen", () => {
    const preview = scrubPreviewCss(TARGET, "notalength");
    expect(preview.ok).toBe(false);
  });

  it("accepts the values the compiler accepts", () => {
    // The vacuity control for the refusal above: a preview that refused
    // everything would satisfy that test while showing nothing ever.
    for (const value of ["0", "1.5rem", "24px", "10%"]) {
      expect(scrubPreviewCss(TARGET, value).ok).toBe(true);
    }
  });
});

describe("the commit that ends a drag", () => {
  it("is exactly one op", () => {
    const result = scrubCommitOp(TARGET, undefined, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toMatchObject({ kind: "update", id: "n1" });
  });

  it("stores the value at the address, not the CSS the preview showed", () => {
    const result = scrubCommitOp(TARGET, undefined, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.op as { patch: { styles?: unknown } };
    expect(op.patch.styles).toEqual({
      base: { desktop: { margin: { blockEnd: "32px" } } },
    });
  });

  it("refuses exactly what the preview refuses", () => {
    // Preview and commit agree by construction because both go through the
    // catalog. This pins that they have not drifted apart.
    for (const value of ["notalength", "24px", "1.5rem", "red"]) {
      expect(scrubCommitOp(TARGET, undefined, value).ok).toBe(
        scrubPreviewCss(TARGET, value).ok
      );
    }
  });
});

describe("a document with a compile scope", () => {
  const SCOPED: ScrubTarget = { ...TARGET, scope: "region-one" };

  it("anchors the preview to the SAME root the compiled sheet uses", () => {
    // `compilePageCss` emits `${PAGE_ROOT_SELECTOR}.${scope}`. A preview at the
    // unscoped root carries one class fewer, so the stored rule outranks it and
    // the drag shows nothing move.
    const preview = scrubPreviewCss(SCOPED, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css.startsWith(`${PAGE_ROOT_SELECTOR}.region-one `)).toBe(
      true
    );
  });

  it("escapes a scope through the engine's own escaper", () => {
    // A scope needing escapes must be spelled here exactly as the compiler
    // spells it, or the two selectors address different elements.
    const preview = scrubPreviewCss({ ...TARGET, scope: "a.b" }, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain(escapeIdentifier("a.b"));
    expect(preview.css).not.toContain(`${PAGE_ROOT_SELECTOR}.a.b `);
  });

  it("stays unscoped when the document has no scope", () => {
    const preview = scrubPreviewCss(TARGET, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css.startsWith(`${PAGE_ROOT_SELECTOR} `)).toBe(true);
  });
});

describe("the site's URL policy", () => {
  /** Scrubbing `background.url`, which is the catalog's only URL leaf. */
  const IMAGE: ScrubTarget = {
    nodeId: "n1",
    nodeClass: nodeClassName("n1"),
    address: {
      state: "base",
      breakpoint: "desktop",
      property: "background",
      path: ["url"],
    },
  };

  it("refuses a host the site does not allow, so it never previews or fetches", () => {
    const preview = scrubPreviewCss(
      { ...IMAGE, policy: { mayFetchUrl: () => false } },
      "https://elsewhere.example/x.png"
    );
    expect(preview.ok).toBe(false);
  });

  it("accepts the same URL when the site allows the host", () => {
    // The pair is what makes the refusal evidence: without this, a preview that
    // refused every URL would satisfy the assertion above.
    const preview = scrubPreviewCss(
      { ...IMAGE, policy: { mayFetchUrl: () => true } },
      "https://elsewhere.example/x.png"
    );
    expect(preview.ok).toBe(true);
  });

  it("forwards the same policy to the commit, so preview and write agree", () => {
    const policy = { mayFetchUrl: () => false };
    const url = "https://elsewhere.example/x.png";
    expect(scrubCommitOp({ ...IMAGE, policy }, undefined, url).ok).toBe(
      scrubPreviewCss({ ...IMAGE, policy }, url).ok
    );
  });
});
