/**
 * The site stylesheet reaches the page.
 *
 * Until this existed, nothing in the repository called `compileSiteSheet`: the
 * token pipeline was built, tested and unreachable, so `defaultSiteTokens()`
 * was a default nobody applied and every `{ $token }` in a block compiled to a
 * `var()` with nothing behind it. Three shipped blocks were broken by that and
 * nobody noticed, because an unresolved custom property makes the declaration
 * invalid at computed-value time — the property silently falls back to its
 * initial value rather than reporting anything.
 *
 * So these assert the EMITTED MARKUP, not that a function was called. A test
 * that checked `compileSiteSheet` had been invoked would have passed on the
 * arrangement that shipped the defect.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { NODE_ID_ATTRIBUTE } from "./block-boundary";
import { box } from "./blocks/box";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const DOC: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

function html(siteStyles?: Parameters<typeof PageRenderer>[0]["siteStyles"]) {
  return renderToStaticMarkup(
    <PageRenderer
      document={DOC}
      blocks={createBlockResolver([box])}
      styleContext={{ breakpoints: BREAKPOINTS }}
      {...(siteStyles === undefined ? {} : { siteStyles })}
    />
  );
}

describe("the site stylesheet", () => {
  it("puts the DEFAULT tokens on the page when the host names none of its own", () => {
    // The whole point. A host that supplies only its breakpoints still gets the
    // default token set as real custom properties, which is what makes a
    // `{ $token }` anywhere resolve to something.
    const out = html({ breakpoints: BREAKPOINTS });

    expect(out).toContain("--site-space-4");
    expect(out).toContain("--site-color-primary");
    expect(out).toContain("--site-content-width");
  });

  it("emits the DEFAULT set even when the host says nothing", () => {
    // Changed deliberately: this asserted the opposite while the prop was
    // opt-in. The asymmetry it protected cost more than it saved — a block
    // could not reference a token at all, because a default reading
    // `color.surface` resolved on a Nextly route and resolved to nothing here.
    // `core/card` shipped with no background because of it.
    const out = html();

    expect(out).toContain("data-nx-site-sheet");
    expect(out).toContain("--site-color-surface");
  });

  it("lets a host opt OUT explicitly, with false", () => {
    // The escape hatch, and it must be reachable or "default on" becomes
    // "mandatory". `false` rather than an empty token list, because
    // `resolveSiteTokens` LAYERS: an empty override means "no overrides" and
    // still yields every default. This test is what found that the opt-out did
    // not exist at all.
    const out = html(false);

    expect(out).not.toContain("--site-color-surface");
  });

  it("lets a site override a default by NAME while the others survive", () => {
    // The failure this guards is silent: replacing the set to change one colour
    // drops `content.width` and `space.4`, every block reading them falls back
    // to its initial value, and nothing reports it.
    const out = html({
      breakpoints: BREAKPOINTS,
      tokens: {
        tokens: [
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#ff0000" },
          },
        ],
      },
    });

    expect(out).toContain("#ff0000");
    // The SURVIVORS are the assertion, not the override.
    expect(out).toContain("--site-space-4");
    expect(out).toContain("--site-content-width");
  });

  it("emits the site sheet BEFORE the page's own, because order is the cascade", () => {
    // `compileSiteSheet` carries font faces, tokens and block-type defaults;
    // the page sheet is appended after, which is what lets a node's own value
    // beat a class and a class beat a block default. Reversed, every one of
    // those inverts — and nothing else in the output would look different.
    // A node carrying its OWN style, so a page sheet exists at all to be
    // ordered against. A bare box compiles to no page CSS, and the comparison
    // would then be against nothing — passing or failing for a reason that has
    // nothing to do with order.
    const styled: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: { minWidth: "0" } } },
        },
      ],
    };
    const out = renderToStaticMarkup(
      <PageRenderer
        document={styled}
        blocks={createBlockResolver([box])}
        styleContext={{ breakpoints: BREAKPOINTS }}
        siteStyles={{ breakpoints: BREAKPOINTS }}
      />
    );

    const site = out.indexOf("data-nx-site-sheet");
    const page = out.indexOf("min-width");

    expect(site).toBeGreaterThanOrEqual(0);
    expect(page).toBeGreaterThanOrEqual(0);
    expect(site).toBeLessThan(page);
  });

  it("addresses the sheet by a content hash, so a host can serve it once", () => {
    // Same bytes, same name, on every machine and run — which is what lets a
    // host recognise the shared sheet across pages instead of inlining it per
    // page. Two renders of the same input must agree.
    const first = html({ breakpoints: BREAKPOINTS });
    const second = html({ breakpoints: BREAKPOINTS });
    const hashOf = (markup: string) =>
      /data-nx-site-sheet="([^"]+)"/.exec(markup)?.[1];

    expect(hashOf(first)).toBeDefined();
    expect(hashOf(first)).toBe(hashOf(second));
    // And it MOVES when the tokens do, or it would name stale bytes.
    const changed = html({
      breakpoints: BREAKPOINTS,
      tokens: {
        tokens: [
          {
            name: "color.primary",
            kind: "color",
            values: { light: "#0000ff" },
          },
        ],
      },
    });
    expect(hashOf(changed)).not.toBe(hashOf(first));
  });
});

describe("the per-node DOM address", () => {
  /**
   * The case that DECIDES this, and the one both existing mechanisms skip.
   *
   * A node with no compiled styles, no `cssId` and no `attributes` — which is
   * nearly every node on a real page. `classNameFor` gives such a node only the
   * block-TYPE class, so hit-testing on the class cannot address it and would
   * resolve to the wrong instance; and `withNodeAttributes` early-returns before
   * its clone for exactly this node, so an address joined to the attribute
   * allowlist would land on almost nothing.
   *
   * A fixture carrying styles, a `cssId` or an attribute passes while the common
   * node stays uncovered, which is why this one carries none of the three.
   */
  const BARE: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "bare-node", type: "core/box", version: 1, props: {} }],
  };

  function render(nodeAttribute?: boolean) {
    return renderToStaticMarkup(
      <PageRenderer
        document={BARE}
        blocks={createBlockResolver([box])}
        styleContext={{ breakpoints: BREAKPOINTS }}
        {...(nodeAttribute === undefined ? {} : { nodeAttribute })}
      />
    );
  }

  it("is ABSENT by default, so a published page carries no editor concern", () => {
    // The same reason Gutenberg emits `data-block` in the editor and not in post
    // content. Opt-in is also reversible; always-on would be a breaking change
    // to remove once anything scraped it.
    expect(render()).not.toContain(NODE_ID_ATTRIBUTE);
  });

  it("reaches the DOM for a node with no styles, no cssId and no attributes", () => {
    const out = render(true);

    expect(out).toContain(`${NODE_ID_ATTRIBUTE}="bare-node"`);
  });

  it("carries the node's own id, not the block type", () => {
    // A type class is shared by every instance, which is why the class cannot
    // serve as an address. The attribute must be per NODE or it selects the
    // wrong one confidently.
    const out = render(true);

    expect(out).toContain('="bare-node"');
    expect(out).not.toContain(`${NODE_ID_ATTRIBUTE}="core/box"`);
  });
});

