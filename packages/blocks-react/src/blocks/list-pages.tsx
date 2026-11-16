/**
 * The links between a paginated list's pages: previous, the page numbers and
 * next, each an address rather than client state, so every page can be
 * generated ahead of time, shared and indexed.
 *
 * Drawn by `core/collection-loop` under its entries, as named parts of that
 * block, so a site styles them as it styles the list and nothing else on the
 * page can be mistaken for them.
 *
 * @module blocks/library/list-pages
 */
import type { ReactElement } from "react";

/** The page numbers shown around the current one, on each side. */
const AROUND_CURRENT = 1;

/** Up to this many pages, every number is shown and nothing is elided. */
const SHOW_ALL_UP_TO = 7;

/** One stop in the row of numbers: a page, or a gap standing for several. */
type Stop = { readonly page: number } | { readonly gap: "before" | "after" };

/**
 * The numbers a row shows: every page when there are few, otherwise the
 * first, the last and those around the current page, with a gap for each
 * run left out. A gap is drawn only where it stands for two pages or more:
 * one left-out page is shown instead, since a "…" for one number hides
 * nothing and costs as much room.
 */
export function pageStops(page: number, pages: number): Stop[] {
  if (pages <= SHOW_ALL_UP_TO) {
    return Array.from({ length: pages }, (_, index) => ({ page: index + 1 }));
  }
  const from = Math.max(2, page - AROUND_CURRENT);
  const to = Math.min(pages - 1, page + AROUND_CURRENT);
  const stops: Stop[] = [{ page: 1 }];
  if (from === 3) stops.push({ page: 2 });
  else if (from > 3) stops.push({ gap: "before" });
  for (let at = from; at <= to; at += 1) stops.push({ page: at });
  if (to === pages - 2) stops.push({ page: pages - 1 });
  else if (to < pages - 2) stops.push({ gap: "after" });
  stops.push({ page: pages });
  return stops;
}

/** The part each element wears, named by the list block. */
export interface ListPagesParts {
  readonly nav: string;
  readonly link: string;
  readonly current: string;
  readonly gap: string;
}

/**
 * The row of links for page `page` of `pages`. Nothing when there is one
 * page: a row offering only the page being read is noise.
 *
 * Previous is left out on the first page and next on the last, rather than
 * drawn disabled: a link that goes nowhere is one more stop for a keyboard
 * and a screen reader, and the numbers already say where the reader is.
 */
export function ListPages({
  page,
  pages,
  href,
  parts,
}: {
  readonly page: number;
  readonly pages: number;
  readonly href: (page: number) => string;
  readonly parts: ListPagesParts;
}): ReactElement | null {
  if (pages <= 1) return null;
  return (
    <nav className={parts.nav} aria-label="Pages">
      {page > 1 ? (
        <a className={parts.link} href={href(page - 1)} rel="prev">
          <span aria-hidden="true">‹ </span>Previous
        </a>
      ) : null}
      {pageStops(page, pages).map(stop =>
        "gap" in stop ? (
          <span
            key={`gap-${stop.gap}`}
            className={parts.gap}
            aria-hidden="true"
          >
            …
          </span>
        ) : stop.page === page ? (
          <a
            key={stop.page}
            className={`${parts.link} ${parts.current}`}
            href={href(stop.page)}
            aria-current="page"
            aria-label={`Page ${String(stop.page)}`}
          >
            {stop.page}
          </a>
        ) : (
          <a
            key={stop.page}
            className={parts.link}
            href={href(stop.page)}
            aria-label={`Page ${String(stop.page)}`}
          >
            {stop.page}
          </a>
        )
      )}
      {page < pages ? (
        <a className={parts.link} href={href(page + 1)} rel="next">
          Next<span aria-hidden="true"> ›</span>
        </a>
      ) : null}
    </nav>
  );
}
