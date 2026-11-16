/**
 * The site sheet is compiled once per change of what it is compiled from, not
 * once per draw.
 *
 * The editor draws a page, and the header and footer around it, again for a
 * selection, a hover or an insert. None of those changes the site's styles, so
 * none of them may compile the site sheet again: on a large site that compile
 * is the costliest part of a header's draw.
 *
 * Counted through the engine's two compilers, wrapped and passed through, and
 * checked against the markup, so a kept sheet is shown to be the same sheet.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockDocument, SiteSheetInput } from "@nextlyhq/blocks-engine";

const counted = vi.hoisted(() => ({ compiles: 0 }));

vi.mock("@nextlyhq/blocks-engine", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/blocks-engine")>();
  return {
    ...real,
    compileSiteSheet: (...args: Parameters<typeof real.compileSiteSheet>) => {
      counted.compiles += 1;
      return real.compileSiteSheet(...args);
    },
    compileSiteTokenSheet: (
      ...args: Parameters<typeof real.compileSiteTokenSheet>
    ) => {
      counted.compiles += 1;
      return real.compileSiteTokenSheet(...args);
    },
  };
});

import type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";

import { box } from "./blocks/box";
import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const BLOCKS = createBlockResolver([box]);

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

function documentOf(ids: readonly string[]): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: ids.map(id => ({ id, type: "core/box", version: 1, props: {} })),
  };
}

function draw(
  document: BlockDocument,
  siteStyles: SiteSheetInput,
  styleContext: { breakpoints: typeof BREAKPOINTS; scope?: string } = {
    breakpoints: BREAKPOINTS,
  }
): string {
  return renderToStaticMarkup(
    <PageRenderer
      document={document}
      blocks={BLOCKS}
      styleContext={styleContext}
      siteStyles={siteStyles}
    />
  );
}

/** A site whose one colour token is `light`. */
function colouredSite(light: string): SiteSheetInput {
  return {
    breakpoints: BREAKPOINTS,
    tokens: {
      tokens: [{ name: "color.primary", kind: "color", values: { light } }],
    },
  };
}

/** The site sheet's own element, as the page carries it. */
function siteSheetOf(markup: string): string {
  return (
    /<style data-nx-site-sheet="[^"]*">[^<]*<\/style>/.exec(markup)?.[0] ?? ""
  );
}

beforeEach(() => {
  counted.compiles = 0;
});

describe("the site sheet, compiled once per change of its inputs", () => {
  it("the counter sees the compile: a first draw compiles the sheet", () => {
    draw(documentOf(["a"]), { breakpoints: BREAKPOINTS });
    expect(counted.compiles).toBe(1);
  });

  it("is not compiled again for a draw with the same inputs: a selection or a hover", () => {
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const context = { breakpoints: BREAKPOINTS };
    const first = draw(documentOf(["a", "b"]), site, context);
    const again = draw(documentOf(["a", "b"]), site, context);
    expect(counted.compiles).toBe(1);
    expect(siteSheetOf(again)).toBe(siteSheetOf(first));
    expect(siteSheetOf(first)).not.toBe("");
  });

  it("is not compiled again when only the page's own blocks change: an insert", () => {
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const context = { breakpoints: BREAKPOINTS };
    draw(documentOf(["a"]), site, context);
    draw(documentOf(["a", "inserted"]), site, context);
    expect(counted.compiles).toBe(1);
  });

  it("is compiled again when the site's styles change, and draws the change", () => {
    const context = { breakpoints: BREAKPOINTS };
    const first = draw(documentOf(["a"]), colouredSite("#123456"), context);
    const changed = draw(documentOf(["a"]), colouredSite("#abcdef"), context);
    expect(counted.compiles).toBe(2);
    expect(siteSheetOf(first)).toContain("#123456");
    expect(siteSheetOf(changed)).toContain("#abcdef");
  });

  it("is compiled again under another compile context: a region's own scope", () => {
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const page = { breakpoints: BREAKPOINTS };
    draw(documentOf(["a"]), site, page);
    draw(documentOf(["a"]), site, page);
    expect(counted.compiles).toBe(1);
    draw(documentOf(["a"]), site, {
      breakpoints: BREAKPOINTS,
      scope: "nx-pb-part-header",
    });
    expect(counted.compiles).toBe(2);
  });

  it("is compiled again for another fetch policy: the host's remote patterns", () => {
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const context = { breakpoints: BREAKPOINTS };
    const withPatterns = (hostname: string): void => {
      renderToStaticMarkup(
        <PageRenderer
          document={documentOf(["a"])}
          blocks={BLOCKS}
          styleContext={context}
          siteStyles={site}
          hostPolicy={{ remotePatterns: [{ hostname }] }}
        />
      );
    };
    withPatterns("cdn.example.com");
    withPatterns("cdn.example.com");
    expect(counted.compiles).toBe(1);
    withPatterns("images.example.com");
    expect(counted.compiles).toBe(2);
  });

  it("is compiled again when the page starts drawing a block type with parts", () => {
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const context = { breakpoints: BREAKPOINTS };
    const framed = defineBlock<Record<string, never>>({
      name: "test/framed",
      version: 1,
      description: "A block with a named part.",
      example: { props: {} },
      defaultProps: {},
      parts: { frame: {} },
      render: ({ className }) => <div className={className} />,
    }) as AnyBlockDefinition;
    const blocks = createBlockResolver([box, framed]);
    const drawWith = (document: BlockDocument): void => {
      renderToStaticMarkup(
        <PageRenderer
          document={document}
          blocks={blocks}
          styleContext={context}
          siteStyles={site}
        />
      );
    };
    drawWith(documentOf(["a"]));
    drawWith(documentOf(["a", "b"]));
    expect(counted.compiles).toBe(1);
    drawWith({
      ...documentOf(["a"]),
      nodes: [
        ...documentOf(["a"]).nodes,
        { id: "f", type: "test/framed", version: 1, props: {} },
      ],
    });
    expect(counted.compiles).toBe(2);
  });

  it("is not compiled again for an equal compile context handed as a new object", () => {
    // A region's scoped context is rebuilt whenever the canvas's inputs are
    // handed again, with the same values in it.
    const site: SiteSheetInput = { breakpoints: BREAKPOINTS };
    const context = { breakpoints: BREAKPOINTS, scope: "nx-pb-part-header" };
    draw(documentOf(["a"]), site, context);
    draw(documentOf(["a"]), site, { ...context });
    expect(counted.compiles).toBe(1);
  });

  it("keeps the token-only sheet too, drawn when no breakpoints are known", () => {
    const site = { tokens: undefined } as unknown as SiteSheetInput;
    const tokenDraw = (): string =>
      renderToStaticMarkup(
        <PageRenderer
          document={documentOf([])}
          blocks={BLOCKS}
          siteStyles={site}
          styles={{ css: ".x{color:red}", classes: {}, scope: "nx-doc-a" }}
        />
      );
    const first = tokenDraw();
    const again = tokenDraw();
    expect(siteSheetOf(first)).not.toBe("");
    expect(siteSheetOf(again)).toBe(siteSheetOf(first));
    expect(counted.compiles).toBe(1);
  });
});
