/**
 * How a route reads the images its pages draw: the media resolver one render
 * uses, reading each id once, in batches where the reader can, from the media
 * library or a collection of the route's own, cached and tagged like the page.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-media
 */
import {
  cachedFind,
  entryIdTag,
  isReadRefusal,
  nextlyTags,
  releaseBoundedRevalidate,
} from "nextly/runtime";
import type { NextlyContentReader } from "nextly/runtime";

import { AHEAD_BATCH_SIZE, rowsById } from "./blocks/list-batch";
import type { QueryBudget, ReadClaim, ResolvedMedia } from "./context";
import { usableIds } from "./next-documents";
import type { BlocksPageConfig } from "./next-page-config";
import { readsMediaInBatches } from "./page-read-stages";

/** What ordinary Nextly media is tagged under for cache invalidation. */
export const MEDIA_TAG_COLLECTION = "media";

/**
 * Whether a resolution actually yielded a picture.
 *
 * `resolveMedia` may be the caller's own, so its answer is third-party data
 * however the type reads: a JavaScript implementation returning a missing
 * `Map.get` answers `undefined`, and one built from a partial record answers an
 * object with no usable `url`. The RENDERER treats both as unresolved and falls
 * back to the block's own `src`, so a check that counted them as a hit would end
 * the search here and leave the page described by no image at all — while it
 * displays one.
 */
function usableMedia(media: ResolvedMedia | null): boolean {
  return (
    media !== null &&
    media !== undefined &&
    typeof media.url === "string" &&
    media.url.trim() !== ""
  );
}

/**
 * Read a media record and describe it the way a block expects.
 *
 * The names are mapped rather than assumed to line up: a block asks for `alt`
 * and the record stores `altText`, and letting that fall through would render
 * the file name as alt text, which is an accessibility defect rather than a
 * cosmetic one.
 *
 * Read with access overridden because this resolves an asset the page already
 * renders — the entry's own read has settled whether the page may be seen, and
 * a second anonymous check here would blank the images on a page that passed it.
 */
/** The media surface the default resolver reads through. */
interface MediaReader {
  findByID(args: {
    id: string;
    disableErrors?: boolean;
  }): Promise<Record<string, unknown> | null>;
  /**
   * Several by id, in one read, judged as `findByID` is. Optional, so an
   * instance from before it existed still reads one at a time.
   */
  findByIDs?(args: {
    ids: readonly string[];
  }): Promise<readonly Record<string, unknown>[]>;
}

/**
 * The instance's media reader, when it has one.
 *
 * Media is a SYSTEM table with its own namespace, not a dynamic collection, so
 * `findByID({ collection: "media" })` goes through the collections handler and
 * finds nothing — the image block then catches the rejection and renders no
 * image, which is a default resolver that cannot resolve the default case.
 *
 * Detected structurally rather than by widening `NextlyContentReader`, which is
 * `Pick<Nextly, "find" | "findByID">` and shared with `resolveContent`: adding a
 * member there would oblige every caller injecting a stand-in — including tests
 * that legitimately have no media — to supply one.
 */
export function mediaNamespaceOf(
  reader: NextlyContentReader
): MediaReader | undefined {
  const candidate = (reader as { media?: unknown }).media;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const findByID = (candidate as { findByID?: unknown }).findByID;
  return typeof findByID === "function"
    ? (candidate as MediaReader)
    : undefined;
}

/**
 * One row from a named media collection, read under a lifecycle scope.
 *
 * `findByID` accepts no `status`, so a scoped by-id read has to be expressed as
 * a `find` on the id. Kept beside its only caller rather than generalized: the
 * posture here is stated explicitly on every field, which is what makes it
 * legible — a general helper would put the same decisions somewhere a reader of
 * this resolver cannot see.
 */
async function mediaByQuery(
  reader: NextlyContentReader,
  args: {
    collection: string;
    id: string;
    status: "published" | "draft" | "all";
    overrideAccess: boolean;
    disableErrors: boolean;
    // Both identity channels are part of this call's shape, so a caller cannot
    // build a read here that omits one.
    user?: undefined;
    req?: undefined;
    locale?: string;
  }
): Promise<Record<string, unknown> | undefined> {
  const { id, ...rest } = args;
  const found = await reader.find({
    ...rest,
    where: { id: { equals: id } },
    limit: 1,
  });
  return found.items[0];
}

