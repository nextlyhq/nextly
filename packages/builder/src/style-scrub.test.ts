import {
  compilePageCss,
  escapeIdentifier,
  nodeClassName,
  PAGE_ROOT_SELECTOR,
  STYLE_STATES,
  type BlockDocument,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  scrubCommitOp,
  scrubPreviewCss,
  scrubStateFragments,
  type ScrubTarget,
} from "./style-scrub";

/** Scrubbing the bottom margin of one node. */
const TARGET: ScrubTarget = {
  nodeId: "n1",
  nodeClass: nodeClassName("n1"),
  address: {
    state: "base",
    breakpoint: "base",
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
      base: { base: { margin: { blockEnd: "32px" } } },
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
      breakpoint: "base",
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

describe("the site's token prefix", () => {
  const TOKENED: ScrubTarget = { ...TARGET, tokenPrefix: "--acme-" };

  it("emits tokens under the prefix the site publishes with", () => {
    // A preview compiled with the default reads `var(--site-…)` while the
    // published sheet reads `var(--acme-…)`, so the token resolves to nothing —
    // or to something else — for exactly as long as the drag lasts.
    const preview = scrubPreviewCss(TOKENED, { $token: "space.large" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("var(--acme-space-large)");
    expect(preview.css).not.toContain("--site-");
  });

  it("uses the engine's default when the site configured none", () => {
    const preview = scrubPreviewCss(TARGET, { $token: "space.large" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("var(--site-space-large)");
  });
});

describe("preview and commit judge the same thing", () => {
  it("is not blocked by an unrelated invalid value at the same breakpoint", () => {
    // Validating the whole breakpoint map would let one bad value — a URL a
    // changed site policy now refuses, say — block every other control on that
    // breakpoint, with the preview still showing the drag as fine.
    const withBadSibling = {
      base: { desktop: { margin: { blockEnd: "24px" }, height: "notalength" } },
    };
    const preview = scrubPreviewCss(TARGET, "32px");
    const commit = scrubCommitOp(TARGET, withBadSibling, "32px");
    expect(preview.ok).toBe(true);
    expect(commit.ok).toBe(true);
  });

  it("still refuses when the scrubbed value itself is invalid", () => {
    // The negative half: scoping validation to one property must not stop it
    // judging that property.
    expect(scrubCommitOp(TARGET, undefined, "notalength").ok).toBe(false);
  });
});

describe("against the selector the compiler actually emits", () => {
  // The assertions above build the expected selector the same way the code
  // does, so they agree with it whatever it spells. These compile a real
  // document and compare against the rule that comes out, which is the only
  // thing that can tell a correct construction from a plausible wrong one.

  /** The selector `compilePageCss` writes for one styled node. */
  function compiledSelector(scope?: string): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: { margin: { blockEnd: "24px" } } } },
        },
      ],
    };
    const compiled = compilePageCss(document, {
      breakpoints: {
        viewport: [{ id: "base", label: "Desktop" }],
        container: [],
      },
      ...(scope === undefined ? {} : { scope }),
    });
    expect(compiled.warnings).toEqual([]);
    return compiled.css.split("{")[0].trim();
  }

  /** The selector the preview writes for the same node. */
  function previewSelector(scope?: string): string {
    const target: ScrubTarget = {
      nodeId: "n1",
      nodeClass: nodeClassName("n1"),
      ...(scope === undefined ? {} : { scope }),
      address: {
        state: "base",
        breakpoint: "base",
        property: "margin",
        path: ["blockEnd"],
      },
    };
    const preview = scrubPreviewCss(target, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("expected a preview");
    return preview.css.split("{")[0].trim();
  }

  it("matches on an unscoped document", () => {
    expect(previewSelector()).toBe(compiledSelector());
  });

  it("matches on a scoped document", () => {
    expect(previewSelector("region-one")).toBe(compiledSelector("region-one"));
  });

  it("matches on a scope that needs escaping", () => {
    // `a.b` would otherwise read as two classes. The preview and the compiler
    // must escape it identically or they address different elements.
    expect(previewSelector("a.b")).toBe(compiledSelector("a.b"));
  });
});

describe("a compiler setting the engine recovered from", () => {
  // An invalid `tokenPrefix` does not stop the compiler: it writes the
  // declarations under the default prefix and says so. Measured — a plain
  // `24px` compiles to one declaration and one `severity: "warning"` issue.
  // Reading the issue list's LENGTH conflates that with a refusal.
  const BAD_PREFIX: ScrubTarget = { ...TARGET, tokenPrefix: "notaprefix" };

  it("still previews a literal value that has nothing to do with tokens", () => {
    const preview = scrubPreviewCss(BAD_PREFIX, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("margin-block-end: 32px");
  });

  it("carries the remark rather than dropping it", () => {
    // A warning is the compiler explaining something about output it wrote. A
    // preview that discarded it would present a recovered-from setting as an
    // unremarkable one.
    const preview = scrubPreviewCss(BAD_PREFIX, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.warnings.length).toBeGreaterThan(0);
    expect(preview.warnings.every(issue => issue.severity !== "error")).toBe(
      true
    );
  });

  it("previews a token under the prefix the compiler fell back to", () => {
    const preview = scrubPreviewCss(BAD_PREFIX, { $token: "space.large" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("var(--site-space-large)");
  });

  it("still refuses a value the compiler wrote nothing for", () => {
    // The other half of the pair: separating warnings from errors must not
    // stop a real refusal being a refusal.
    const refused = scrubPreviewCss(BAD_PREFIX, "notalength");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues.some(issue => issue.severity === "error")).toBe(true);
  });

  it("reports no warnings on a well-configured site", () => {
    // The control that keeps the assertions above meaningful: if every preview
    // carried warnings, "warnings.length > 0" would say nothing.
    const preview = scrubPreviewCss(TARGET, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.warnings).toEqual([]);
  });
});

describe("the selector at each state the catalog supports", () => {
  // A preview that ignored the state would match the node in ALL of them:
  // dragging a hover value would repaint the resting appearance, and releasing
  // would reveal behaviour the drag never showed.

  /** The selector `compilePageCss` writes for one node styled at `state`. */
  function compiledAt(state: StyleState): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { [state]: { base: { margin: { blockEnd: "24px" } } } },
        },
      ],
    };
    const compiled = compilePageCss(document, {
      breakpoints: {
        viewport: [{ id: "base", label: "Desktop" }],
        container: [],
      },
    });
    expect(compiled.warnings).toEqual([]);
    return compiled.css.split("{")[0].trim();
  }

  /** The selector the preview writes for the same node at the same state. */
  function previewAt(state: StyleState): string {
    const preview = scrubPreviewCss(
      {
        nodeId: "n1",
        nodeClass: nodeClassName("n1"),
        address: {
          state,
          breakpoint: "base",
          property: "margin",
          path: ["blockEnd"],
        },
      },
      "32px"
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("expected a preview");
    return preview.css.split("{")[0].trim();
  }

  it("matches the compiler on every state, not just base", () => {
    // Swept over the engine's own list, so a state added there is covered here
    // without an edit.
    expect(STYLE_STATES.length).toBeGreaterThan(1);
    for (const state of STYLE_STATES) {
      expect(previewAt(state)).toBe(compiledAt(state));
    }
  });

  it("constrains a non-base state and leaves base unconstrained", () => {
    // The control that keeps the sweep meaningful: if every fragment were
    // empty, matching the compiler would be trivially true and the preview
    // would still repaint the resting appearance.
    const fragments = scrubStateFragments();
    expect(fragments.get("base")).toBe("");
    for (const state of STYLE_STATES.filter(s => s !== "base")) {
      expect(fragments.get(state)).not.toBe("");
      expect(fragments.get(state)).toContain(":where(");
    }
  });
});

