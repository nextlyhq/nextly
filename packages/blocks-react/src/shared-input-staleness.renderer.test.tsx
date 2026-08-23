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
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import type { PageStyles } from "./styles";

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
  sharedStyleInputsId({
    breakpoints: { viewport: [], container: [] },
    namedClasses,
  });

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