/**
 * How one render reads its images, by id, as each image block asks: one
 * answer per id per render, so an image the page draws twice, or a list's
 * template image drawn for each entry, is read once.
 *
 * There is no batch: the system media library's Direct API reads one id at a
 * time, and a bound image is filled only once it carries its whole media
 * object, which is a relation read, not this one.
 */
export interface MediaReads {
  readonly resolve: (
    id: string,
    claim?: ReadClaim
  ) => Promise<ResolvedMedia | null>;
  /**
   * Read many images ahead, as a list's entries draw them: one read per
   * batch, through the same reader and posture as `resolve`, filling the
   * answers it then gives without a read of its own.
   */
  readonly ahead: (
    ids: readonly string[],
    claim: ReadClaim
  ) => Promise<boolean>;
}

/**
 * `config` reading in the language the request is served in: the route's own
 * `locale`, or the `[locale]` segment's, which the content route reads per
 * request. What its media reads and their cache key are scoped by, so a
 * German page draws its images' German URL and alt text.
 */
export function inRequestLanguage(
  config: BlocksPageConfig,
  context: { readonly locale?: string }
): BlocksPageConfig {
  return context.locale === undefined || context.locale === config.locale
    ? config
    : { ...config, locale: context.locale };
}

export function mediaResolver(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  budget: QueryBudget,
  cache: MediaReadCache | undefined
): MediaReads {
  const known = new Map<string, Promise<ResolvedMedia | null>>();
  // The ids a batch on its way will answer, by that batch's read.
  const inFlight = new Map<
    string,
    Promise<ReadonlyMap<string, ResolvedMedia | null> | undefined>
  >();
  const readOne = mediaReadOne(config, reader, cache);
  // A read is a read: a page whose images all resolve through the media
  // library spends the same budget a loop does, and an exhausted budget
  // resolves to no picture rather than to an unbounded page. A refusal is
  // not kept, so each block it reaches is named as unread.
  const ownRead = (id: string, claim?: ReadClaim) => {
    if (!budget.take({ ...claim, kind: "image" })) {
      return Promise.resolve(null);
    }
    const reading = readOne(id);
    known.set(id, reading);
    return reading;
  };
  /**
   * Whether every batch another list has on its way for any of `ids` was
   * usable, each awaited: `false` once one was not, so a list sharing it
   * stops where its owner does.
   */
  const sharedBatchesHold = async (
    ids: readonly string[]
  ): Promise<boolean> => {
    const pending = new Set(
      ids.flatMap(id => {
        const reading = inFlight.get(id);
        return reading === undefined ? [] : [reading];
      })
    );
    for (const reading of pending) {
      if ((await reading) === undefined) return false;
    }
    return true;
  };

  /**
   * One batch of images read ahead, `false` where it stopped short. A batch
   * that fails leaves each image to its own read, so it is asked only where
   * the allowance covers it and each image's own read after it: a batch
   * never costs an image its picture.
   */
  const readChunk = async (
    readMany: NonNullable<ReturnType<typeof mediaReadMany>>,
    chunk: readonly string[],
    claim: ReadClaim
  ): Promise<boolean> => {
    if ((budget.remaining?.() ?? Infinity) < chunk.length + 1) return false;
    if (!budget.take({ ...claim, kind: "image" })) return false;
    // Reserved before the read is awaited, so a list drawn beside this one
    // waits for it rather than reading the same ids again.
    const reading = readMany(chunk).catch(() => undefined);
    for (const id of chunk) inFlight.set(id, reading);
    const found = await reading;
    for (const id of chunk) inFlight.delete(id);
    // An unusable batch (refused, or rows it cannot match) stops the reads
    // ahead, so the allowance kept for each image's own read is not spent
    // by a later step first; its reservations are dropped.
    if (found === undefined) return false;
    for (const id of chunk) {
      known.set(id, Promise.resolve(found.get(id) ?? null));
    }
    return true;
  };
  return {
    resolve: (id: string, claim?: ReadClaim) => {
      const kept = known.get(id);
      if (kept !== undefined) return kept;
      // An id a batch on its way holds waits for it, and reads on its own
      // only where that batch turns out unusable.
      const pending = inFlight.get(id);
      if (pending !== undefined) {
        return pending.then(found =>
          found === undefined
            ? (known.get(id) ?? ownRead(id, claim))
            : (found.get(id) ?? null)
        );
      }
      return ownRead(id, claim);
    },
    ahead: async (ids, claim) => {
      const readMany = mediaReadMany(config, reader, cache);
      // A route that reads each image by its own id reads none ahead, and
      // stops the reads ahead here, so each image's own read, made as it is
      // drawn, comes before a later step's.
      if (readMany === undefined) return false;
      let rest = usableIds(ids).filter(id => !known.has(id));
      for (;;) {
        // Another list's batch on its way for any of these ids answers them
        // for this list too: awaited before this list reads anything of its
        // own, and its outcome is this list's, so an unusable one stops the
        // reads ahead here as well, leaving each image its own read.
        if (!(await sharedBatchesHold(rest))) return false;
        rest = rest.filter(id => !known.has(id));
        // A batch reserved while this list waited is awaited first too.
        if (rest.some(id => inFlight.has(id))) continue;
        // The ids as they stand now, none read and none reserved, with
        // nothing awaited between the choosing and the batch's claim and
        // reservation: one read or reserved meanwhile is not read again.
        const chunk = rest.slice(0, AHEAD_BATCH_SIZE);
        if (chunk.length === 0) return true;
        if (!(await readChunk(readMany, chunk, claim))) return false;
        rest = rest.filter(id => !known.has(id));
      }
    },
  };
}

