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
 * On a site with several languages, each version of a page is listed in its
 * own right, in every language the record says the page is published in,
 * and carries the page's language links.
 *
 * Every page is read as the system, published versions only: a working draft
 * changes nothing listed until it is published.
 *
 * @module outputs/listing
 */
import {
  publicAddressOf,
  type AddressHolder,
  type PublicAddress,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import {
  addressHolders,
  withAddressHolders,
} from "../address-record/participant";
import { languageLinks } from "../languages/links";
import {
  absolute,
  documentsIn,
  heldLanguages,
  otherLanguages,
  resolveIn,
  servedAt,
  singleIn,
  standingOf,
  type HeldLanguages,
} from "../languages/versions";
import type { SeoAnswer } from "../resolver/order";
import type { ReadRules } from "../resolver/provider";
import { publishedWhere, toLastModified } from "../sitemap";

import type { SitemapPage } from "./sitemap-files";

/** A listed page, and which document it is. */
export interface ListedPage extends SitemapPage {
  holder: AddressHolder;
  /** The page's own address, from the site's root. */
  path: string;
  /** The language this version of the page is in, as the site spells it. */
  language: string;
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
  /** The language of the version left out. */
  language: string;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One document of a type, with the key its address is held under. */
interface Candidate {
  type: PublicAddressType;
  holder: AddressHolder;
  document: Record<string, unknown>;
}

/**
 * The language the listed pages are read in, as the address record keys it:
 * core's answer, the site's default language.
 */
function recordLanguage(ctx: PluginContext): Promise<string> {
  return ctx.publicAddresses.defaultLanguage();
}

/** A Single's page, where it has a published one. */
async function* singlePages(
  type: PublicAddressType
): AsyncGenerator<Candidate[]> {
  const document = await singleIn(type.slug, undefined);
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
 * A version left out because it does not hold its own address in its
 * language: which page holds it instead, where one does.
 */
async function problemOf(
  ctx: PluginContext,
  holder: AddressHolder,
  path: string,
  language: string
): Promise<ListingProblem> {
  const heldBy = (await addressHolders(ctx, path, language)).find(
    other => other.collection !== holder.collection || other.id !== holder.id
  );
  const page = { collection: holder.collection, id: holder.id };
  return heldBy === undefined
    ? { kind: "not-recorded", holder: page, path, language }
    : { kind: "held-by-another", holder: page, path, language, heldBy };
}

/**
 * The site's listable pages, in type order, then by id, then by language,
 * the default language first, and the versions left out because they do
 * not hold their own address: one whose answer has no canonical although
 * its type declares it an address, or one the record does not give the
 * address it is listed at.
 */
export async function listPages(
  ctx: PluginContext,
  options: ListingOptions
): Promise<{ pages: ListedPage[]; problems: ListingProblem[] }> {
  const found = { pages: [] as ListedPage[], problems: [] as ListingProblem[] };
  const language = await recordLanguage(ctx);
  for await (const batch of candidates(ctx, options)) {
    await listBatch(ctx, batch, { ...options, language }, found);
  }
  return found;
}

/** A version of a page that stands for itself, as it would be listed. */
type Standing = Map<string, ListedPage[]>;

/**
 * One read's pages, listed into `found` in every language each is published
 * in: the record read once for the whole batch, in every language, and each
 * other language's documents read once. Each version carries the language
 * links of its page, built from every version that stands for itself, those
 * on another of the site's addresses included, so each names all the others.
 */
async function listBatch(
  ctx: PluginContext,
  batch: readonly Candidate[],
  options: ListingOptions & { language: string },
  found: { pages: ListedPage[]; problems: ListingProblem[] }
): Promise<void> {
  const [first] = batch;
  if (first === undefined) return;
  const held = await heldLanguages(
    ctx,
    first.holder.collection,
    batch.map(candidate => candidate.holder.id)
  );
  const standing: Standing = new Map();
  await listIn(ctx, batch, options.language, held, options, found, standing);
  for (const language of otherLanguages(held.values(), options.language)) {
    // Only the pages the record says are published in it: a page read in a
    // language it has no published version in is served another's values.
    const ids = batch.flatMap(candidate =>
      held.get(candidate.holder.id)?.has(language) === true
        ? [candidate.holder.id]
        : []
    );
    const documents = await documentsIn(ctx, first.type, ids, language);
    const versions = batch.flatMap(candidate => {
      const document = documents.get(candidate.holder.id);
      return document === undefined ? [] : [{ ...candidate, document }];
    });
    await listIn(ctx, versions, language, held, options, found, standing);
  }
  const site = new URL(options.origin).origin;
  for (const candidate of batch) {
    const versions = standing.get(candidate.holder.id) ?? [];
    const { links } = languageLinks(
      versions.map(page => ({ language: page.language, href: page.loc })),
      options.language
    );
    for (const page of versions) {
      // A version on another of the site's addresses, such as a language's
      // own domain, is listed in that address's sitemap: a sitemap lists its
      // own origin's pages alone. It is still one of the links of the rest.
      if (new URL(page.loc).origin !== site) continue;
      found.pages.push(
        links.length > 0 ? { ...page, alternates: links } : page
      );
    }
  }
}

/**
 * The versions of `candidates` in `language`, each read in it: those that
 * stand for themselves and hold their address there into `standing`, and a
 * problem for each that would be listed but does not hold its address. Who
 * holds each version's own address is read once for them all.
 */
async function listIn(
  ctx: PluginContext,
  candidates: readonly Candidate[],
  language: string,
  held: ReadonlyMap<string, HeldLanguages>,
  options: ListingOptions,
  found: { problems: ListingProblem[] },
  standing: Standing
): Promise<void> {
  // Asked in the language the record keeps it in, so the address compared
  // with the record is the one the record was made from.
  const owns = await Promise.all(
    candidates.map(candidate =>
      publicAddressOf(candidate.type, candidate.document, language)
    )
  );
  const paths = owns.flatMap(own =>
    own.status === "resolved" ? [own.path] : []
  );
  await withAddressHolders(ctx, language, paths, async () => {
    for (const [at, candidate] of candidates.entries()) {
      const own = owns[at];
      const outcome =
        own === undefined
          ? null
          : await listed(ctx, candidate, own, language, options);
      if (outcome === null) continue;
      const { holder, path } = "lost" in outcome ? outcome.lost : outcome.page;
      const holds = held.get(holder.id)?.get(language)?.has(path) === true;
      if ("page" in outcome && holds) {
        const versions = standing.get(holder.id) ?? [];
        versions.push(outcome.page);
        standing.set(holder.id, versions);
      } else {
        found.problems.push(await problemOf(ctx, holder, path, language));
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
 * The version `candidate` is in `language`, as it would be listed, the
 * address it lost where it lost its own, or null where it is not listed at
 * all: hidden, with no declared address, or naming another page.
 */
async function listed(
  ctx: PluginContext,
  candidate: Candidate,
  own: PublicAddress,
  language: string,
  options: ListingOptions
): Promise<
  | { page: ListedPage }
  | { lost: { holder: AddressHolder; path: string } }
  | null
> {
  const { type, document, holder } = candidate;
  if (own.status !== "resolved") return null;
  // Read in the version's language as the live language list names it: the
  // page is listed where that language serves it, which on a site with no
  // other language is the page's own path.
  const answer = await resolveIn(
    ctx,
    type,
    document,
    language,
    options.readRules
  );
  const at = standingOf(
    answer,
    options.origin,
    await servedAt(own.path, language)
  );
  if (at === null) return null;
  if (at === "lost") return { lost: { holder, path: own.path } };
  const lastModified = toLastModified(document.updatedAt);
  return {
    page: {
      loc: at.loc,
      path: own.path,
      language,
      holder,
      images: ownImage(answer, options.origin),
      ...(lastModified === undefined ? {} : { lastModified }),
    },
  };
}
