/**
 * The measure a content page is bounded to, named once.
 *
 * A page renders in several states — a loading skeleton, a handful of error
 * cards, and the loaded document — and each is a separate early return with its
 * own container. They must agree: a skeleton at one measure followed by a
 * document at another moves every field sideways at the moment the data
 * arrives, which reads as the page loading twice.
 *
 * That agreement has no single place it can be observed: the states are early
 * returns in different branches of different files, and each width is correct
 * on its own terms wherever it appears. Declaring the value here and importing
 * it makes divergence unrepresentable instead of something that has to be
 * noticed by comparing the sites.
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

/**
 * The token each named measure resolves to, so a length can be derived from a
 * width rather than restated beside it.
 *
 * `full` has no token because it is the absence of a cap. Typed as a total
 * `Record`, so a measure added to the vocabulary cannot be forgotten here.
 */
const MEASURE_TOKEN: Record<
  NonNullable<PageContainerProps["width"]>,
  string | null
> = {
  form: "--nx-measure-form",
  wide: "--nx-measure-wide",
  full: null,
};

/**
 * The content measure as a CSS length, for content that bounds its own column.
 *
 * A page whose content seats chrome beside it takes the whole panel, so the cap
 * moves inward onto the field column and needs to be expressed as a length
 * rather than as a page width. Derived from `CONTENT_PAGE_MEASURE` above so the
 * two cannot disagree: a page bounded one way and its fields bounded another is
 * the disagreement this module exists to prevent, and writing the token out
 * again by hand is how it would return.
 */
export const CONTENT_MEASURE_LENGTH = `var(${MEASURE_TOKEN[CONTENT_PAGE_MEASURE] ?? "--nx-measure-wide"})`;