/**
 * Many images' reads in one, where the route's images can be read so: a
 * named media collection by `id in`, under the per-id read's posture; the
 * media library through its `findByIDs`, which judges a caller as its
 * `findByID` does. `undefined` where neither is there (a host's own
 * resolver takes one id), and each image is read as it is drawn. An answer
 * holds every id asked, `null` for one with no usable picture; `undefined`
 * for an answer that cannot be matched to the ids with certainty.
 */
function mediaReadMany(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  cache: MediaReadCache | undefined
):
  | ((
      ids: readonly string[]
    ) => Promise<ReadonlyMap<string, ResolvedMedia | null> | undefined>)
  | undefined {
  const readRows = mediaRowsReader(config, reader);
  if (readRows === undefined) return undefined;
  return async ids => {
    // Kept as pairs rather than a Map, and an unmatched answer as `null`:
    // the cache keeps values as JSON, where a Map and `undefined` are lost.
    const drawn = await cachedMediaRead(
      config,
      cache,
      "nextly-media-batch",
      ids,
      async () => {
        const rows = await readRows(ids);
        return rows === undefined ? null : [...drawnEach(ids, rows)];
      },
      null
    );
    return drawn === null ? undefined : new Map(drawn);
  };
}

/**
 * The rows a batch of images reads, by id, where the route's images can be
 * read so; `undefined` for an answer that cannot be matched to the ids.
 */
function mediaRowsReader(
  config: BlocksPageConfig,
  reader: NextlyContentReader
):
  | ((
      ids: readonly string[]
    ) => Promise<ReadonlyMap<string, Record<string, unknown>> | undefined>)
  | undefined {
  const library = mediaNamespaceOf(reader);
  const findByIDs = library?.findByIDs?.bind(library);
  // The one answer to whether this route batches, which the editor's read
  // count asks too.
  if (
    !readsMediaInBatches({
      ownResolver: config.resolveMedia !== undefined,
      mediaCollection: config.mediaCollection,
      libraryReadsMany: findByIDs !== undefined,
    })
  ) {
    return undefined;
  }
  const collection = config.mediaCollection;
  if (collection !== undefined) {
    return async ids => {
      const found = await reader.find({
        collection,
        where: { id: { in: [...ids] } },
        limit: ids.length,
        ...mediaPosture(config),
      });
      return rowsById(found, ids);
    };
  }
  // Narrowed for the type: the check above already required it.
  if (findByIDs === undefined) return undefined;
  return async ids => {
    const rows = new Map<string, Record<string, unknown>>();
    for (const row of await findByIDs({ ids })) {
      if (typeof row.id === "string") rows.set(row.id, row);
    }
    return rows;
  };
}