describe("a scope the compiler refuses", () => {
  // `scopeSelector` refuses an empty scope and one carrying ASCII whitespace —
  // `a b` in a class attribute is two classes, and no escaping makes it the one
  // class the renderer attached — so it warns and emits unscoped rules.

  function compiledWith(scope: string): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: { margin: { blockEnd: "24px" } } } },
        },
      ],
    };
    return compilePageCss(document, {
      breakpoints: {
        viewport: [{ id: "base", label: "Desktop" }],
        container: [],
      },
      scope,
    })
      .css.split("{")[0]
      .trim();
  }

  it("falls back to the unscoped root exactly as the compiler does", () => {
    // Escaping the whitespace instead would require a class the DOM cannot
    // hold, so the preview would show nothing while the commit produced
    // working CSS.
    for (const scope of ["a b", " ", "one\ttwo"]) {
      const preview = scrubPreviewCss({ ...TARGET, scope }, "32px");
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.css.split("{")[0].trim()).toBe(compiledWith(scope));
    }
  });

  it("still scopes a scope the compiler accepts", () => {
    // The control: falling back for everything would make the assertion above
    // pass while the scoped case silently lost its class.
    const preview = scrubPreviewCss({ ...TARGET, scope: "region-one" }, "32px");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css.split("{")[0].trim()).toBe(compiledWith("region-one"));
    expect(preview.css).toContain(".region-one");
  });
});

