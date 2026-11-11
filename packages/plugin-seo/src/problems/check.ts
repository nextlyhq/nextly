/**
 * Running the problem list's checks and reading what they found.
 *
 * A page is checked when it is saved, and the whole site when a person asks
 * or opens the list after a day; each check's result is kept (`store`), so
 * opening the list reads rows, and serving a page checks nothing. What
 * belongs to no page (the production address, a type with no address) and
 * what compares pages (a shared title) is worked out as the list is read,
 * from settings and the kept rows, so it is never out of date itself.
 *
 * @module problems/check
 */
import {
  addressOfRequest,
  typesWithoutAddress,
  type PageMetadataInput,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { addressHolders } from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import { pageLanguageLinks } from "../languages/head";
import { listPages } from "../outputs/listing";
import { isRecord, textOf } from "../plain-values";
import { destinationOf, pathOf } from "../redirects/addresses";
import { redirectsSlug } from "../redirects/collection";
import { redirectMeeting } from "../redirects/meeting";
import { redirectOf, type StoredRedirect } from "../redirects/store";
import { addressOf } from "../resolver/page-levels";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import type { ReadSocialCardRules } from "../social/card";
import { shareImageProblems } from "../social/problems";
import { readStanding } from "../staging/guard";
import { structuredDataProblems } from "../structured-data/provider";
import type { ReadStructuredDataRules } from "../structured-data/rules";

import { contentFacts } from "./content";
import {
  FULL_CHECK_MAX_AGE_MS,
  KIND_ORDER,
  type Problem,
  type ProblemListBody,
} from "./contract";
import { addressShapes, brokenLinks } from "./links";
import { pageProblems } from "./page-checks";
import {
  listingProblems,
  noAddressProblems,
  productionAddressProblems,
  redirectChainProblems,
  sharedValueProblems,
  type RedirectChain,
} from "./site-checks";
import {
  markOutOfDate,
  pageKey,
  readPage,
  readPages,
  readSiteCheck,
  removePage,
  savePage,
  saveSiteCheck,
  type PageRow,
} from "./store";

/** Where the checks read the site's rules from: as each page's head does. */
export interface CheckReaders {
  readRules: ReadRules;
  readStructuredDataRules: ReadStructuredDataRules;
  readSocialCardRules: ReadSocialCardRules;
}

/** What the checks run over: the types SEO is added to, and the rules. */
export interface ProblemChecks {
  targets: readonly string[];
  readers: CheckReaders;
}

/** The fields a page is named by in the list, in the order they are tried. */
const LABEL_FIELDS = ["title", "name", "heading", "slug"] as const;

/** A page as the list names it: its title, or else its id. */
function labelOf(entry: Readonly<Record<string, unknown>>, id: string): string {
  for (const field of LABEL_FIELDS) {
    const value = textOf(entry[field]);
    if (value !== undefined) return value;
  }
  return id;
}

/**
 * The entry `id` of `type`, as a route reads it: one level of links
 * expanded, so a media field reads as the media library's item. Nothing
 * where it does not exist.
 */
async function readEntry(
  ctx: PluginContext,
  type: string,
  id: string
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const { data } = await ctx.services.collections.listEntries(type, {
    where: { id: { equals: id } },
    pagination: { limit: 1, page: 1 },
    depth: 1,
  });
  const [entry] = data as unknown[];
  return isRecord(entry) ? entry : undefined;
}

/**
 * The public address the page holds, read from the site's record: its
 * type's address, held by this page. None for a draft, which holds no
 * address, for a page that lost its address to another, and for a type
 * with no address.
 */
async function heldAddress(
  ctx: PluginContext,
  type: string,
  entry: Readonly<Record<string, unknown>>,
  id: string
): Promise<string | undefined> {
  const address = await addressOf(
    ctx,
    { type: { kind: "collection", slug: type }, key: type },
    entry,
    undefined,
    undefined
  );
  if (address === undefined) return undefined;
  const holders = await addressHolders(ctx, address, undefined);
  return holders.some(holder => holder.collection === type && holder.id === id)
    ? address
    : undefined;
}

/** What a page's check found, before it is kept. */
async function examine(
  ctx: PluginContext,
  checks: ProblemChecks,
  type: string,
  id: string
): Promise<PageRow | undefined> {
  const entry = await readEntry(ctx, type, id);
  if (entry === undefined) return undefined;
  const ownAddress = await heldAddress(ctx, type, entry, id);
  if (ownAddress === undefined) return undefined;

  const { readers } = checks;
  const input: PageMetadataInput = {
    source: { kind: "entry", collection: type, entry },
    code: {},
    derived: {},
  };
  const answer = await resolveSeo(ctx, input, readers.readRules);
  const rules = await readers.readRules(ctx, undefined);
  const productionAddresses = productionAddressesOf(rules.productionAddresses);
  const content = contentFacts(entry);
  const subject = { type, id, label: labelOf(entry, id), detail: ownAddress };
  const problems = pageProblems({
    subject,
    answer,
    ownAddress,
    productionAddresses,
    shareImage: await shareImageProblems(ctx, input, readers),
    structuredData: await structuredDataProblems(ctx, input, readers),
    images: content.images,
    languageCodes: (
      await pageLanguageLinks(
        ctx,
        input,
        readers.readRules,
        answer.canonical?.value
      )
    ).problems,
    brokenLinks: await brokenLinks(content.links, {
      shapes: addressShapes(ctx.config.collections ?? []),
      productionAddresses,
      // Read by the same rule a visitor's request is, as the Proxy reads it.
      keptOf: url => addressOfRequest(url),
      isHeld: async (path, locale) =>
        (await addressHolders(ctx, path, locale)).length > 0,
    }),
  });
  // A page kept out of search shares its title with no page in results, so
  // it is left out of the comparison.
  const listed = answer.robots.value.index;
  return {
    subject,
    ...(answer.title === undefined || !listed
      ? {}
      : { title: answer.title.value }),
    ...(answer.description === undefined || !listed
      ? {}
      : { description: answer.description.value }),
    problems,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Whether a page's new check can alter another page's result: it appeared,
 * or its address, title or description changed.
 */
function altersOthers(before: PageRow | undefined, row: PageRow): boolean {
  return (
    before === undefined ||
    before.subject.detail !== row.subject.detail ||
    before.title !== row.title ||
    before.description !== row.description
  );
}

/**
 * Check one page and keep what was found, or forget it where it is not a
 * public page (gone, a draft, or of a type with no address). Where the
 * change can alter another page's result, the full check is marked out of
 * date first, so whoever reads the page's new row also reads the mark.
 */
async function checkPage(
  ctx: PluginContext,
  checks: ProblemChecks,
  type: string,
  id: string
): Promise<void> {
  const before = await readPage(ctx, type, id);
  const row = await examine(ctx, checks, type, id);
  if (row === undefined) {
    if (before === undefined) return;
    await markOutOfDate(ctx);
    await removePage(ctx, type, id);
    return;
  }
  if (altersOthers(before, row)) await markOutOfDate(ctx);
  await savePage(ctx, row);
}

/** Pages read per step of a full check. */
const HELD_PAGE = 100;

/**
 * Check every page of `slug` holding an address, keep each result, and add
 * each page's key to `seen`.
 */
async function checkType(
  ctx: PluginContext,
  checks: ProblemChecks,
  slug: string,
  seen: Set<string>
): Promise<void> {
  let after: string | undefined;
  do {
    const page = await ctx.publicAddresses.held({
      type: { kind: "collection", slug },
      after,
      limit: HELD_PAGE,
    });
    for (const document of page.items) {
      if (document.holds.length === 0) continue;
      const { id } = document.holder;
      const row = await examine(ctx, checks, slug, id);
      if (row === undefined) continue;
      await savePage(ctx, row);
      seen.add(pageKey(slug, id));
    }
    after = page.next;
  } while (after !== undefined);
}

/**
 * Check every public page of the types SEO is added to, keep each result,
 * forget the rows of pages that are no longer public, and record the check.
 */
async function runSiteCheck(
  ctx: PluginContext,
  checks: ProblemChecks
): Promise<void> {
  const seen = new Set<string>();
  const siteTypes = new Set(
    (await ctx.publicAddresses.types())
      .filter(type => type.kind === "collection")
      .map(type => type.slug)
  );
  for (const slug of checks.targets) {
    if (siteTypes.has(slug)) await checkType(ctx, checks, slug, seen);
  }
  // A page the walk did not reach may have been published after its type
  // was walked, its row written by its save's own check: it is checked
  // again in its turn, which keeps it while it is public and forgets it
  // where it is not.
  for (const row of await readPages(ctx)) {
    const { type, id } = row.subject;
    if (seen.has(pageKey(type, id))) continue;
    await inTurn(ctx, type, id, "The SEO plugin could not check a page", () =>
      checkPage(ctx, checks, type, id)
    );
  }
  await saveSiteCheck(ctx, {
    checkedAt: new Date().toISOString(),
    pagesChecked: seen.size,
    problems: [
      ...(await leftOutOfListing(ctx, checks)),
      ...redirectChainProblems(await redirectChains(ctx)),
    ],
  });
}

/** The origin pages are listed on where the site names none: only paths are kept. */
const NO_ORIGIN = "https://site.invalid";

/**
 * The pages the sitemap leaves out though their type declares them an
 * address, read by the same listing the sitemap is made from, and named as
 * their last check left them.
 */
async function leftOutOfListing(
  ctx: PluginContext,
  checks: ProblemChecks
): Promise<Problem[]> {
  const rules = await checks.readers.readRules(ctx, undefined);
  const origin =
    productionAddressesOf(rules.productionAddresses)[0] ?? NO_ORIGIN;
  const { problems } = await listPages(ctx, {
    origin,
    readRules: checks.readers.readRules,
    collections: checks.targets,
  });
  const labels = new Map(
    (await readPages(ctx)).map(row => [
      `${row.subject.type}:${row.subject.id}`,
      {
        label: row.subject.label,
        ...(row.subject.detail === undefined
          ? {}
          : { detail: row.subject.detail }),
      },
    ])
  );
  return listingProblems(
    problems,
    labels,
    await ctx.publicAddresses.defaultLanguage()
  );
}

/** Redirects read per step of a full check. */
const REDIRECT_PAGE = 100;

/** Every stored redirect, in pages of {@link REDIRECT_PAGE}. */
async function everyRedirect(ctx: PluginContext): Promise<StoredRedirect[]> {
  const found: StoredRedirect[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      redirectsSlug(ctx),
      {
        pagination: { limit: REDIRECT_PAGE, page },
        sort: { field: "id", direction: "asc" },
        depth: 0,
      }
    );
    const rows = data as unknown[];
    found.push(...rows.map(redirectOf));
    if (rows.length < REDIRECT_PAGE) return found;
  }
}

/** Whether an address is one exact address on this site, not a pattern or another site. */
const exactOnSite = (address: string) =>
  address.startsWith("/") && !address.endsWith("/*");

/**
 * Each redirect from an exact address whose To address another redirect
 * answers, asked by the same matching the Proxy follows. Saving a redirect
 * takes it to the end of its chain, so one arises where a pattern added
 * later covers an address a redirect already pointed at.
 */
async function redirectChains(ctx: PluginContext): Promise<RedirectChain[]> {
  const redirects = await everyRedirect(ctx);
  const byId = new Map(redirects.map(redirect => [redirect.id, redirect]));
  const chains: RedirectChain[] = [];
  for (const redirect of redirects) {
    if (!exactOnSite(redirect.source) || !exactOnSite(redirect.target)) {
      continue;
    }
    const path = pathOf(redirect.target);
    const id = await redirectMeeting(ctx, { locale: redirect.locale, path });
    const next = id === null || id === redirect.id ? undefined : byId.get(id);
    if (next === undefined) continue;
    chains.push({
      source: redirect.source,
      target: redirect.target,
      end: destinationOf(next, path),
    });
  }
  return chains;
}

/** The full check under way, which a second request waits on rather than repeats. */
let running: Promise<void> | undefined;

/** Check the whole site, once at a time. */
export function checkSite(
  ctx: PluginContext,
  checks: ProblemChecks
): Promise<void> {
  running ??= runSiteCheck(ctx, checks).finally(() => {
    running = undefined;
  });
  return running;
}

/** The work waiting or running for each page, one piece after another. */
const pageQueue = new Map<string, Promise<void>>();

/**
 * Run `work` for the page `type`/`id` once every piece of work already
 * queued for it has settled: a save's check and a deletion's cleanup never
 * overlap, so a check that read the page before it was deleted cannot write
 * its row back after the cleanup removed it. Started, not awaited, so a save
 * or a delete never waits on it; a failure is logged as `failed`, never
 * thrown into the write that is already done.
 */
function inTurn(
  ctx: PluginContext,
  type: string,
  id: string,
  failed: string,
  work: () => Promise<void>
): Promise<void> {
  const key = pageKey(type, id);
  const run = async () => {
    try {
      await work();
    } catch (error) {
      ctx.logger.error(failed, { error, collection: type, id });
    }
  };
  const next = (pageQueue.get(key) ?? Promise.resolve()).then(run);
  pageQueue.set(key, next);
  void next.finally(() => {
    if (pageQueue.get(key) === next) pageQueue.delete(key);
  });
  return next;
}

/** Check a page after it is saved, in its turn. */
export function recheckSaved(
  ctx: PluginContext,
  checks: ProblemChecks,
  type: string,
  id: string
): void {
  void inTurn(
    ctx,
    type,
    id,
    "The SEO plugin could not check a saved page",
    () => checkPage(ctx, checks, type, id)
  );
}

/**
 * Forget a deleted page in its turn, marking the full check out of date
 * first, as a check that removes a page does.
 */
export function forgetDeleted(
  ctx: PluginContext,
  type: string,
  id: string
): void {
  void inTurn(
    ctx,
    type,
    id,
    "The SEO plugin could not forget a deleted page",
    async () => {
      await markOutOfDate(ctx);
      await removePage(ctx, type, id);
    }
  );
}

/** A content type as code declares it, as far as the list reads it. */
function declared(
  ctx: PluginContext,
  slug: string
): { label?: string } | undefined {
  for (const collection of ctx.config.collections ?? []) {
    if (!isRecord(collection) || collection.slug !== slug) continue;
    const labels = isRecord(collection.labels) ? collection.labels : {};
    const label = textOf(labels.plural);
    return label === undefined ? {} : { label };
  }
  return undefined;
}

/** The problems that belong to the whole site, worked out now. */
async function siteProblems(
  ctx: PluginContext,
  checks: ProblemChecks,
  addresses: readonly string[]
): Promise<Problem[]> {
  const standing = addresses.length > 0 ? undefined : await readStanding(ctx);
  const targets = new Set(checks.targets);
  const without = (await typesWithoutAddress()).filter(
    type => type.kind === "collection" && targets.has(type.slug)
  );
  const types = await Promise.all(
    without.map(async ({ slug }) => {
      const code = declared(ctx, slug);
      return {
        key: slug,
        label: code?.label ?? slug,
        entries: await ctx.services.collections.count(slug, {}),
        inCode: code !== undefined,
      };
    })
  );
  return [
    ...productionAddressProblems(addresses, standing),
    ...noAddressProblems(types),
  ];
}

/**
 * Each problem once: one of the whole site, such as a missing site address
 * every page's check found, is listed a single time.
 */
function once(problems: readonly Problem[]): Problem[] {
  const seen = new Set<string>();
  return problems.filter(problem => {
    const key = JSON.stringify([problem.kind, problem.subject, problem.what]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The list's order: by kind, then by what each is about. */
function byKind(a: Problem, b: Problem): number {
  const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  return kind !== 0 ? kind : a.subject.label.localeCompare(b.subject.label);
}

/** A page, by its content type's key and its id. */
export interface PageRef {
  type: string;
  id: string;
}

/**
 * Which of `pages` the reader may read, as `type:id` keys: what the list
 * names of a page is shown only to someone who may read that page.
 */
export type ReadablePages = (
  pages: readonly PageRef[]
) => Promise<ReadonlySet<string>>;

/** A page's key in a {@link ReadablePages} answer. */
export const pageRefKey = (page: PageRef): string => `${page.type}:${page.id}`;

/** The page a problem is about, where it is about one. */
function pageOf(problem: Problem): PageRef | undefined {
  const { type, id } = problem.subject;
  return type === undefined || id === undefined ? undefined : { type, id };
}

/**
 * The list as the reader `readable` answers for may see it: every problem of
 * the whole site, and the problems of the pages they may read, with pages
 * compared only among those.
 */
export async function problemList(
  ctx: PluginContext,
  checks: ProblemChecks,
  readable: ReadablePages,
  now: number = Date.now()
): Promise<ProblemListBody> {
  const site = await readSiteCheck(ctx);
  const rows = await readPages(ctx);
  const allowed = await readable([
    ...rows.map(row => row.subject),
    ...site.problems.flatMap(problem => pageOf(problem) ?? []),
  ]);
  const pages = rows.filter(row => allowed.has(pageRefKey(row.subject)));
  const found = site.problems.filter(problem => {
    const page = pageOf(problem);
    return page === undefined || allowed.has(pageRefKey(page));
  });
  const rules = await checks.readers.readRules(ctx, undefined);
  const addresses = productionAddressesOf(rules.productionAddresses);
  const host =
    addresses[0] === undefined ? undefined : new URL(addresses[0]).host;
  const problems = once([
    ...(await siteProblems(ctx, checks, addresses)),
    ...found,
    ...pages.flatMap(row => row.problems),
    ...sharedValueProblems(pages),
  ]).sort(byKind);
  const checkedAt = site.checkedAt;
  const age = checkedAt === undefined ? Infinity : now - Date.parse(checkedAt);
  return {
    problems,
    ...(host === undefined ? {} : { site: host }),
    ...(checkedAt === undefined ? {} : { checkedAt }),
    pagesChecked: site.pagesChecked,
    outOfDate: site.outOfDate,
    due: !(age <= FULL_CHECK_MAX_AGE_MS),
  };
}
