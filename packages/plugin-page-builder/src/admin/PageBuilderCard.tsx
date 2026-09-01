"use client";

/**
 * The entry screen's way into the page builder.
 *
 * On the shipped `pages` collection this is the whole editable body of the
 * screen: the collection declares `title`, `slug` and the blocks field, and the
 * first two are system fields the header draws. So this is not one field among
 * several — it is what an author sees when they open a page, and it has to read
 * as the door it is.
 *
 * ## It must not look like a field
 *
 * Gutenberg's own design discussion of switching between editors (issue #1375)
 * reaches two requirements: an author must recognise which editing modes exist
 * and which one they are in, and the handoff must not look "too similar to a
 * block", which "would ultimately confuse the user about what view they are
 * in". The surface this replaces was a muted bordered box with the type slugs
 * listed inside it and a small outline button underneath — the named
 * anti-pattern, and the reason a page's editor read as an inert summary.
 *
 * ## The page, rather than a list of its parts
 *
 * The reading is the page itself. A list of block TYPES is a debug view: it
 * tells an author what machinery is on the page and nothing about what the page
 * says, and twenty pages listing `core/section, core/text` are indistinguishable
 * from each other. Sanity's page-building guidance reaches the same conclusion
 * from the other direction — a row shows title, subtitle and media, and the
 * type name belongs in the subtitle, never as the label.
 *
 * ## One action, and only when there is one
 *
 * A single primary control, which is what the empty-state guidance in Carbon
 * and NN/g both reduce to. Where the field cannot be edited there is no
 * disabled twin: {@link BlocksField} established that a disabled control says
 * "you could do this, but not now", which is the wrong sentence for a document
 * nobody may edit. The page is still drawn, because reading a page you may not
 * change is legitimate.
 *
 * @module @nextlyhq/plugin-page-builder/admin/PageBuilderCard
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { Button, Skeleton } from "@nextlyhq/ui";
import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";

import { countByType, documentNodes, totalBlocks } from "./page-summary";
import { PageMiniature } from "./PageMiniature";

/**
 * What the action says when the page has nothing on it yet.
 *
 * Exported because a test naming this control has to ask for the SAME string
 * the card renders. A copy in the test agrees on the day it is written and
 * then keeps passing — or keeps failing — after the wording moves.
 */
export const BUILD_PAGE_LABEL = "Build this page";

/** What the action says when the page already holds blocks. */
export const OPEN_BUILDER_LABEL = "Open Page Builder";

/**
 * Matches the card's action in EITHER state.
 *
 * A caller that wants to OPEN the builder cares that there is exactly one way
 * in, not which sentence the card chose for this particular document. Deriving
 * the pattern from both labels keeps such a caller correct when a fixture's
 * document gains or loses blocks — which is otherwise a failure that names the
 * wording rather than the change that caused it.
 */
export const OPEN_BUILDER_ACTION = new RegExp(
  `^(?:${BUILD_PAGE_LABEL}|${OPEN_BUILDER_LABEL})$`
);

export interface PageBuilderCardProps {
  /** The document the field currently holds. */
  document: BlockDocument;
  /**
   * The site's compiled sheet.
   *
   * Spelled as the renderer's own prop type so this cannot drift from what
   * `PageRenderer` accepts.
   */
  siteStyles: PageRendererProps["siteStyles"];
  /**
   * Whether the site's own style is still being read.
   *
   * A separate answer from `siteStyles` being absent, and the distinction is
   * the point: absent means "this site emits no sheet", which is a legitimate
   * state to render in, while pending means the sheet that WILL apply is not
   * here yet. Rendering during the second draws a page missing the site's named
   * classes and block defaults — plausible, and wrong.
   */
  stylePending: boolean;
  /** Whether this author may open the editor at all. */
  canEdit: boolean;
  /** Opens the builder over the form. */
  onOpen: () => void;
}

/**
 * @param props - the document, the site's sheet and its readiness, and the way in
 * @returns the card the entry form draws in place of the blocks field
 */
export function PageBuilderCard({
  document,
  siteStyles,
  stylePending,
  canEdit,
  onOpen,
}: PageBuilderCardProps) {
  const total = useMemo(
    () => totalBlocks(countByType(documentNodes(document))),
    [document]
  );

  const empty = total === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {empty ? null : stylePending ? (
        // Sized like the miniature it stands in for, so the card does not
        // resize under the author the moment the sheet arrives.
        <Skeleton className="aspect-[16/10] w-full rounded-md" />
      ) : (
        <PageMiniature document={document} siteStyles={siteStyles} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <LayoutGrid
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="font-medium text-foreground">Page Builder</span>
          {empty ? (
            <span className="text-muted-foreground">
              Nothing here yet — lay this page out visually.
            </span>
          ) : (
            <span className="text-muted-foreground">
              {total} {total === 1 ? "block" : "blocks"}
            </span>
          )}
        </div>

        {canEdit ? (
          <Button type="button" onClick={onOpen}>
            {empty ? BUILD_PAGE_LABEL : OPEN_BUILDER_LABEL}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
