/**
 * The paths a route serves and links to: a slug as the path it renders at,
 * the slug of a later page of an entry's list, the language a render's links
 * are formed in, and the resolvers that turn a referenced entry into the
 * address it is served at.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-entry-paths
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
import { servedAddress, LIST_PAGE_SEGMENT, slugToPath } from "nextly/runtime";
import type { NextlyContentReader, RequestLanguage } from "nextly/runtime";

import { AHEAD_BATCH_SIZE, rowsById } from "./blocks/list-batch";
import type { QueryBudget, ReadClaim } from "./context";
import type { BlocksPageConfig } from "./next-page-config";

/**
 * Percent-encode a slug path, keeping its `/` separators.
 *
 * Next hands this route the DECODED segments while the request used their
 * encoded form, and a slug is ordinary stored text — so `faq?all` interpolated
 * raw produces a path a URL consumer reads as a query. Shared by the canonical
 * and by reference links, because a page describing itself one way and linking
 * to itself another is the disagreement this exists to prevent.
 */
export function emitPath(slug: string): string | null {
  // The route's OWN answer, not a second opinion: the path its static params
  // pre-render, which the route's redirects name too. It collapses repeated
  // and edge slashes — Next answers `/a//b` with a 308 to `/a/b`, and the
  // lookup then asks for a slug the entry does not have — refuses reserved
  // paths, and refuses the segments URL resolution removes.
  //
  // An empty slug is the HOMEPAGE, which the route resolves at `/` and
  // pre-renders as `{ slug: [] }`. Treating it as missing would strip the
  // destination from every button pointing at the site root.
  return slugToPath(slug);
}

/**
 * The slug of page `page` of the list on the entry at `slug`: the entry's
 * own for page 1, `<slug>/page/<n>` for a later one, as the route serves it.
 */
export function listPageSlug(slug: string, page: number | undefined): string {
  if (page === undefined || page <= 1) return slug;
  return [slug, LIST_PAGE_SEGMENT, String(page)]
    .filter(part => part !== "")
    .join("/");
}

/** Successive slices of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * How one render settles its links to entries: one link at a time, as each
 * linking block asks, and in batches, as a list asks for its entries' links
 * before drawing them. One answer per entry per render, which a batch fills.
 */
export interface EntryPathReads {
  readonly resolve: (
    collection: string,
    id: string,
    claim?: ReadClaim
  ) => Promise<string | null>;
  readonly ahead: (
    refs: readonly { readonly collection: string; readonly id: string }[],
    claim: ReadClaim
  ) => Promise<boolean>;
}

/** A filter as the route's trusted reader takes it. */
type RouteWhere = NonNullable<
  Parameters<NextlyContentReader["find"]>[0]["where"]
>;

/** A link whose path waits on the ownership checks. */
interface LinkCandidate {
  readonly id: string;
  readonly slug: string;
  readonly path: string;
}

/** The key one entry's path is kept under for a render. */
function entryKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

/**
 * The language a render's links are formed in: the one the request is read
 * in, said to come from a `[locale]` segment where it is not the language
 * the route was configured with. A segment's request is served at the
 * address the site's language rule forms, so its links are too; a route the
 * site mounts for one language serves its paths as they are.
 *
 * Only the render's language is known here, not whether a segment named it,
 * so a segment naming the configured language is read as the configured one:
 * its links are left as the route's own paths.
 */
export function linkLanguageOf(
  configured: string | undefined,
  read: string | undefined
): RequestLanguage {
  if (read === undefined) return { fromSegment: false };
  return { locale: read, fromSegment: read !== configured };
}

/**
 * Resolve a referenced entry to the address it is served at in the
 * request's language: read in that language, and formed by the rule the
 * route serves its own addresses by (`servedAddress`), so a German page
 * links to the German page at its German address.
 *
 * A site's own `resolveEntryPath` is handed the language and answers the
 * whole address itself.
 */
