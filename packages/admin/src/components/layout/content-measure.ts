/**
 * The measure a content page is bounded to, named once.
 *
 * A page renders in several states — a loading skeleton, a handful of error
 * cards, and the loaded document — and each is a separate early return with its
 * own container. They must agree: a skeleton at one measure followed by a
 * document at another moves every field sideways at the moment the data
 * arrives, which reads as the page loading twice.
 *
 * Agreement is not something a reviewer can see, because the states are in
 * different branches of different files and each one looks correct beside its
 * own neighbours. So the value is declared here and imported, and divergence
 * stops being possible rather than being something a test has to notice.
 *
 * `wide` rather than the form measure because of what a content page holds. A
 * settings form is a short column of labelled controls; an entry is a document
 * whose fields include rich text, media and repeated groups, and which shares
 * its column with the document rail — so the rail's width is taken out of the
 * author's. Settings pages are deliberately NOT expressed here: they are a
 * different kind of page and their measure is their own to declare.
 *
 * @module components/layout/content-measure
 */

import type { PageContainerProps } from "@admin/types/layout/page-container";

/**
 * Typed as the container's own prop, so a value this vocabulary does not offer
 * is a compile error here rather than a silently ignored attribute at fifteen
 * call sites.
 */
export const CONTENT_PAGE_MEASURE: NonNullable<PageContainerProps["width"]> =
  "wide";