describe("a node's named-class references", () => {
  const CLASSED: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "classed-node",
        type: "core/box",
        version: 1,
        props: {},
        classes: ["accent-id"],
      },
    ],
  };

  const ACCENT = {
    id: "accent-id",
    slug: "accent",
    orderIndex: 0,
    styles: { base: { base: { color: "#123123" } } },
  };

  it("resolve through the SAME class list the site sheet is compiled from", () => {
    // The sheet writes the `.nx-c-<slug>` rule from `siteStyles.classes`; the
    // node's stored ids resolve to names in the page compile, whose context
    // said nothing about classes here. If the two read different lists, a
    // stored class emits a rule no element carries — each half internally
    // consistent — so the assertion is over both: the rule AND the name.
    const out = renderToStaticMarkup(
      <PageRenderer
        document={CLASSED}
        blocks={createBlockResolver([box])}
        styleContext={{ breakpoints: BREAKPOINTS }}
        siteStyles={{ breakpoints: BREAKPOINTS, classes: [ACCENT] }}
      />
    );

    expect(out).toContain(".nx-c-accent");
    // The name inside a class ATTRIBUTE, not merely anywhere in the markup —
    // the sheet's own rule text also contains it.
    expect(out).toMatch(/class="[^"]*\bnx-c-accent\b/);
  });

  it("defer to a compile context that states its OWN class list", () => {
    // An explicit choice by the caller outranks what can be derived — the same
    // rule the renderer applies to a context carrying its own blockBases. The
    // context's empty list means "this site has no classes", so the node's
    // reference resolves to nothing even though the sheet got a library.
    const out = renderToStaticMarkup(
      <PageRenderer
        document={CLASSED}
        blocks={createBlockResolver([box])}
        styleContext={{ breakpoints: BREAKPOINTS, namedClasses: [] }}
        siteStyles={{ breakpoints: BREAKPOINTS, classes: [ACCENT] }}
      />
    );

    // The sheet still carries the library's rule; what the deferral changes
    // is ATTRIBUTION, so the element must not carry the name.
    expect(out).not.toMatch(/class="[^"]*\bnx-c-accent\b/);
    // The separating property. The absence above is satisfied just as well by a
    // render that lost the class library altogether — measured, dropping
    // `siteStyles.classes` produces the same missing attribute — so on its own
    // it cannot tell deferred attribution from a lost library. The sheet still
    // carrying the rule is what makes it the former.
    expect(out).toContain(".nx-c-accent");
  });
});