export function entryPathResolver(
  config: BlocksPageConfig,
  isPublic: boolean,
  reader: NextlyContentReader,
  budget: QueryBudget,
  language: RequestLanguage
): EntryPathReads {
  if (config.resolveEntryPath) {
    const custom = config.resolveEntryPath;
    // Charged against the budget like the built-in path. A custom resolver is
    // usually database-backed, and it is called once per reference — so a
    // template inside a nested loop invokes it thousands of times. Exempting it
    // would bound the resolver we wrote and leave unbounded the one a site
    // supplies, which is the wrong way round. It takes one reference, so it
    // has no batch.
    return {
      resolve: async (collection, id, claim) => {
        if (!budget.take({ ...claim, kind: "link" })) return null;
        return custom(collection, id, language.locale);
      },
      // Nothing is read ahead, so the reads ahead stop here: each of these
      // links reads as it is drawn, before a later block's read.
      ahead: () => Promise.resolve(false),
    };
  }
  const paths = slugPathResolver(
    // Read in the request's language, so a localized slug is the one this
    // language's page is found by.
    language.locale === undefined
      ? config
      : { ...config, locale: language.locale },
    isPublic,
    reader,
    budget
  );
  // One answer per path for the render: every link to one entry names it.
  const formed = new Map<string, Promise<string>>();
  const served = (path: string): Promise<string> => {
    let address = formed.get(path);
    if (address === undefined) {
      address = servedAddress(path, language);
      formed.set(path, address);
    }
    return address;
  };
  return {
    resolve: async (collection, id, claim) => {
      const path = await paths.resolve(collection, id, claim);
      return path === null ? null : await served(path);
    },
    ahead: paths.ahead,
  };
}

/**
 * Resolve a referenced entry to the path it renders at, read in the
 * config's language.
 *
 * Uses the route's own `slugField`, so a link points where this route would
 * resolve it. The alternative is a second opinion about where content lives,
 * and a link that 404s while the page it names renders fine.
 */
