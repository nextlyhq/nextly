/**
 * One render, one answer per site-level input.
 *
 * A render carries two style inputs — the route's `styleContext` and the site's
 * `siteStyles` — and compiles twice from them: the shared sheet, and the page's
 * own values. Every input both compiles read has to be resolved once. Two
 * computations of one question disagree silently, because each sheet is
 * internally consistent and neither reports anything.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BreakpointSet,
  type SiteSheetInput,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/** The route's tier: what the config states in code. */
const ROUTE_BREAKPOINTS: BreakpointSet = {
  viewport: [{ id: "base", label: "Base" }],
  container: [],
};

/** The site's tier: what an admin stored, which the route's tier does not know. */
const STORED_BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "base", label: "Base" },
    { id: "sm", label: "Small", maxWidth: 600 },
  ],
  container: [],
};

function documentWith(styles: unknown): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/text",
        version: 1,
        props: { text: "body" },
        styles,
      },
    ],
  } as unknown as BlockDocument;
}

function render(args: {
  styles?: unknown;
  styleContext: StyleCompileContext;
  siteStyles: SiteSheetInput;
}): string {
  return renderToStaticMarkup(
    <PageRenderer
      document={documentWith(args.styles ?? {})}
      blocks={createBlockResolver(coreBlocks)}
      styleContext={args.styleContext}
      siteStyles={args.siteStyles}
    />
  );
}

describe("breakpoints", () => {
  it("compiles a node's own value under a breakpoint only the SITE defines", () => {
    // The stored tier replaces the set as a whole, so an id the route's tier
    // lacks is an ordinary consequence of an admin adding one. Compiled against
    // the route's set the value is DROPPED — the engine reports
    // "so these values were not written", and a published render surfaces no
    // warnings — so the page silently loses the style.
    const out = render({
      styles: { base: { sm: { color: "#ff0000" } } },
      styleContext: { breakpoints: ROUTE_BREAKPOINTS },
      siteStyles: { breakpoints: STORED_BREAKPOINTS },
    });

    expect(out).toContain("max-width: 600px");
    expect(out).toContain("#ff0000");
  });

  it("still uses the route's set when the site states none", () => {
    // The control: the site tier winning must not mean the route tier is
    // ignored when there is nothing to win with.
    const out = render({
      styles: { base: { base: { color: "#00ff00" } } },
      styleContext: { breakpoints: ROUTE_BREAKPOINTS },
      siteStyles: { breakpoints: ROUTE_BREAKPOINTS },
    });

    expect(out).toContain("#00ff00");
  });
});

describe("token prefix", () => {
  const TOKENS = {
    tokens: [
      {
        name: "color.brand",
        kind: "color" as const,
        values: { light: "#123456" },
      },
    ],
    prefix: "--brand-",
  };

  it("references the property the sheet declared, not the default prefix", () => {
    // The sheet DECLARES the custom properties and the page compile REFERENCES
    // them. A stored prefix reaching only the sheet leaves every reference
    // pointing at a property nothing declared, and an unresolved custom
    // property invalidates the declaration rather than reporting.
    const out = render({
      styles: { base: { base: { color: { $token: "color.brand" } } } },
      styleContext: { breakpoints: ROUTE_BREAKPOINTS },
      siteStyles: { breakpoints: ROUTE_BREAKPOINTS, tokens: TOKENS },
    });

    expect(out).toContain("--brand-color-brand");
    expect(out).not.toContain("var(--site-color-brand)");
  });
});

describe("block bases", () => {
  it("gives both compiles the same block-default set", () => {
    // The same shape as the two above, and the one no finding named. BOTH
    // compiles emit a block-type tier from their own `blockBases`, and the page
    // sheet is appended after the shared one — so two different sets means the
    // shared sheet writes one default and the page sheet overwrites it with
    // another, each internally consistent.
    //
    // The route's colour is what must NOT survive: asserting only that the
    // site's appears passes either way, because the shared sheet emitted it
    // before this change too.
    const out = render({
      styleContext: {
        breakpoints: ROUTE_BREAKPOINTS,
        blockBases: {
          "core/text": { base: { base: { color: "#111111" } } },
        } as unknown as Record<string, never>,
      },
      siteStyles: {
        breakpoints: ROUTE_BREAKPOINTS,
        blockBases: {
          "core/text": { base: { base: { color: "#abcdef" } } },
        } as unknown as Record<string, never>,
      },
    });

    expect(out).toContain("#abcdef");
    expect(out).not.toContain("#111111");
  });
});

describe("named classes", () => {
  it("keeps letting a context that states its own outrank the site's", () => {
    // Precedence is NOT what this change is about — the defect was two
    // computations of one question, so each input keeps the rule it had. A
    // context stating an empty list means "no classes", and the site's library
    // must not override that.
    const out = render({
      styleContext: { breakpoints: ROUTE_BREAKPOINTS, namedClasses: [] },
      siteStyles: {
        breakpoints: ROUTE_BREAKPOINTS,
        classes: [
          {
            id: "c1",
            slug: "accent",
            orderIndex: 0,
            styles: { base: { base: { color: "#fedcba" } } },
          } as unknown as never,
        ],
      },
    });

    // Deferral is about ATTRIBUTION, not about losing the rules: the sheet
    // still carries the library, and what the context's own list changes is
    // whether an element is given the class name. Asserting the colour's
    // absence would demand the sheet drop the library, which is a different
    // and wrong behaviour.
    expect(out).toContain(".nx-c-accent");
    expect(out).not.toMatch(/class="[^"]*\bnx-c-accent\b/);
  });
});
