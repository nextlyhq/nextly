/**
 * Whether the stamp reaches the resolver through the PRODUCTION render path.
 *
 * `shared-input-staleness.test.ts` calls `resolvePageStyles` directly and passes
 * the stamp itself, so it proves the comparison works and nothing about whether
 * anything performs it. That gap is not hypothetical: the first version of this
 * feature computed the digest in `effectiveCompile` and forwarded only
 * `fetchPolicyId` to the resolver, so both sides of the comparison were
 * `undefined` on every real render — the whole mechanism inert, with twenty-one
 * passing tests, because each supplied by hand the value production omitted.
 *
 * So these render through `PageRenderer`, which is the only place that mistake
 * is visible.
 *
 * @module shared-input-staleness.renderer.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockDocument, NamedClass } from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks";
import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import { blockBasesFor, type PageStyles } from "./styles";
import { withTypographyDefaults } from "./blocks/typography-defaults";

const document: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "n1",
      type: "core/text",
      version: 1,
      props: { text: "body" },
    },
  ],
};

/** The site's class library, as a render carries it. */
const library = (slug: string): readonly NamedClass[] => [
  {
    id: "c1",
    slug,
    orderIndex: 0,
    styles: { base: { base: { color: "#111111" } } },
  },
];

/** A stored sheet whose text is recognisable if it survives. */
const stored = (sharedInputsId?: string): PageStyles => ({
  css: ".nx-n1{color:rebeccapurple}",
  classes: { n1: "nx-n1" },
  ...(sharedInputsId === undefined ? {} : { sharedInputsId }),
});

function render(styles: PageStyles, namedClasses: readonly NamedClass[]) {
  return renderToStaticMarkup(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      styles={styles}
      styleContext={{
        breakpoints: { viewport: [], container: [] },
        namedClasses,
      }}
    />
  );
}

/** What `effectiveCompile` will derive for the render above. */
const stampFor = (namedClasses: readonly NamedClass[]) =>
  sharedStyleInputsId(
    withTypographyDefaults({
      breakpoints: { viewport: [], container: [] },
      namedClasses,
    })
  );

describe("a page rendered through PageRenderer", () => {
  it("REUSES a stored sheet whose stamp still describes the render", () => {
    // The control. Every refusal below would also pass against a renderer that
    // recompiled unconditionally, which would be the feature failing in the
    // expensive direction rather than the silent one.
    expect(
      render(stored(stampFor(library("hero"))), library("hero"))
    ).toContain("rebeccapurple");
  });

  it("REFUSES a stored sheet after a class was renamed under it", () => {
    // The defect the stamp exists for, exercised where it actually happens. A
    // renderer that computed the digest and did not forward it would reuse the
    // stale sheet here and pass every direct-resolver test.
    expect(
      render(stored(stampFor(library("hero"))), library("banner"))
    ).not.toContain("rebeccapurple");
  });

  it("REFUSES an artifact carrying no stamp at all", () => {
    // The migration, through the real path: every sheet written before the
    // field existed is in this state and is stale against whatever the site has
    // done since.
    expect(render(stored(undefined), library("hero"))).not.toContain(
      "rebeccapurple"
    );
  });
});

describe("a page rendered from stored site styles, with no compile context", () => {
  // The documented normal flow, and the one the direct-resolver tests cannot
  // reach: `styles` is described as the normal path and `styleContext` as the
  // fallback for a consumer with no write path, so a CMS route supplies a stored
  // artifact and the site's styles and states no context at all. Everything the
  // stamp is taken over still arrives — through `siteStyles` instead.
  const site = (slug: string) => ({
    breakpoints: { viewport: [], container: [] },
    classes: library(slug),
  });

  function renderFromSite(styles: PageStyles, slug: string) {
    return renderToStaticMarkup(
      <PageRenderer
        document={document}
        blocks={createBlockResolver(coreBlocks)}
        styles={styles}
        siteStyles={site(slug)}
      />
    );
  }

  /** What this render derives, with no context of its own to take it from. */
  const stampFromSite = (slug: string) =>
    sharedStyleInputsId(
      withTypographyDefaults({
        breakpoints: { viewport: [], container: [] },
        namedClasses: library(slug),
        blockBases: blockBasesFor(document, createBlockResolver(coreBlocks)),
      })
    );

  it("REUSES a stored sheet whose stamp still describes the site", () => {
    // The control. Every refusal below would also pass against a render that
    // recompiled unconditionally.
    expect(renderFromSite(stored(stampFromSite("hero")), "hero")).toContain(
      "rebeccapurple"
    );
  });

  it("REFUSES a stored sheet after a class was renamed under it", () => {
    // The defect, on the path it actually happens on. A render that took its
    // identity from the `styleContext` prop alone has none here, compares
    // nothing, and serves this stale sheet for as long as the page is cached —
    // while passing every test that supplies the context production omits.
    expect(
      renderFromSite(stored(stampFromSite("hero")), "banner")
    ).not.toContain("rebeccapurple");
  });

  it("REFUSES an artifact carrying no stamp at all", () => {
    // The migration, through the same path: every sheet written before the field
    // existed is unstamped and stale against whatever the site has done since.
    expect(renderFromSite(stored(undefined), "hero")).not.toContain(
      "rebeccapurple"
    );
  });

  it("still RECOMPILES rather than withholding, so the page keeps its styling", () => {
    // Refusing is only affordable because these inputs can compile a replacement.
    // The refusal path withholds the sheet where it cannot, and the page renders
    // unstyled — a worse answer than the staleness it guards — so a refusal here
    // has to be followed by a sheet rather than by nothing.
    //
    // Asserted on a NODE rule, which only a page compile can produce. The site
    // sheet emits the class tier from the same inputs and would satisfy a
    // selector-shaped assertion whether or not this page recompiled at all.
    const styled: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: { text: "body" },
          styles: { base: { base: { color: "seagreen" } } },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <PageRenderer
        document={styled}
        blocks={createBlockResolver(coreBlocks)}
        styles={stored(stampFromSite("hero"))}
        siteStyles={site("banner")}
      />
    );

    expect(html).not.toContain("rebeccapurple");
    expect(html).toContain("seagreen");
  });
});