function slugPathResolver(
  config: BlocksPageConfig,
  isPublic: boolean,
  reader: NextlyContentReader,
  budget: QueryBudget
): EntryPathReads {
  const slugField = config.slugField ?? "slug";
  const routeCollections = [...new Set(config.collections)];
  // A route mounted behind the app's own auth (`draft: true`) serves drafts
  // through a trusted, lifecycle-widened read, so a reference to an
  // unpublished page DOES resolve when visited and must keep its href. A
  // per-path `draft` function cannot be consulted here — it answers about a
  // slug this lookup has not found yet — so only the unconditional form
  // widens, and the conditional form stays on the safe published read.
  const alwaysDraft = config.draft === true;
  // The route's own posture, handed in: a public route reads trusted, so a
  // reference lookup on that route must too, or a page resolves an href its
  // own renderer would refuse.
  const overrideAccess = alwaysDraft || isPublic;
  // An EXPLICIT status wins over draft widening, because that is the order
  // `createContentRoute` resolves in: it passes the configured status through
  // to `resolveContent`, where it beats the draft widening. Forcing `all`
  // whenever `draft: true` was set would offer an href for an entry the same
  // route refuses — a never-published target on `{ draft: true, status:
  // "published" }` being the case that shows it.
  const scope = config.status ?? (alwaysDraft ? "all" : "published");

  // Every read on this path, by id or in a batch, under the ROUTE's own
  // policy, not with access overridden. A link is only useful if the path it
  // names resolves, and this route resolves published entries anonymously by
  // default — so a reference to an unpublished or restricted entry would
  // otherwise emit an href that the same route answers with `notFound()`.
  // `find` rather than `findByID`, because the lifecycle scope has to be
  // applied BY THE READER: judging a returned `status` property would treat
  // an ordinary string field named `status` as the lifecycle column.
  const routeFind = async (
    collection: string,
    // Taken from the reader's own signature rather than restated, so a filter
    // this package builds cannot drift from the one the reader accepts.
    where: NonNullable<Parameters<NextlyContentReader["find"]>[0]["where"]>,
    limit: number
  ) =>
    await reader.find({
      collection,
      where,
      limit,
      status: scope,
      overrideAccess,
      // Passed explicitly, even as `undefined`. `mergeConfig` spreads the
      // reader's defaults under the call's arguments, so OMITTING this
      // inherits whatever identity the reader was booted with — and this
      // route resolves anonymously. `resolveContent` passes it likewise.
      user: undefined,
      // Both identity channels, not just the obvious one. Access rules
      // are written against `req.user`, and `mergeConfig` spreads the
      // instance's defaults UNDER the call — so an omitted `req`
      // restores whatever identity the instance was booted with, on a
      // read this route performs for an anonymous visitor.
      req: undefined,
      // A localized slug is read per locale, so omitting this returns the
      // DEFAULT-locale slug while the route resolves paths in the configured
      // one — a link to a path this very route cannot find.
      ...(config.locale ? { locale: config.locale } : {}),
    });

  /**
   * The path a slug renders at, or `null` for none: a slug is stored TEXT, so
   * it can start with `/` — and `//evil.example` interpolates to
   * `///evil.example`, which every browser reads as a protocol-relative URL to
   * another host. Refused rather than stripped: a slug shaped like an address
   * is not a path this route serves under any reading. Then the route's own
   * rule decides, which also refuses the reserved paths `ContentPage` will not
   * serve, the `.`/`..` segments URL resolution removes, and the slugs whose
   * normalized form the lookup would not match.
   */
  const pathOf = (slug: unknown): string | null => {
    if (typeof slug !== "string" || slug.startsWith("/")) return null;
    return emitPath(slug);
  };

  const one = async (
    collection: string,
    id: string,
    take: () => boolean
  ): Promise<string | null> => {
    // Never throws: a stale reference resolves to no rows rather than a
    // rejection, which is what `resolveEntryPath` promises its callers.
    if (!take()) return null;
    const found = await routeFind(collection, { id: { equals: id } }, 1).catch(
      () => ({ items: [] as Record<string, unknown>[] })
    );
    const record = found.items[0];
    if (!record) return null;
    const slug = record[slugField];
    const path = pathOf(slug);
    // Asked BEFORE the ownership probes below, so an unaddressable slug
    // costs no queries.
    if (path === null || typeof slug !== "string") return null;

    // Which entry a URL opens is settled entirely on STORED columns from here
    // down. Every read on this path returns rows through `afterRead`, so any
    // answer derived from a returned `id` is an answer about the hook's output
    // rather than about the database: a hook that rewrites ids breaks the
    // comparison, one that drops them makes two rows identical, and one that
    // maps several rows onto a single public value makes two DIFFERENT rows
    // compare equal. The argument `id` is the stored value the block recorded,
    // so asking the database about it directly is immune to all three.
    //
    // A shared probe: same lifecycle scope and access semantics the route
    // resolves with, so a draft-only row cannot suppress a valid link on a
    // published route. An access denial reads as "no such entry", which is how
    // `resolveContent` treats one — a probe that threw would take down a link
    // whose own read succeeded.
    const probe = async (
      collectionName: string,
      where: NonNullable<Parameters<NextlyContentReader["find"]>[0]["where"]>
    ): Promise<boolean> => {
      // Each probe is its own read. An exhausted budget answers "something else
      // owns this slug", which withholds the link — the same direction every
      // other uncertainty here takes, since no link beats a wrong one.
      if (!take()) return true;
      const probed = await routeFind(collectionName, where, 1).catch(() => ({
        items: [] as Record<string, unknown>[],
      }));
      return probed.items.length > 0;
    };

    // 1. This row really is stored at this slug. It is the returned slug that
    //    was read above, and an `afterRead` hook may have produced it — while
    //    `resolveContent` matches the stored column. Asking for both together
    //    settles it without trusting either value alone.
    if (
      !(await probe(collection, {
        [slugField]: { equals: slug },
        id: { equals: id },
      }))
    ) {
      return null;
    }

    // 2. No row in this collection shares the slug with a LOWER id. That is
    //    exactly the row `resolveContent` would serve instead, since it settles
    //    duplicates with `sort: "id"` — asked as a range over the stored column
    //    rather than by comparing identities the hooks have already touched.
    if (
      await probe(collection, {
        [slugField]: { equals: slug },
        id: { less_than: id },
      })
    ) {
      return null;
    }

    // 3. No EARLIER collection carries the slug. The route searches its
    //    collections in order and serves the first match, so a slug an earlier
    //    one owns belongs to that one, and this link would navigate to a
    //    different document under the same URL.
    for (const earlier of earlierThan(collection)) {
      if (await probe(earlier, { [slugField]: { equals: slug } })) return null;
    }

    return path;
  };

  const earlierThan = (collection: string): string[] =>
    routeCollections.slice(0, routeCollections.indexOf(collection));

  /**
   * What settling links into a collection costs, a batch or one link alike:
   * the rows, the two ownership checks in the collection, and one for each
   * collection the route searches before it.
   */
  const linkReads = (collection: string): number =>
    3 + earlierThan(collection).length;

  /**
   * How many stored rows match, as the database counts them: the count is
   * made on stored columns, so it answers the probes' questions for many
   * links at once without matching any returned value to a link. `undefined`
   * when the read fails or reports no count, which settles nothing.
   */
  const storedCount = async (
    collection: string,
    where: RouteWhere
  ): Promise<number | undefined> => {
    const found = await routeFind(collection, where, 1).catch(() => undefined);
    const meta: unknown = found?.meta;
    const total = isPlainRecord(meta) ? meta.total : undefined;
    return typeof total === "number" ? total : undefined;
  };

  /**
   * Many links' rows split into those with no path (no row this route can
   * read, or a slug it does not serve) and those whose path the ownership
   * checks must still clear. The database counted exactly these rows, so an
   * id with no row is an entry this route cannot read: no link, as `one`
   * answers.
   */
  const linkRows = (
    rows: ReadonlyMap<string, Record<string, unknown>>,
    ids: readonly string[]
  ): { settled: Map<string, string | null>; candidates: LinkCandidate[] } => {
    const settled = new Map<string, string | null>();
    const candidates: LinkCandidate[] = [];
    for (const id of ids) {
      const slug = rows.get(id)?.[slugField];
      const path = pathOf(slug);
      if (path === null || typeof slug !== "string") settled.set(id, null);
      else candidates.push({ id, slug, path });
    }
    return { settled, candidates };
  };

  /**
   * The three ownership checks of `one`, asked for many links into one
   * collection at once, each as a count the database must answer with
   * `expected`:
   * 1. every (slug, id) pair is stored as read: as many stored rows match
   *    the pairs as there are pairs, each id naming one row;
   * 2. no lower id in this collection shares any of the slugs;
   * 3. no earlier collection of the route carries any of them.
   */
  const ownershipChecks = (
    collection: string,
    candidates: readonly LinkCandidate[]
  ): { collection: string; where: RouteWhere; expected: number }[] => {
    const slugs = [...new Set(candidates.map(({ slug }) => slug))];
    return [
      {
        collection,
        expected: candidates.length,
        where: {
          or: candidates.map(({ id, slug }) => ({
            [slugField]: { equals: slug },
            id: { equals: id },
          })),
        },
      },
      {
        collection,
        expected: 0,
        where: {
          or: candidates.map(({ id, slug }) => ({
            [slugField]: { equals: slug },
            id: { less_than: id },
          })),
        },
      },
      ...earlierThan(collection).map(earlier => ({
        collection: earlier,
        expected: 0,
        where: { [slugField]: { in: slugs } },
      })),
    ];
  };

  /** Whether every check holds, each one read; `spent` once reads run out. */
  const allHold = async (
    checks: readonly {
      collection: string;
      where: RouteWhere;
      expected: number;
    }[],
    take: () => boolean
  ): Promise<boolean | "spent"> => {
    for (const check of checks) {
      if (!take()) return "spent";
      const count = await storedCount(check.collection, check.where);
      if (count !== check.expected) return false;
    }
    return true;
  };

  /**
   * The paths of many links into one collection, settled with a constant
   * number of reads: their rows by `id in`, then each ownership check asked
   * for all of them at once, as a count. Only a batch every count clears is
   * kept; any other leaves each link to `one`, which asks the checks link by
   * link, so a batch never answers differently from it. Says `settled` for
   * a batch kept, `unusable` for one its reads could not settle (rows it
   * cannot match, a failed read, a check that does not hold), and `spent`
   * once reads run out.
   */
  const batch = async (
    collection: string,
    ids: readonly string[],
    take: () => boolean,
    known: Map<string, Promise<string | null>>
  ): Promise<"spent" | "unusable" | "settled"> => {
    if (!take()) return "spent";
    const found = await routeFind(
      collection,
      { id: { in: [...ids] } },
      ids.length
    ).catch(() => undefined);
    const rows = found === undefined ? undefined : rowsById(found, ids);
    if (rows === undefined) return "unusable";
    const { settled, candidates } = linkRows(rows, ids);
    if (candidates.length > 0) {
      const held = await allHold(ownershipChecks(collection, candidates), take);
      if (held !== true) return held === "spent" ? "spent" : "unusable";
      for (const { id, path } of candidates) settled.set(id, path);
    }
    for (const [id, path] of settled) {
      known.set(entryKey(collection, id), Promise.resolve(path));
    }
    return "settled";
  };

  const known = new Map<string, Promise<string | null>>();

  /** The links not yet settled, by the route collection each points into. */
  const unsettledByCollection = (
    refs: readonly { readonly collection: string; readonly id: string }[]
  ): Map<string, Set<string>> => {
    const byCollection = new Map<string, Set<string>>();
    for (const { collection, id } of refs) {
      const served = routeCollections.includes(collection) && id.trim() !== "";
      if (!served || known.has(entryKey(collection, id))) continue;
      byCollection.set(
        collection,
        (byCollection.get(collection) ?? new Set<string>()).add(id)
      );
    }
    return byCollection;
  };

  /**
   * Whether a batch of `count` links into `collection` may be asked: a batch
   * that falls back has spent its reads before each link's own, so it is
   * asked only where the allowance covers both, and a batch never costs a
   * link the address it would have had.
   */
  const affordsBatch = (collection: string, count: number): boolean =>
    (budget.remaining?.() ?? Infinity) >= linkReads(collection) * (count + 1);

  return {
    resolve: (collection, id, claim) => {
      // A collection this route does not serve has no path THIS route can
      // produce: `createContentRoute` searches only its configured
      // collections, so the href would 404 or open an unrelated entry that
      // happens to share the slug. Mapping across routes is what
      // `resolveEntryPath` is for.
      if (!routeCollections.includes(collection)) return Promise.resolve(null);
      const key = entryKey(collection, id);
      const kept = known.get(key);
      if (kept !== undefined) return kept;
      // Kept for the render, and dropped again when a read it needed was
      // refused: a refused probe withholds the link, which is this render's
      // answer for want of reads, not the entry's.
      let refused = false;
      const reading = one(collection, id, () => {
        const granted = budget.take({ ...claim, kind: "link" });
        if (!granted) refused = true;
        return granted;
      });
      known.set(key, reading);
      void reading.then(
        () => {
          if (refused) known.delete(key);
        },
        () => known.delete(key)
      );
      return reading;
    },
    ahead: async (refs, claim) => {
      const take = () => budget.take({ ...claim, kind: "link" });
      for (const [collection, ids] of unsettledByCollection(refs)) {
        for (const chunk of chunked([...ids], AHEAD_BATCH_SIZE)) {
          if (!affordsBatch(collection, chunk.length)) return false;
          // A batch that ran out of reads, or whose reads could not settle
          // its links, stops the reads ahead: each link then reads as it is
          // drawn, with the reads the batch was asked only where they remain.
          if ((await batch(collection, chunk, take, known)) !== "settled") {
            return false;
          }
        }
      }
      return true;
    },
  };
}
