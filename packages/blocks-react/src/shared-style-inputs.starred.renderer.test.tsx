/**
 * Moving a block type's ★ style re-renders a page saved before the move,
 * without the page being saved again.
 *
 * A page's stored sheet carries the class tier, the ★ rule among it, and is
 * reused for as long as its stamp still describes the site's shared inputs.
 * So the stamp has to move with the ★ mark: a stored sheet compiled while
 * another style carried ★ would otherwise be served after the site sheet and
 * draw every plain block with the old default. Rendered through
 * `PageRenderer`, the published path, as the staleness tests beside this are.
 *
 * @module shared-style-inputs.starred.renderer.test
 */
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import {
  nodeClassName,
  type BlockDocument,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks";
import { withTypographyDefaults } from "./blocks/typography-defaults";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import { blockBasesFor, blockPartsFor, type PageStyles } from "./styles";

/** Two buttons: one that picked no style, one wearing Secondary. */
const document: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "plain", type: "core/button", version: 1, props: { text: "A" } },
    {
      id: "worn",
      type: "core/button",
      version: 1,
      props: { text: "B" },
      classes: ["look:core/button:secondary"],
    },
  ],
};

const look = (name: string, color: string): NamedClass => ({
  id: `look:core/button:${name}`,
  slug: `button-${name}`,
  orderIndex: 0,
  blockType: "core/button",
  styles: { base: { base: { color } } },
});

/** The site's block styles, with ★ on the one named, or on none. */
const library = (starred?: string): readonly NamedClass[] =>
  [
    look("secondary", "#222222"),
    look("outline", "#333333"),
    look("ghost", "#444444"),
  ].map(entry =>
    entry.slug === `button-${starred}` ? { ...entry, starred: true } : entry
  );

const site = (starred?: string) => ({
  breakpoints: { viewport: [], container: [] },
  classes: library(starred),
});

/** What the published render stamps a sheet with, for this site. */
const stampFor = (starred?: string) =>
  sharedStyleInputsId(
    withTypographyDefaults({
      breakpoints: { viewport: [], container: [] },
      namedClasses: library(starred),
      blockBases: blockBasesFor(document, createBlockResolver(coreBlocks)),
      blockParts: blockPartsFor(document, createBlockResolver(coreBlocks)),
    })
  );

/** A sheet saved with the page, whose text is recognisable if it is served. */
const saved = (stamp: string | undefined): PageStyles => ({
  css: ".nx-saved-sheet{color:rebeccapurple}",
  classes: { plain: "nx-plain", worn: "nx-worn nx-l-button-secondary" },
  ...(stamp === undefined ? {} : { sharedInputsId: stamp }),
});

/**
 * Rendered as a build renders it, finished: a published page draws its
 * asynchronous blocks (a Button, which resolves its link) in place, which a
 * synchronous renderer cannot wait for.
 */
async function renderPublished(
  styles: PageStyles,
  starred?: string
): Promise<string> {
  const { prelude } = await prerender(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      styles={styles}
      siteStyles={site(starred)}
    />
  );
  return await new Response(prelude).text();
}

describe("a page saved before its block type's ★ moved", () => {
  it("REUSES its saved sheet while ★ stays where it was", async () => {
    // The control: without it, the refusals below would also pass against a
    // render that recompiled every time.
    expect(
      await renderPublished(saved(stampFor("outline")), "outline")
    ).toContain("rebeccapurple");
  });

  it("is drawn with the new ★ once it moves, with no new save", async () => {
    const html = await renderPublished(saved(stampFor("outline")), "ghost");
    expect(html).not.toContain("rebeccapurple");
    // Ghost's rule on the button that picked no style, by its own class.
    expect(html).toContain(
      `:is(.${nodeClassName("plain")}) { color: #444444 }`
    );
  });

  it("is drawn with the new ★ when one is first chosen", async () => {
    expect(await renderPublished(saved(stampFor()), "ghost")).not.toContain(
      "rebeccapurple"
    );
  });
});
