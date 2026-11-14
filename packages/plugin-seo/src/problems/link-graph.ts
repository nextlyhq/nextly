/**
 * The site's internal links, as a graph of pages: how many other pages link
 * to each page and how many it links to, and the listed pages no other page
 * links to. Derived from the links each page's own check resolved to the
 * pages holding their addresses, the same read the broken-link check makes,
 * so the site is never crawled a second time. Pure: the links are gathered
 * elsewhere.
 *
 * Only links in a page's content are seen. A site's menu, footer and other
 * links its code draws are not stored with any page, so a page linked only
 * from those still reads as linked from nowhere here.
 *
 * @module problems/link-graph
 */
import type { Problem, ProblemSubject } from "./contract";

/** What a page's check read of its links. */
export interface PageLinks {
  /**
   * The pages its content links to, by {@link linkedPageKey} with the
   * language each link's address is served in.
   */
  to: readonly string[];
  /** Whether the page is listed in search: one kept out is no orphan. */
  listed: boolean;
  /** Whether the page is its language's home, which every visit starts from. */
  home: boolean;
}

/** A page in one language, with its links where its check read them. */
export interface LinkedPage {
  subject: ProblemSubject & { type: string; id: string };
  locale: string;
  /** None for a page last checked before links were read. */
  links?: PageLinks;
}

/** How many other pages link to a page, and how many it links to. */
export interface LinkCounts {
  inbound: number;
  outbound: number;
}

/**
 * A page's key in one language: what a link names it by, and its counts are
 * kept by. Its parts are joined by the unit separator (U+001F), which no
 * type, id or language holds. Not by NUL: the keys are stored in a JSON
 * column, and PostgreSQL's JSON refuses a NUL in any string.
 */
export function linkedPageKey(
  type: string,
  id: string,
  locale: string
): string {
  return `${type}\u001f${id}\u001f${locale}`;
}

/** The other pages `page` links to, each once. */
function linkedFrom(page: LinkedPage): Set<string> {
  const own = linkedPageKey(page.subject.type, page.subject.id, page.locale);
  return new Set((page.links?.to ?? []).filter(each => each !== own));
}

/**
 * Each read page's counts, by {@link linkedPageKey}: the distinct other
 * pages linking to it in its language, a link counting for the language its
 * address is served in, and the distinct other pages it links to. A link to itself counts for neither, and a page
 * whose links were never read is left out, and counts for nothing.
 */
export function linkCounts(
  pages: readonly LinkedPage[]
): Map<string, LinkCounts> {
  const inbound = new Map<string, number>();
  for (const page of pages) {
    if (page.links === undefined) continue;
    for (const target of linkedFrom(page)) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }
  const counts = new Map<string, LinkCounts>();
  for (const page of pages) {
    if (page.links === undefined) continue;
    const key = linkedPageKey(page.subject.type, page.subject.id, page.locale);
    counts.set(key, {
      inbound: inbound.get(key) ?? 0,
      outbound: linkedFrom(page).size,
    });
  }
  return counts;
}

/**
 * The listed pages of `named` that no other page links to, counted over
 * every page in `pages`: a page the reader may not open still links. Each
 * is named in its language where that is not `defaultLanguage`. Never
 * the home page, a page kept out of search, or a page whose links were not
 * read.
 */
export function orphanProblems(
  pages: readonly LinkedPage[],
  named: readonly LinkedPage[] = pages,
  defaultLanguage?: string
): Problem[] {
  const counts = linkCounts(pages);
  return named.flatMap(page => {
    const { links, subject } = page;
    if (links === undefined || !links.listed || links.home) return [];
    const key = linkedPageKey(subject.type, subject.id, page.locale);
    if ((counts.get(key)?.inbound ?? 0) > 0) return [];
    return [
      {
        kind: "orphanPage" as const,
        // Named in its language where not the default, as every page's
        // problems are, so its fix opens the editor in that language.
        subject:
          defaultLanguage === undefined ||
          page.locale === "" ||
          page.locale === defaultLanguage
            ? subject
            : { ...subject, locale: page.locale },
        what: "No other page links here",
        action: "Open the page",
        fix: { place: "page" as const, tab: "content" as const },
      },
    ];
  });
}