/** Each id's picture from the rows read for it, `null` for none. */
function drawnEach(
  ids: readonly string[],
  rows: ReadonlyMap<string, Record<string, unknown>>
): Map<string, ResolvedMedia | null> {
  return new Map(
    ids.map(id => {
      const row = rows.get(id);
      return [id, row === undefined ? null : drawnMedia(row)] as const;
    })
  );
}

/**
 * The lifecycle and identity a named media collection is read under, by id or
 * in a batch alike.
 */
function mediaPosture(config: BlocksPageConfig): {
  status: "published" | "draft" | "all";
  overrideAccess: true;
  disableErrors: true;
  user: undefined;
  req: undefined;
  locale?: string;
} {
  return {
    // The SAME scope the entry and reference reads use, not a second
    // opinion. A route configured `draft: true` widens its entry reads,
    // and a preview referencing a never-published image would otherwise
    // render no picture on a page explicitly serving drafts.
    status: config.status ?? (config.draft === true ? "all" : "published"),
    overrideAccess: true,
    disableErrors: true,
    // Cleared for the same reason the entry and reference reads clear it:
    // `mergeConfig` spreads the reader's defaults under the call, so an
    // omitted `user` restores whatever identity the reader was booted
    // with. On an `overrideAccess: true` route a user-sensitive
    // `afterRead` hook would then bake a personalized URL or alt text
    // into the PUBLIC cached page.
    user: undefined,
    // Both identity channels, not just the obvious one. Access rules
    // are written against `req.user`, and `mergeConfig` spreads the
    // instance's defaults UNDER the call — so an omitted `req`
    // restores whatever identity the instance was booted with, on a
    // read this route performs for an anonymous visitor.
    req: undefined,
    // A named collection is an ordinary collection, so its URL and alt
    // fields can be localized. Omitting the locale reads the DEFAULT
    // one's record on a route configured for another — the wrong file, or
    // alt text in the wrong language. The entry and reference reads pass
    // it for the same reason.
    ...(config.locale ? { locale: config.locale } : {}),
  };
}

/**
 * How a public route keeps its image reads: in the cache its other reads use,
 * within the route's own window, so a read never outlives the page around it.
 * `undefined` on an access-enforced route, which reads them per request.
 */
export interface MediaReadCache {
  readonly window: number | false | undefined;
}

/**
 * An image read on a public route, run inside the cache the route's other
 * reads use, and tagged as a media write expires it: the media collection's
 * tag, and each id's. Run as it is on a route that caches nothing.
 *
 * Under Cache Components a prerender refuses an uncached read that takes the
 * current time, and a read of a missing record takes it: the media library
 * builds its not-found error, which records when it was made, before
 * `disableErrors` turns it into `null`. Inside the cache that error is made,
 * if at all, where the clock may be read, and the miss is kept as an answer,
 * so a later render of the page reads nothing for it until the id or the
 * collection is written.
 *
 * A refusal is answered as `refused` inside the read, so the answer kept is
 * the one every caller of this read wants, with no throw to catch on each hit
 * (`cachedFind` would keep the refusal and throw it again, now without taking
 * the clock). Any other failure still throws and is not kept, so a fault never
 * stands as a miss.
 */