/** A type whose defaults exist, so dropping its last node is visible at all. */
const ghost = defineBlock({
  name: "test/ghost",
  version: 1,
  description: "Draws nothing, and declares defaults for its type.",
  example: { props: {} },
  baseStyles: { base: { base: { color: "#020202" } } },
  rendersNothing: () => true,
  render: () => null,
});

const shown = defineBlock({
  name: "test/shown",
  version: 1,
  description: "Draws.",
  example: { props: {} },
  render: ({ className }) => <p className={className}>shown</p>,
});

describe("a stored artifact that covers a node its type no longer draws", () => {
  const withGhost: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "n1", type: "test/shown", version: 1, props: {} },
      // The ONLY node of its type, so dropping it takes the type's defaults with
      // it. A second one would keep them in the derived record either way and
      // the assertion below would hold against both implementations.
      { id: "n2", type: "test/ghost", version: 1, props: {} },
    ],
  };
  const blocks = createBlockResolver([shown, ghost]);

  it("is REUSED, because dropping it does not move the identity", () => {
    // `PageRenderer` prunes a drawless node from the style input when the
    // artifact's `gated` map accounts for it, and that pruning is licensed
    // precisely so the artifact can still be used. An identity derived from the
    // pruned tree loses `test/ghost` entirely, disagrees with the stamp the
    // write path recorded against the whole document, and refuses the artifact
    // the pruning existed to keep — recompiling on every uncached request.
    const artifact: PageStyles = {
      css: ".nx-n1{color:rebeccapurple}",
      classes: { n1: "nx-n1", n2: "nx-n2" },
      // Empty on purpose: a recorded entry is what accounts for the node, and an
      // empty one appends nothing, so the assertion reads reuse and not delivery.
      gated: { n2: "" },
      sharedInputsId: sharedStyleInputsId(
        withTypographyDefaults({
          breakpoints: { viewport: [], container: [] },
          namedClasses: [],
          // From the WHOLE document — the tree the artifact was compiled from, and
          // the assertion itself. Taking it from what this render styles would
          // agree with a pruned derivation and prove nothing.
          blockBases: blockBasesFor(withGhost, blocks),
        })
      ),
    };

    expect(
      renderToStaticMarkup(
        <PageRenderer
          document={withGhost}
          blocks={blocks}
          styles={artifact}
          // Stated as a CONTEXT rather than through `siteStyles`, so this asks
          // only which tree the defaults are derived from. Routed through the
          // site input it would also depend on a context being derived from
          // reconciled inputs at all, and would go quiet — passing for the wrong
          // reason — the moment that stopped happening.
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      )
    ).toContain("rebeccapurple");
  });
});

describe("a site library carrying block defaults this page never draws", () => {
  // `compilePageCss` reads a base only for a type the document uses, so defaults
  // for every other installed block emit nothing into this sheet. An identity
  // taken over the whole record moves when one of them changes and recompiles a
  // byte-identical page — on a read path that does not persist what it gets
  // back, on every request.
  const onePage: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: "test/shown", version: 1, props: {} }],
  };
  const blocks = createBlockResolver([shown, ghost]);

  const site = (unusedColour: string) => ({
    breakpoints: { viewport: [], container: [] },
    blockBases: {
      "test/shown": { base: { base: { color: "#030303" } } },
      // Installed, and absent from this document. Nothing it holds can reach
      // this page's sheet.
      "test/ghost": { base: { base: { color: unusedColour } } },
    },
  });

  const artifact: PageStyles = {
    css: ".nx-n1{color:rebeccapurple}",
    classes: { n1: "nx-n1" },
    sharedInputsId: sharedStyleInputsId(
      withTypographyDefaults({
        breakpoints: { viewport: [], container: [] },
        namedClasses: [],
        // The types this document draws from, which is the answer the compiler
        // itself uses. Taken through the same helper rather than written out, so
        // what this asserts is WHICH record the render stamps, not how the
        // narrowing is spelled.
        blockBases: blockBasesFor(onePage, blocks, site("#040404").blockBases),
      })
    ),
  };

  const render = (unusedColour: string) =>
    renderToStaticMarkup(
      <PageRenderer
        document={onePage}
        blocks={blocks}
        styles={artifact}
        siteStyles={site(unusedColour)}
      />
    );

  it("REUSES the artifact, because an unused type is not in the identity", () => {
    expect(render("#040404")).toContain("rebeccapurple");
  });

  it("still REUSES it after that unused default changes", () => {
    // The half a narrowing that merely happened to agree would fail. Changing a
    // default for a type this page does not hold changes no byte of its sheet.
    expect(render("#eeeeee")).toContain("rebeccapurple");
  });
});