describe("which preview answer the site sheet is compiled with", () => {
  /**
   * A named class carrying a hover style, which is the tier that separates the
   * two sheets: it is emitted HERE and not with the page, so it is the only
   * place the two compiles can disagree about what a state selector looks like.
   */
  const HOVER_CLASS = [
    {
      id: "c1",
      slug: "card",
      orderIndex: 0,
      styles: { hover: { base: { color: "#000002" } } },
    },
  ];

  function sheetFor(
    route: boolean | undefined,
    stored: boolean | undefined
  ): string {
    return renderToStaticMarkup(
      <PageRenderer
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "n1",
                type: "core/box",
                version: 1,
                props: {},
                classes: ["c1"],
              },
            ],
          } as unknown as BlockDocument
        }
        blocks={createBlockResolver([box])}
        styleContext={{
          breakpoints: BREAKPOINTS,
          ...(route === undefined ? {} : { previewStates: route }),
        }}
        siteStyles={
          {
            breakpoints: BREAKPOINTS,
            classes: HOVER_CLASS,
            ...(stored === undefined ? {} : { previewStates: stored }),
          } as never
        }
      />
    );
  }

  const MARKER = "nx-pb-state-hover";

  it("emits the forceable form when the route asks for it", () => {
    // The control. Without it the refusal below could be a class that never
    // reached the sheet at all, and every assertion here would agree.
    expect(sheetFor(true, undefined)).toContain(MARKER);
  });

  it("obeys a route that turns the preview OFF over a stored sheet that had it ON", () => {
    /*
     * The route is reconciled as the winner, and a stored artifact saying
     * otherwise must lose in BOTH directions. Overriding only when the resolved
     * answer is `true` leaves the stored `true` standing in the spread the site
     * sheet is built from — so the page's own rules compile to published
     * selectors while the class tier compiles to preview ones, and one document
     * carries two answers to what `:hover` means.
     */
    expect(sheetFor(false, true)).not.toContain(MARKER);
  });
});