async function cachedMediaRead<T>(
  config: BlocksPageConfig,
  cache: MediaReadCache | undefined,
  name: string,
  ids: readonly string[],
  read: () => Promise<T>,
  refused: T
): Promise<T> {
  if (cache === undefined) return await read();
  const collection = config.mediaCollection ?? MEDIA_TAG_COLLECTION;
  // The named collection's posture is part of the answer: its lifecycle and
  // language decide which row is read. The library has neither.
  const posture =
    config.mediaCollection === undefined ? undefined : mediaPosture(config);
  return await cachedFind(
    async () => {
      try {
        return await read();
      } catch (error) {
        if (isReadRefusal(error)) return refused;
        throw error;
      }
    },
    {
      // The collection's tag first, so it is never the one a long batch
      // drops: it is the tag every media write expires.
      tags: [
        ...nextlyTags(collection),
        ...ids.map(id => entryIdTag(collection, id)),
      ],
      keyParts: [
        name,
        posture === undefined ? "library" : `collection:${collection}`,
        posture?.status ?? "",
        posture?.locale ?? "",
        // The tenant discriminator, as every public read of the route keys it:
        // two sites over different databases ask for the same ids.
        config.cacheScope ?? "",
        // Sorted, so one set of ids asked in another order shares the entry.
        ...[...ids].sort(),
      ],
      revalidate: await releaseBoundedRevalidate(cache.window),
    }
  );
}

/** One image's read by id, claimed by the caller. */
function mediaReadOne(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  cache: MediaReadCache | undefined
): (id: string) => Promise<ResolvedMedia | null> {
  if (config.resolveMedia) {
    const custom = config.resolveMedia;
    // Charged like every other read on this path. A host's resolver is the one
    // most likely to be database- or network-backed, and it is called once per
    // image — so a template inside nested loops invokes it thousands of times.
    // Exempting it bounds the resolver we wrote and leaves unbounded the one a
    // site supplies, which is the wrong way round.
    // Normalized here rather than trusted, because this ONE function answers
    // both the render and the metadata. Left raw, a record carrying a blank URL
    // was rejected by the derivation — which moved on to the block's own `src`
    // or a later image — while `renderImage` took the same non-nullish value and
    // emitted it, so the preview picture and the page picture disagreed. The
    // usability rule has to live where both callers meet it.
    return async (id: string) => {
      const record = await custom(id);
      return usableMedia(record) ? record : null;
    };
  }
  // `disableErrors` on both paths, because `PageContext.resolveMedia`
  // promises `null` for an id it cannot resolve and the readers THROW
  // not-found otherwise. The core image block happens to catch that, so the
  // contract looked kept; a custom block reading the same context would get a
  // rejected promise instead of the documented answer.
  const readOne = async (id: string): Promise<ResolvedMedia | null> => {
    const record = config.mediaCollection
      ? // An explicitly named collection IS a dynamic collection — a site
        // storing its images somewhere of its own — so it reads as one, and
        // that means it has a LIFECYCLE. Issued as a `find` on the id rather
        // than `findByID`, which takes no `status`: a draft image in a site's
        // own collection must not reach a published page, and the query is the
        // only place that scope can be applied before an `afterRead` hook could
        // rewrite the field a post-read check would judge.
        await mediaByQuery(reader, {
          collection: config.mediaCollection,
          id,
          ...mediaPosture(config),
        })
      : await mediaNamespaceOf(reader)?.findByID({ id, disableErrors: true });
    return record ? drawnMedia(record) : null;
  };
  return async (id: string) => {
    // A blank id names no record, and has no tag to keep a read under: the
    // id tag refuses a blank segment by throwing.
    if (id.trim() === "") return null;
    return await cachedMediaRead(
      config,
      cache,
      "nextly-media",
      [id],
      async () => await readOne(id),
      null
    );
  };
}

/** A media record as an image draws it, or `null` for one with no address. */
function drawnMedia(record: Record<string, unknown>): ResolvedMedia | null {
  const { url, altText, width, height } = record;
  // Blank counts as unresolved, not as resolved-to-nothing. A record with an
  // empty URL would otherwise be preferred over the block's own `src`, and an
  // `<img src="">` re-requests the current page in some browsers; metadata
  // would likewise stop here instead of trying the next candidate.
  if (typeof url !== "string" || url.trim() === "") return null;
  return {
    url,
    ...(typeof altText === "string" ? { alt: altText } : {}),
    ...(typeof width === "number" ? { width } : {}),
    ...(typeof height === "number" ? { height } : {}),
  };
}
