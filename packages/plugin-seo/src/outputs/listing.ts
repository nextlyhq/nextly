/**
 * The pages the site lists for search engines, each decided from its one
 * answer: the outputs that list addresses (the sitemap, and `llms.txt`) read
 * them here, so none decides inclusion beside the page's head.
 *
 * A page is listed where its answer lets search engines index it and its
 * canonical is its own declared address, and only where the address record
 * says the page holds that address. A page whose address another page holds,
 * or that no page holds yet, is left out and returned as a problem instead.
 *
 * Every page is read as the system, published versions only: a working draft
 * changes nothing listed until it is published.
 *
 * @module outputs/listing
 */
import {
  getCachedNextly,
  languageAddressOf,
  NextlyError,
  publicAddressOf,
  type AddressHolder,
  type PublicAddress,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import {
  addressHolders,
  recordSlug,
  rowOf,
  withAddressHolders,
} from "../address-record/participant";
import type { SeoAnswer } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import { MAX_LOC_LENGTH, publishedWhere, toLastModified } from "../sitemap";

import type { SitemapPage } from "./sitemap-files";

/** A listed page, and which document it is. */
export interface ListedPage extends SitemapPage {
  holder: AddressHolder;
  /** The page's own address, from the site's root. */
  path: string;
}

/**
 * A page left out although it would be listed: its address is held by
 * another page (`held-by-another`, naming it), or by none yet
 * (`not-recorded`, until the record catches up).
 */
export interface ListingProblem {
  kind: "held-by-another" | "not-recorded";
  holder: AddressHolder;
  path: string;
  heldBy?: AddressHolder;
}

/**
 * The SEO plugin's `listedPages` service: the pages the site lists, made
 * absolute against `origin`, and the pages left out as problems.
 */
export interface ListedPagesService {
  list(
    origin: string
  ): Promise<{ pages: ListedPage[]; problems: ListingProblem[] }>;
}

/** What the listing reads with. */
export interface ListingOptions {
  /** The site's origin, every listed address made absolute against it. */
  origin: string;
  /** The site's rules, as the page's head reads them. */
  readRules?: ReadRules;
  /** Only these collections, where given; Singles are listed either way. */
  collections?: readonly string[];
}

/** How many documents one read takes. */
const PAGE_SIZE = 100;
/** How many record rows one read takes. */
const RECORD_PAGE = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `address` resolved against `origin` into an absolute address, or null where
 * it is not a web address at all. Resolution only: whether a canonical is
 * usable is the answer's to say, and it is taken as answered.
 */
function absolute(address: string, origin: string): string | null {
  try {
    const url = new URL(address, origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** One document of a type, with the key its address is held under. */
interface Candidate {
  type: PublicAddressType;
  holder: AddressHolder;
  document: Record<string, unknown>;
}

/**
 * The paths each of `ids` holds in the record, by id, read a page at a time.
 */
async function heldPaths(
  ctx: PluginContext,
  collection: string,
  ids: readonly string[]
): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>();
  if (ids.length === 0) return held;
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      recordSlug(ctx),
      {
        where: {
          and: [
            { kind: { equals: "address" } },
            // Held in another language, a path says nothing of this one.
            { locale: { equals: await recordLanguage(ctx) } },
            { holderCollection: { equals: collection } },
            { holderId: { in: [...ids] } },
          ],
        },
        sort: { field: "claimKey", direction: "asc" },
        pagination: { limit: RECORD_PAGE, page },
        depth: 0,
      }
    );
    const rows = (data as unknown[]).map(rowOf);
    for (const row of rows) {
      if (row.holder === null || row.address === null) continue;
      const paths = held.get(row.holder.id) ?? new Set<string>();
      paths.add(row.address.path);
      held.set(row.holder.id, paths);
    }
    if (rows.length < RECORD_PAGE) return held;
  }
}

/**
 * The language the listed pages are read in, as the address record keys it:
 * core's answer, the site's default language.
 */
function recordLanguage(ctx: PluginContext): Promise<string> {
  return ctx.publicAddresses.defaultLanguage();
}

/**
 * `path` as the language `locale` serves it, root-relative or on that
 * language's own domain; `path` itself on a site with no languages.
 */
async function servedAt(
  path: string,
  locale: string
): Promise<string | undefined> {
  const served = await languageAddressOf(path, locale);
  return served.status === "resolved"
    ? `${served.origin ?? ""}${served.path}`
    : undefined;
}

/** A Single's published document, or null where it has none. */
async function singleDocument(
  slug: string
): Promise<Record<string, unknown> | null> {
  const nextly = await getCachedNextly();
  try {
    const document: unknown = await nextly.findSingle({
      slug,
      createIfMissing: false,
      overrideAccess: true,
      // Published values only, as a visitor is served them: a draft, and a
      // Single a release has withdrawn, are no page.
      status: "published",
      depth: 1,
    });
    return isRecord(document) ? document : null;
  } catch (error) {
    // A Single never published is not found by a read of published values.
    if (NextlyError.isCode(error, "NOT_FOUND")) return null;
    throw error;
  }
}

/** A Single's page, where it has a published one. */
async function* singlePages(
  type: PublicAddressType
): AsyncGenerator<Candidate[]> {
  const document = await singleDocument(type.slug);
  if (document === null) return;
  const holder = { collection: `single:${type.slug}`, id: String(document.id) };
  yield [{ type, holder, document }];
}

/** A collection's published pages, a read at a time. */
async function* collectionPages(
  ctx: PluginContext,
  type: PublicAddressType
): AsyncGenerator<Candidate[]> {
  const where = await publishedWhere(ctx.services, type.slug);
  for (let page = 1; ; page++) {
    const result = await ctx.services.collections.listEntries(
      type.slug,
      {
        where,
        // Images populated, so a page's own is read with it, not looked up.
        depth: 1,
        // Stable, so consecutive pages neither overlap nor skip a row.
        sort: { field: "id", direction: "asc" },
        pagination: { limit: PAGE_SIZE, page },
      },
      { as: "system" }
    );
    yield (result.data as unknown[]).filter(isRecord).map(document => ({
      type,
      holder: { collection: type.slug, id: String(document.id) },
      document,
    }));
    if (!result.pagination.hasMore) return;
  }
}

/** Whether `type` is one the listing covers: public, and not narrowed away. */
async function covered(
  type: PublicAddressType,
  options: ListingOptions,
  language: string
): Promise<boolean> {
  const narrowedAway =
    type.kind === "collection" &&
    options.collections !== undefined &&
    !options.collections.includes(type.slug);
  // A type that declares no address has no page to list, asked in the
  // language the record keeps addresses in, as a page's own is.
  return (
    !narrowedAway &&
    (await publicAddressOf(type, undefined, language)).status !== "none"
  );
}

/** Every page of the site that may be listed, a read at a time. */
async function* candidates(
  ctx: PluginContext,
  options: ListingOptions
): AsyncGenerator<Candidate[]> {
  for (const type of await ctx.publicAddresses.types()) {
    if (!(await covered(type, options, await recordLanguage(ctx)))) continue;
    yield* type.kind === "single"
      ? singlePages(type)
      : collectionPages(ctx, type);
  }
}

/**
 * A page left out because it does not hold its own address: which page holds
 * it instead, where one does.
 */
async function problemOf(
  ctx: PluginContext,
  holder: AddressHolder,
  path: string
): Promise<ListingProblem> {
  const heldBy = (
    await addressHolders(ctx, path, await recordLanguage(ctx))
  ).find(
    other => other.collection !== holder.collection || other.id !== holder.id
  );
  const page = { collection: holder.collection, id: holder.id };
  return heldBy === undefined
    ? { kind: "not-recorded", holder: page, path }
    : { kind: "held-by-another", holder: page, path, heldBy };
}

/** `readRules`, read at most once for each language it is asked in. */
function onceEach(readRules: ReadRules): ReadRules {
  const read = new Map<string | undefined, ReturnType<ReadRules>>();
  return (ctx, locale) => {
    let rules = read.get(locale);
    if (rules === undefined) {
      rules = readRules(ctx, locale);
      read.set(locale, rules);
    }
    return rules;
  };
}

/**
 * The site's listable pages, in type order and then by id, and the pages left
 * out because they do not hold their own address: one whose answer has no
 * canonical although its type declares it an address, or one the record
 * does not give the address it is listed at.
 */
export async function listPages(
  ctx: PluginContext,
  options: ListingOptions
): Promise<{ pages: ListedPage[]; problems: ListingProblem[] }> {
  const found = { pages: [] as ListedPage[], problems: [] as ListingProblem[] };
  const language = await recordLanguage(ctx);
  // The site's rules are read once per language for the whole listing, not
  // once a page; nothing is kept past it, so the next listing reads afresh.
  const readRules =
    options.readRules === undefined ? undefined : onceEach(options.readRules);
  for await (const batch of candidates(ctx, options)) {
    await listBatch(
      ctx,
      batch,
      {
        ...options,
        language,
        ...(readRules === undefined ? {} : { readRules }),
      },
      found
    );
  }
  return found;
}

/**
 * One read's pages, listed into `found`: the record read once for the whole
 * batch, both for what each page holds and for who holds each page's own
 * address, which the answer of each page asks.
 */
async function listBatch(
  ctx: PluginContext,
  batch: readonly Candidate[],
  options: ListingOptions & { language: string },
  found: { pages: ListedPage[]; problems: ListingProblem[] }
): Promise<void> {
  // Asked in the language the record keeps it in, so the address compared
  // with the record is the one the record was made from.
  const owns = await Promise.all(
    batch.map(candidate =>
      publicAddressOf(candidate.type, candidate.document, options.language)
    )
  );
  const held = await heldPaths(
    ctx,
    batch[0]?.holder.collection ?? "",
    batch.map(candidate => candidate.holder.id)
  );
  const paths = owns.flatMap(own =>
    own.status === "resolved" ? [own.path] : []
  );
  await withAddressHolders(ctx, options.language, paths, async () => {
    for (const [at, candidate] of batch.entries()) {
      const own = owns[at];
      const outcome =
        own === undefined ? null : await listed(ctx, candidate, own, options);
      if (outcome === null) continue;
      const { holder, path } = "lost" in outcome ? outcome.lost : outcome.page;
      if ("page" in outcome && held.get(holder.id)?.has(path) === true) {
        found.pages.push(outcome.page);
      } else {
        found.problems.push(await problemOf(ctx, holder, path));
      }
    }
  });
}

/** The page's own image as an absolute address, not the site's default. */
function ownImage(answer: SeoAnswer, origin: string): string[] {
  if (answer.image === undefined || answer.image.from === "site") return [];
  const image = absolute(answer.image.value.url, origin);
  return image === null ? [] : [image];
}

/**
 * Where a page whose own address is `own` is listed, from its answer: at its
 * canonical as the answer gives it, where that is its own address. A canonical typed to
 * another page is that page's to list. Null where the page is hidden, has no
 * declared address, or names an address past the protocol's length;
 * `lost` where its type declares it an address but its answer has no
 * canonical, so another page holds it.
 */
async function listedAt(
  answer: SeoAnswer,
  origin: string,
  locale: string,
  own: PublicAddress
): Promise<{ loc: string; path: string } | { lost: string } | null> {
  if (!answer.robots.value.index) return null;
  if (own.status !== "resolved") return null;
  if (answer.canonical === undefined) return { lost: own.path };
  const loc = absolute(answer.canonical.value, origin);
  // A typed canonical is the page's own where it names the page's address as
  // the page's language serves it.
  const served = await servedAt(own.path, locale);
  const elsewhere =
    answer.canonical.from !== "address" &&
    (served === undefined || loc !== absolute(served, origin));
  if (loc === null || elsewhere || loc.length > MAX_LOC_LENGTH) return null;
  // A canonical on another of the site's addresses, such as a language's own
  // domain, is listed in that address's sitemap: a sitemap lists its own
  // origin's pages alone.
  if (new URL(loc).origin !== new URL(origin).origin) return null;
  return { loc, path: own.path };
}

/**
 * The page `candidate` is, as it would be listed, the address it lost where
 * it lost its own, or null where it is not listed at all.
 */
async function listed(
  ctx: PluginContext,
  candidate: Candidate,
  own: PublicAddress,
  options: ListingOptions & { language: string }
): Promise<
  | { page: ListedPage }
  | { lost: { holder: AddressHolder; path: string } }
  | null
> {
  const { type, document, holder } = candidate;
  // Read in the site's default language as the live language list names it:
  // the page is listed where that language serves it, which on a site with
  // no other language is the page's own path. Its other languages'
  // addresses are its own.
  const locale = options.language;
  const answer = await resolveSeo(
    ctx,
    {
      source:
        type.kind === "single"
          ? { kind: "single", slug: type.slug, document }
          : { kind: "entry", collection: type.slug, entry: document },
      code: {},
      derived: {},
      locale,
    },
    options.readRules
  );
  const at = await listedAt(answer, options.origin, locale, own);
  if (at === null) return null;
  if ("lost" in at) return { lost: { holder, path: at.lost } };
  const lastModified = toLastModified(document.updatedAt);
  return {
    page: {
      ...at,
      holder,
      images: ownImage(answer, options.origin),
      ...(lastModified === undefined ? {} : { lastModified }),
    },
  };
}
