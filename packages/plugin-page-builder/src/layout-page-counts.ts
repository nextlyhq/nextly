/**
 * How many pages use each header & footer set: the rule, given the reads.
 *
 * A set's pages are the pages that name it, and for the site's default also
 * the pages that follow the default (naming none) and the pages falling back
 * to it from a set that is not published. A page switched to "None" counts
 * for no set.
 *
 * This counts who USES a set, not which set a page is drawn inside right
 * now, so it is not `resolvePageLayout`: a page naming an unpublished set is
 * that set's page (published, the set wraps it) and, meanwhile, the
 * default's; the pages following the default are its pages even while it is
 * unpublished.
 *
 * ## Why a count may be a floor
 *
 * The reads behind it are bounded. A page read that stopped makes every
 * count a floor. A published-sets read that stopped cannot place a page
 * naming a set it did not return: that set may be published past the bound,
 * so the page is left out of the default's count, which becomes a floor. A
 * count is never more than the truth.
 *
 * @module layout-page-counts
 */
import type { PageLayoutRow } from "./component-page-reach";
import type {
  LayoutPageCount,
  LayoutPageCountsResponse,
} from "./layout-counts-contract";

/** The stored pages' set choices, and whether that is every page. */
export interface SetPagesRead {
  readonly pages: readonly PageLayoutRow[];
  readonly complete: boolean;
}

/** What the rule asks about the site's sets. */
export interface SetCountSite {
  /** The set the site's default names, or `null` where none is set. */
  readonly defaultLayout: string | null;
  /** The published sets read, and whether that is every one. */
  readonly published: {
    readonly ids: ReadonlySet<string>;
    readonly complete: boolean;
  };
}

/** The pages counted so far for each set, and whether the default's lost one. */
interface Tally {
  readonly counts: Map<string, number>;
  defaultUnplaced: boolean;
}

/** How many pages use each of `sets`, by the rule above. */
export function countSetPages(
  sets: readonly string[],
  read: SetPagesRead,
  site: SetCountSite
): LayoutPageCountsResponse {
  const tally: Tally = { counts: new Map(), defaultUnplaced: false };
  for (const page of read.pages) countPage(page, site, tally);
  const answer: Record<string, LayoutPageCount> = {};
  for (const set of sets) {
    answer[set] = {
      pages: tally.counts.get(set) ?? 0,
      floor:
        !read.complete || (set === site.defaultLayout && tally.defaultUnplaced),
    };
  }
  return answer;
}

/** One page, added to the set it names and, where it falls back, the default. */
function countPage(
  page: PageLayoutRow,
  site: SetCountSite,
  tally: Tally
): void {
  if (page.noHeaderFooter === true) return;
  const named = page.layout;
  const fallback = site.defaultLayout;
  if (named !== null) add(tally, named);
  if (fallback === null || named === fallback) return;
  if (named === null) {
    add(tally, fallback);
    return;
  }
  if (site.published.ids.has(named)) return;
  // Named, and not among the published sets read: unpublished or gone when
  // that read was whole; unknown when it stopped at its bound.
  if (site.published.complete) add(tally, fallback);
  else tally.defaultUnplaced = true;
}

function add(tally: Tally, set: string): void {
  tally.counts.set(set, (tally.counts.get(set) ?? 0) + 1);
}
