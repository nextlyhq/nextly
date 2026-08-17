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

  it("emits NOTHING when the host asks for no site sheet", () => {
    // The behaviour every existing consumer had before this prop existed, and
    // the reason it is opt-in: emitting token definitions unasked changes what
    // a stored `{ $token }` resolves to, and a page whose appearance depends on
    // one of those dangling is a page that moves.
    const out = html();

    expect(out).not.toContain("--site-");
    expect(out).not.toContain("data-nx-site-sheet");
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
