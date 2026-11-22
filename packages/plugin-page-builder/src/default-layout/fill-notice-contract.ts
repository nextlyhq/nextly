/**
 * What the route that tells a publisher about their fill answers, and the
 * words they are told in, shared by the route and the screens that say it.
 *
 * Its own module, free of server imports, so an admin bundle takes the shape
 * and the words without the route's reads.
 *
 * @module default-layout/fill-notice-contract
 */

/** Where the caller takes the fills waiting to be told to them. */
export const FILL_NOTICES_ROUTE_PATH = "/default-layout/fill-notices";

/** One fill the caller is told about. */
export interface FillNotice {
  readonly area: "header" | "footer";
  /** The component that now fills that area of the default. */
  readonly component: { readonly id: string; readonly title: string };
}

/** What the route answers, inside the mutation envelope's `item`. */
export interface FillNoticesResult {
  /** The fills told now; each is answered once, to its publisher only. */
  readonly fills: readonly FillNotice[];
  /** Where "Change in Header & footer" opens: the admin's list of sets. */
  readonly setsAddress: string;
}

/** The notice's headline. */
export function fillHeadline(notice: FillNotice): string {
  return `${notice.component.title} now shows on every page.`;
}

/** The line under it. */
export function fillDetail(notice: FillNotice): string {
  return `Pages that chose a different ${notice.area} keep theirs.`;
}

/** The notice's link. */
export const CHANGE_IN_HEADER_FOOTER = "Change in Header & footer";
