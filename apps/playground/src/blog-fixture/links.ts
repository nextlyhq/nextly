/**
 * Where the blog fixture's links point: an author at `/authors/<slug>`, a
 * category at `/categories/<slug>` and a tag at `/tags/<slug>`, the pages a
 * scaffolded blog writes by hand (`templates/blog/src/app/(frontend)`).
 *
 * The post page is the one rebuilt with the page builder; the author,
 * category and tag pages stay the site's own routes. So a link to one of them
 * cannot come from the page builder's address store, which holds an address
 * only for an entry drawn with a template: the site names the route, as a
 * site that rebuilds one page and keeps the rest does.
 *
 * Wraps the page builder's own `entryPath` rather than replacing it, so a
 * link to a page, a post or an article still names the address the store
 * holds. Only the fixture's three collections answer here, and only from a
 * public read: the content route has already refused a target the public may
 * not read before it asks (`createContentPage`), and the slug is read the
 * same way again, so no address is drawn from a field a visitor cannot see.
 *
 * @module blog-fixture/links
 */
import type { NextlyContentReader } from "nextly/runtime";

import { JOURNAL } from "./collections";

/** The page builder's answer to where an entry is served. */
type EntryPath = (
  collection: string,
  id: string,
  locale: string | undefined
) => Promise<string | null>;

/** The hand-written route each of the fixture's linked collections has. */
const HAND_WRITTEN_ROUTES: Readonly<Record<string, string>> = {
  [JOURNAL.authors]: "/authors",
  [JOURNAL.categories]: "/categories",
  [JOURNAL.tags]: "/tags",
};

/**
 * `entryPath`, answering the fixture's authors, categories and tags with
 * their hand-written routes, read through `reader` as an anonymous visitor.
 */
export function withJournalLinks(
  entryPath: EntryPath | undefined,
  reader: NextlyContentReader
): EntryPath {
  return async (collection, id, locale) => {
    const route = Object.hasOwn(HAND_WRITTEN_ROUTES, collection)
      ? HAND_WRITTEN_ROUTES[collection]
      : undefined;
    if (route === undefined) {
      return (await entryPath?.(collection, id, locale)) ?? null;
    }
    const { items } = await reader.find({
      collection,
      where: { id: { equals: id } },
      limit: 1,
      depth: 0,
      overrideAccess: false,
      // Both identity channels, passed as undefined, so the read is the
      // visitor's and never the identity the reader was booted with.
      user: undefined,
      req: undefined,
      ...(locale === undefined ? {} : { locale }),
    });
    const slug = items[0]?.slug;
    // A slug holding a `/` would name another route: no link rather than
    // a wrong one.
    if (typeof slug !== "string" || slug === "" || slug.includes("/")) {
      return null;
    }
    return `${route}/${encodeURIComponent(slug)}`;
  };
}
