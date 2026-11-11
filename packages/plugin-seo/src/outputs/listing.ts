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
  NextlyError,
  publicAddressOf,
  type AddressHolder,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { recordSlug, rowOf } from "../address-record/participant";
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

/** `address` as an absolute http(s) address on `origin`'s terms, or null. */
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

/** Whichever page the record says holds `path`, in any language, or none. */
async function holderOfPath(
  ctx: PluginContext,
  path: string
): Promise<AddressHolder | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: {
        and: [{ kind: { equals: "address" } }, { path: { equals: path } }],
      },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  return (data as unknown[]).map(rowOf)[0]?.holder ?? undefined;
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
  options: ListingOptions
): Promise<boolean> {
  const narrowedAway =
    type.kind === "collection" &&
    options.collections !== undefined &&
    !options.collections.includes(type.slug);
  // A type that declares no address has no page to list.
  return !narrowedAway && (await publicAddressOf(type)).status !== "none";
}

/** Every page of the site that may be listed, a read at a time. */
async function* candidates(
  ctx: PluginContext,
  options: ListingOptions
): AsyncGenerator<Candidate[]> {
  for (const type of await ctx.publicAddresses.types()) {
    if (!(await covered(type, options))) continue;
    yield* type.kind === "single"
      ? singlePages(type)
      : collectionPages(ctx, type);
  }
}

/**
 * A page left out because the record does not give it its address: which
 * page holds the address instead, where one does.
 */
async function problemOf(
  ctx: PluginContext,
  page: ListedPage
): Promise<ListingProblem> {
  const heldBy = await holderOfPath(ctx, page.path);
  const holder = { collection: page.holder.collection, id: page.holder.id };
  return heldBy === undefined
    ? { kind: "not-recorded", holder, path: page.path }
    : { kind: "held-by-another", holder, path: page.path, heldBy };
}

/**
 * The site's listable pages, in type order and then by id, and the pages left
 * out because the record does not give them their address.
 */
export async function listPages(
  ctx: PluginContext,
  options: ListingOptions
): Promise<{ pages: ListedPage[]; problems: ListingProblem[] }> {
  const pages: ListedPage[] = [];
  const problems: ListingProblem[] = [];
  for await (const batch of candidates(ctx, options)) {
    const held = await heldPaths(
      ctx,
      batch[0]?.holder.collection ?? "",
      batch.map(candidate => candidate.holder.id)
    );
    for (const candidate of batch) {
      const page = await listed(ctx, candidate, options);
      if (page === null) continue;
      if (held.get(page.holder.id)?.has(page.path) === true) pages.push(page);
      else problems.push(await problemOf(ctx, page));
    }
  }
  return { pages, problems };
}

/** The page's own image as an absolute address, not the site's default. */
function ownImage(answer: SeoAnswer, origin: string): string[] {
  if (answer.image === undefined || answer.image.from === "site") return [];
  const image = absolute(answer.image.value.url, origin);
  return image === null ? [] : [image];
}

/**
 * The absolute address `candidate` is listed at, where its answer lets it be:
 * indexed, with its canonical its own declared address, within the
 * protocol's length for one address. Null otherwise.
 */
async function listedAt(
  candidate: Candidate,
  answer: SeoAnswer,
  origin: string
): Promise<{ loc: string; path: string } | null> {
  if (!answer.robots.value.index || answer.canonical === undefined) return null;
  const own = await publicAddressOf(candidate.type, candidate.document);
  if (own.status !== "resolved") return null;
  const loc = absolute(own.path, origin);
  // A canonical elsewhere, on the site or off it, is that page's to list.
  const canonical = absolute(answer.canonical.value, origin);
  if (loc === null || canonical !== loc || loc.length > MAX_LOC_LENGTH) {
    return null;
  }
  return { loc, path: own.path };
}

/** The page `candidate` is, as it would be listed, or null where it is not. */
async function listed(
  ctx: PluginContext,
  candidate: Candidate,
  options: ListingOptions
): Promise<ListedPage | null> {
  const { type, document, holder } = candidate;
  const answer = await resolveSeo(
    ctx,
    {
      source:
        type.kind === "single"
          ? { kind: "single", slug: type.slug, document }
          : { kind: "entry", collection: type.slug, entry: document },
      code: {},
      derived: {},
    },
    options.readRules
  );
  const at = await listedAt(candidate, answer, options.origin);
  if (at === null) return null;
  const lastModified = toLastModified(document.updatedAt);
  return {
    ...at,
    holder,
    images: ownImage(answer, options.origin),
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}