describe("a breakpoint the compiler wraps in a query", () => {
  const BREAKPOINTS = {
    viewport: [
      { id: "base", label: "Desktop" },
      { id: "mobile", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  };

  /** The compiled sheet for one node styled at `breakpoint`. */
  function compiledAt(breakpoint: string): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { [breakpoint]: { margin: { blockEnd: "24px" } } } },
        },
      ],
    };
    return compilePageCss(document, { breakpoints: BREAKPOINTS }).css.trim();
  }

  function previewAt(breakpoint: string) {
    return scrubPreviewCss(
      {
        ...TARGET,
        breakpoints: BREAKPOINTS,
        address: { ...TARGET.address, breakpoint },
      },
      "32px"
    );
  }

  it("wraps the preview in the same query the committed rule gets", () => {
    // Without this the value appears at every width and vanishes on release.
    expect(compiledAt("mobile")).toContain("@media (max-width: 640px)");
    const preview = previewAt("mobile");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).toContain("@media (max-width: 640px)");
    expect(preview.css).toContain("margin-block-end: 32px");
  });

  it("leaves an unconditional breakpoint unwrapped", () => {
    // The control: wrapping everything would pass the assertion above while
    // burying base values in a query they never had.
    expect(compiledAt("base")).not.toContain("@media");
    const preview = previewAt("base");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.css).not.toContain("@media");
  });

  it("refuses a breakpoint this site does not define", () => {
    // The compiler writes NO rule for an unknown id, so an unconditional
    // preview would show a value the published page will never carry.
    expect(compiledAt("tablet")).toBe("");
    expect(previewAt("tablet").ok).toBe(false);
  });
});

describe("a caller that did not say where the preview goes", () => {
  it("refuses a non-base breakpoint when no breakpoint set was supplied", () => {
    // Without the set this cannot know which query the committed rule lands in,
    // and an unconditional preview would show the value at every width.
    const preview = scrubPreviewCss(
      { ...TARGET, address: { ...TARGET.address, breakpoint: "mobile" } },
      "32px"
    );
    expect(preview.ok).toBe(false);
  });

  it("still previews the base breakpoint, which is unconditional", () => {
    // The control: refusing everything would pass the assertion above while
    // making the SDK unusable for the ordinary case.
    expect(scrubPreviewCss(TARGET, "32px").ok).toBe(true);
  });
});
