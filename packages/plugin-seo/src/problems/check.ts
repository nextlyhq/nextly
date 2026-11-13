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
  publicAddressOf,
  typesWithoutAddress,
  type PageMetadataInput,
  type PageMetadataValues,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { addressHolders } from "../address-record/participant";
import { productionAddressesOf } from "../canonical";
import type { CodeRoute } from "../code-pages/routes";
import { readConnections } from "../connections/store";
import { refreshContentDates } from "../content-dates/record";
import { pruneContentDates } from "../content-dates/store";
import { pageLanguageLinks } from "../languages/head";
import {
  heldLanguages,
  singleIn,
  type HeldLanguages,
} from "../languages/versions";
import { originOf } from "../origin";
import {
  listPages,
  type ListedPage,
  type ListingProblem,
} from "../outputs/listing";
import { isRecord, textOf } from "../plain-values";
import { destinationOf, pathOf } from "../redirects/addresses";
import { redirectsSlug } from "../redirects/collection";
import { redirectMeeting } from "../redirects/meeting";
import { readProxyStatus } from "../redirects/proxy-seen";
import { redirectOf, type StoredRedirect } from "../redirects/store";
import { designLevelOf } from "../resolver/design-level";
import { addressOf } from "../resolver/page-levels";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import { readRouteValues, routeValuesKey } from "../route-values/store";
import {
  crawledPathOf,
  robotsBlockOf,
  servedGroups,
  type RobotsBlock,
} from "../settings/robots-blocks";
import { isSeoOff } from "../settings/seo-off";
import type { ReadSocialCardRules } from "../social/card";
import { shareImageProblems } from "../social/problems";
import { readStanding } from "../staging/guard";
import { structuredDataProblems } from "../structured-data/provider";
import type { ReadStructuredDataRules } from "../structured-data/rules";
import { SEO_GROUP, typedPageLevel } from "../tab/typed";

import { contentFacts } from "./content";
import {
  FULL_CHECK_MAX_AGE_MS,
  KIND_ORDER,
  type Problem,
  type ProblemListBody,
} from "./contract";
import { datesCheckScope, datesTodayProblems } from "./dates-check";
import { addressShapes, brokenLinks } from "./links";
import { canonicalIsOwn, pageProblems } from "./page-checks";
import { pageTypeOf, singleKey } from "./page-types";
import {
  connectionProblems,
  listingProblems,
  noAddressProblems,
  productionAddressProblems,
  proxyProblems,
  redirectChainProblems,
  sharedValueProblems,
  type ConnectionsReport,
  type RedirectChain,
} from "./site-checks";
import {
  markOutOfDate,
  pageKey,
  readPages,
  readVersions,
  readVersionsOf,
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
  /** The collections SEO is added to. */
  targets: readonly string[];
  /** The Singles SEO is added to. */
  singles: readonly string[];
  readers: CheckReaders;
  /**
   * Whether the plugin serves the site's robots.txt: where it does not, its
   * rules block nothing, and no page is said to be blocked by them.
   */
  servesRobots?: boolean;
  /**
   * Whether the site serves a robots.txt of its own, which wins over the
   * plugin's: then its rules block nothing either.
   */
  siteServesOwnRobots?: (
    rules: Awaited<ReturnType<ReadRules>>
  ) => Promise<boolean>;
  /**
   * The pages the site's routes render from their own code, which the
   * sitemap lists beside the entries, where the site has any.
   */
  codeRoutes?: () => readonly CodeRoute[];
  /**
   * What the sitemap lists, where the site serves one: its collections
   * where it names only some.
   */
  sitemap?: { collections?: readonly string[] };
}

/**
 * Whether the sitemap lists pages of `type`: none where no sitemap is
 * served, a Single's always, a collection's where the sitemap names none or
 * names it.
 */
function inSitemap(checks: ProblemChecks, type: string): boolean {
  const sitemap = checks.sitemap;
  if (sitemap === undefined) return false;
  if (sitemap.collections === undefined) return true;
  return (
    pageTypeOf(type).kind === "single" || sitemap.collections.includes(type)
  );
}

/**
 * The robots.txt rule keeping search engines from a page the sitemap lists,
 * as page facts, where one does: judged over the file the plugin serves,
 * so nothing where it serves none, the site serves its own, or the sitemap
 * leaves the page out.
 */
async function robotsBlockFor(
  checks: ProblemChecks,
  type: string,
  rules: Awaited<ReturnType<ReadRules>>,
  ownAddress: string
): Promise<{ robotsBlock?: RobotsBlock }> {
  if (checks.servesRobots === false || !inSitemap(checks, type)) return {};
  if ((await checks.siteServesOwnRobots?.(rules)) === true) return {};
  const robotsBlock = robotsBlockOf(
    servedGroups({
      aiCrawlers: rules.aiCrawlers ?? "all",
      ...(rules.robotsRules === undefined
        ? {}
        : { ownRules: rules.robotsRules.text }),
    }),
    crawledPathOf(ownAddress)
  );
  return robotsBlock === undefined ? {} : { robotsBlock };
}

/** Every type the checks read pages of, by its kept key. */
function checkedKeys(checks: ProblemChecks): string[] {
  return [...checks.targets, ...checks.singles.map(singleKey)];
}

/** The fields a page is named by in the list, in the order they are tried. */
const LABEL_FIELDS = ["title", "name", "heading", "slug"] as const;

/**
 * A page as the list names it: its title, or else what names it otherwise,
 * its id or a Single's own name.
 */
function labelOf(
  entry: Readonly<Record<string, unknown>>,
  otherwise: string
): string {
  for (const field of LABEL_FIELDS) {
    const value = textOf(entry[field]);
    if (value !== undefined) return value;
  }
  return otherwise;
}

/** A Single's name as code declares it, else its slug. */
function singleLabel(ctx: PluginContext, slug: string): string {
  for (const single of ctx.config.singles ?? []) {
    if (!isRecord(single) || single.slug !== slug) continue;
    const named = single.label;
    const label = isRecord(named) ? textOf(named.singular) : textOf(named);
    if (label !== undefined) return label;
  }
  return slug;
}

/**
 * The entries `ids` of `type` in `locale` (the default language where none),
 * read together as a route reads one: one level of links expanded, so a
 * media field reads as the media library's item. One missing is absent. A
 * Single's one document is read as it is published.
 */
async function readEntries(
  ctx: PluginContext,
  type: string,
  ids: readonly string[],
  locale: string | undefined
): Promise<Map<string, Readonly<Record<string, unknown>>>> {
  const pageType = pageTypeOf(type);
  if (pageType.kind === "single") {
    const document = await singleIn(pageType.slug, locale);
    const id = document === null ? undefined : String(document.id);
    return id !== undefined && document !== null && ids.includes(id)
      ? new Map([[id, document]])
      : new Map();
  }
  const { data } = await ctx.services.collections.listEntries(
    type,
    {
      where: { id: { in: [...ids] } },
      pagination: { limit: ids.length, page: 1 },
      depth: 1,
    },
    { as: "system", ...(locale === undefined ? {} : { locale }) }
  );
  const byId = new Map<string, Readonly<Record<string, unknown>>>();
  for (const entry of data as unknown[]) {
    if (isRecord(entry)) byId.set(String(entry.id), entry);
  }
  return byId;
}

/**
 * What checking a page reads before anything else: its rows as they stand,
 * the paths it holds in each language, its entry in each of those
 * languages, and what its route last supplied in code in each. Read for a
 * whole batch of pages at once by a full check.
 */
interface PageReads {
  defaultLanguage: string;
  before: PageRow[];
  held: HeldLanguages;
  entries: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  code: ReadonlyMap<string, PageMetadataValues>;
}

/** {@link PageReads} for each of `ids`, pages of `type`, read together. */
async function readBatch(
  ctx: PluginContext,
  type: string,
  ids: readonly string[]
): Promise<Map<string, PageReads>> {
  const defaultLanguage = await ctx.publicAddresses.defaultLanguage();
  const before = await readVersionsOf(ctx, type, ids);
  const held = await heldLanguages(ctx, type, ids);
  const languages = new Set<string>();
  for (const id of ids) {
    for (const language of held.get(id)?.keys() ?? []) languages.add(language);
    for (const row of before.get(id) ?? []) languages.add(row.locale);
  }
  const entries = new Map<
    string,
    Map<string, Readonly<Record<string, unknown>>>
  >();
  for (const language of languages) {
    const locale = language === defaultLanguage ? undefined : language;
    for (const [id, entry] of await readEntries(ctx, type, ids, locale)) {
      const byLanguage = entries.get(id) ?? new Map();
      byLanguage.set(language, entry);
      entries.set(id, byLanguage);
    }
  }
  // What each page's route supplied in each language, one read for them all.
  const pages = ids.flatMap(id =>
    [...languages].map(language => ({ type, id, language }))
  );
  const supplied = await readRouteValues(ctx, pages);
  const codeOf = (id: string) =>
    new Map(
      [...languages].flatMap(language => {
        const values = supplied.get(routeValuesKey({ type, id, language }));
        return values === undefined ? [] : [[language, values] as const];
      })
    );
  return new Map(
    ids.map(id => [
      id,
      {
        defaultLanguage,
        before: before.get(id) ?? [],
        held: held.get(id) ?? new Map(),
        entries: entries.get(id) ?? new Map(),
        code: codeOf(id),
      },
    ])
  );
}

/** One language of a page, and the paths the record says it holds there. */
interface Version {
  type: string;
  id: string;
  /** The language, as the record keeps it. */
  language: string;
  /** Read in no particular language: the site's default one. */
  locale: string | undefined;
  held: ReadonlySet<string>;
  /** What the page's route last supplied in code in this language. */
  code: PageMetadataValues;
}

/**
 * The address the version is served at, where it holds its own address in
 * its language: none for a draft there, which holds no address, for one
 * that lost its address to another page, and for a type with no address.
 */
async function servedAddress(
  ctx: PluginContext,
  version: Version,
  entry: Readonly<Record<string, unknown>>
): Promise<string | undefined> {
  const type = pageTypeOf(version.type);
  const own = await publicAddressOf(type, entry, version.locale);
  if (own.status !== "resolved" || !version.held.has(own.path)) {
    return undefined;
  }
  return (
    (await addressOf(
      ctx,
      { type, key: version.type },
      entry,
      version.locale,
      undefined
    )) ?? own.path
  );
}

/**
 * One language of a page as its head is asked for, from its entry and what
 * its route last supplied in code.
 */
async function inputOf(
  ctx: PluginContext,
  type: string,
  entry: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  code: PageMetadataValues
): Promise<PageMetadataInput> {
  const pageType = pageTypeOf(type);
  const source: PageMetadataInput["source"] =
    pageType.kind === "single"
      ? { kind: "single", slug: pageType.slug, document: entry }
      : { kind: "entry", collection: type, entry };
  return {
    source,
    code,
    // The design drawing the page, as its route would hand it, so a title
    // or description only the design sets is not listed as missing.
    derived: await designLevelOf(ctx, source, locale),
    ...(locale === undefined ? {} : { locale }),
  };
}

/** What names a page with no title: a Single's own name, else its id. */
function nameOf(ctx: PluginContext, type: string, id: string): string {
  const pageType = pageTypeOf(type);
  return pageType.kind === "single" ? singleLabel(ctx, pageType.slug) : id;
}

/** What the check of one language of a page found, before it is kept. */
async function examine(
  ctx: PluginContext,
  checks: ProblemChecks,
  version: Version,
  entry: Readonly<Record<string, unknown>> | undefined
): Promise<PageRow | undefined> {
  const { type, id, locale } = version;
  if (entry === undefined) return undefined;
  const ownAddress = await servedAddress(ctx, version, entry);
  if (ownAddress === undefined) return undefined;

  const { readers } = checks;
  const input = await inputOf(ctx, type, entry, locale, version.code);
  const answer = await resolveSeo(ctx, input, readers.readRules);
  const rules = await readers.readRules(ctx, locale);
  const productionAddresses = productionAddressesOf(rules.productionAddresses);
  const content = contentFacts(entry);
  const subject = {
    type,
    id,
    label: labelOf(entry, nameOf(ctx, type, id)),
    detail: ownAddress,
    ...(locale === undefined ? {} : { locale }),
  };
  const problems = pageProblems({
    subject,
    answer,
    ...(await robotsBlockFor(checks, type, rules, ownAddress)),
    canonicalIsOwn: canonicalIsOwn(
      answer,
      productionAddresses[0] ?? NO_ORIGIN,
      ownAddress
    ),
    // Read as the page's head reads what the person typed in its group.
    canonicalConfirmed:
      typedPageLevel(entry[SEO_GROUP]).canonicalElsewhere === true,
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
      // A language served on its own domain links from there.
      ...(originOf(ownAddress) === undefined
        ? {}
        : { origin: originOf(ownAddress) }),
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
    locale: version.language,
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
 * Check a page in every language it holds an address in, or was checked
 * in before, keep what was found, and forget a language it is no longer
 * public in. Where a change can alter another page's result, the full
 * check is marked out of date first, so whoever reads the new rows also
 * reads the mark. Reads what `reads` does not hand it, read for a batch.
 * Answers the keys of the rows it kept.
 */
async function checkPage(
  ctx: PluginContext,
  checks: ProblemChecks,
  type: string,
  id: string,
  reads?: PageReads,
  marks = true
): Promise<string[]> {
  const { defaultLanguage, before, held, entries, code } = reads ??
    (await readBatch(ctx, type, [id])).get(id) ?? {
      defaultLanguage: await ctx.publicAddresses.defaultLanguage(),
      before: [],
      held: new Map(),
      entries: new Map(),
      code: new Map(),
    };
  const languages = new Set([...held.keys(), ...before.map(row => row.locale)]);
  const found: { previous: PageRow | undefined; row: PageRow | undefined }[] =
    [];
  for (const language of languages) {
    const row = await examine(
      ctx,
      checks,
      {
        type,
        id,
        language,
        locale: language === defaultLanguage ? undefined : language,
        held: held.get(language) ?? new Set(),
        code: code.get(language) ?? {},
      },
      entries.get(language)
    );
    found.push({ previous: before.find(row => row.locale === language), row });
  }
  const changed = found.some(({ previous, row }) =>
    row === undefined ? previous !== undefined : altersOthers(previous, row)
  );
  if (changed && marks) await markOutOfDate(ctx);
  const kept: string[] = [];
  for (const { previous, row } of found) {
    if (row !== undefined) {
      await savePage(ctx, row);
      kept.push(pageKey(type, id, row.locale));
    } else if (previous !== undefined) {
      await removePage(ctx, previous);
    }
  }
  return kept;
}

/** `read`, answering each language once and keeping the answer. */
function onceForEach<T>(
  read: (ctx: PluginContext, locale: string | undefined) => Promise<T>
): (ctx: PluginContext, locale: string | undefined) => Promise<T> {
  const answers = new Map<string, Promise<T>>();
  return (ctx, locale) => {
    const key = locale ?? "";
    let answer = answers.get(key);
    if (answer === undefined) {
      answer = read(ctx, locale);
      answers.set(key, answer);
    }
    return answer;
  };
}

/** `readers`, each read once for each language. */
function readOnceEach(readers: CheckReaders): CheckReaders {
  return {
    readRules: onceForEach(readers.readRules),
    readStructuredDataRules: onceForEach(readers.readStructuredDataRules),
    readSocialCardRules: onceForEach(readers.readSocialCardRules),
  };
}

/** Pages read per step of a full check. */
const HELD_PAGE = 100;

/**
 * Check every page of the type kept as `slug` holding an address, keep each
 * result, and add each page's key to `seen`.
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
      type: pageTypeOf(slug),
      after,
      limit: HELD_PAGE,
    });
    const ids = page.items
      .filter(document => document.holds.length > 0)
      .map(document => document.holder.id);
    // What every page of the batch reads first, read together; each page's
    // writes still wait for its turn. A page saved since its batch was read
    // reads again then, so this never writes an older reading over a newer
    // check's.
    const writes = new Map(ids.map(id => [id, writesTo(slug, id)]));
    const batch = await readBatch(ctx, slug, ids);
    for (const id of ids) {
      await inTurn(slug, id, async () => {
        const current = writes.get(id) === writesTo(slug, id);
        for (const key of await checkPage(
          ctx,
          checks,
          slug,
          id,
          current ? batch.get(id) : undefined,
          // The full check's own findings mark nothing: it is the recheck.
          false
        )) {
          seen.add(key);
        }
      });
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
  siteChecks: ProblemChecks
): Promise<void> {
  const startedAt = new Date().toISOString();
  // The site's rules, read once for each language for the whole scan.
  const checks = { ...siteChecks, readers: readOnceEach(siteChecks.readers) };
  const seen = new Set<string>();
  // The site's types, by the key their pages are kept under.
  const siteTypes = new Set(
    (await ctx.publicAddresses.types()).map(type =>
      type.kind === "single" ? singleKey(type.slug) : type.slug
    )
  );
  const keys = checkedKeys(checks);
  for (const key of keys) {
    if (siteTypes.has(key)) await checkType(ctx, checks, key, seen);
  }
  // A page the walk did not reach may have been published after its type
  // was walked, its row written by its save's own check: it is checked
  // again in its turn, which keeps it while it is public and forgets it
  // where it is not.
  const checked = new Set(keys.filter(key => siteTypes.has(key)));
  for (const row of await readPages(ctx)) {
    const { type, id } = row.subject;
    if (seen.has(pageKey(type, id, row.locale))) continue;
    // A collection no longer checked, or no longer there: its rows go.
    if (!checked.has(type)) {
      await inTurn(type, id, () => removePage(ctx, row));
      continue;
    }
    await inTurn(type, id, async () => {
      for (const key of await checkPage(
        ctx,
        checks,
        type,
        id,
        undefined,
        false
      )) {
        seen.add(key);
      }
    });
  }
  // The content dates of pages no longer listed in a language go, so the
  // table holds rows only for pages the sitemap may still list.
  await pruneContentDates(ctx);
  // The listing of the types SEO is added to, read once for what it leaves
  // out, and its pages' content dates caught up where a publish reached no
  // save hook.
  const listing = await siteListing(ctx, checks, checks.targets);
  await refreshContentDates(ctx, listing.pages);
  await saveSiteCheck(ctx, {
    startedAt,
    checkedAt: new Date().toISOString(),
    // Each language of a page is a page to a search engine.
    pagesChecked: seen.size,
    problems: [
      ...(await leftOutOfListing(ctx, listing.problems)),
      ...(await sitemapDateProblems(ctx, checks)),
      ...redirectChainProblems(await redirectChains(ctx)),
    ],
  });
}

/** The origin pages are listed on where the site names none: only paths are kept. */
const NO_ORIGIN = "https://site.invalid";

/**
 * The site's listing of `collections` (every public type where none are
 * named), with the pages built in code, as the sitemap is made.
 */
async function siteListing(
  ctx: PluginContext,
  checks: ProblemChecks,
  collections: readonly string[] | undefined
): Promise<{ pages: ListedPage[]; problems: ListingProblem[] }> {
  const rules = await checks.readers.readRules(ctx, undefined);
  const origin =
    productionAddressesOf(rules.productionAddresses)[0] ?? NO_ORIGIN;
  return listPages(ctx, {
    origin,
    readRules: checks.readers.readRules,
    ...(collections === undefined ? {} : { collections }),
    ...(checks.codeRoutes === undefined
      ? {}
      : { codeRoutes: checks.codeRoutes }),
  });
}

/**
 * The dates problem of the addresses the sitemap itself lists, read after
 * the content dates are caught up; none where the site serves no sitemap.
 */
async function sitemapDateProblems(
  ctx: PluginContext,
  checks: ProblemChecks
): Promise<Problem[]> {
  const scope = datesCheckScope(checks);
  if (scope === undefined) return [];
  const { pages } = await siteListing(ctx, checks, scope.collections);
  return datesTodayProblems(
    ctx,
    pages.map(page => page.lastModified)
  );
}

/**
 * The pages the sitemap leaves out though their type declares them an
 * address, read by the same listing the sitemap is made from, and named as
 * their last check left them.
 */
async function leftOutOfListing(
  ctx: PluginContext,
  problems: readonly ListingProblem[]
): Promise<Problem[]> {
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
    // A redirect to an address that is gone is one hop, then 410: no chain.
    if (next === undefined || next.gone) continue;
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

/** How many saves and deletions of each page have been queued. */
const pageWrites = new Map<string, number>();

/** The count of queued saves and deletions of a page, to tell whether one came since. */
function writesTo(type: string, id: string): number {
  return pageWrites.get(`${type}\u0000${id}`) ?? 0;
}

/** Count a save or deletion of a page. */
function countWrite(type: string, id: string): void {
  const key = `${type}\u0000${id}`;
  pageWrites.set(key, (pageWrites.get(key) ?? 0) + 1);
}

/** The work waiting or running for each page, one piece after another. */
const pageQueue = new Map<string, Promise<void>>();

/**
 * Run `work` for the page `type`/`id` once every piece of work already
 * queued for it has settled: a save's check, a deletion's cleanup and a
 * full check's never overlap, so none writes over another's result. The
 * answer is the work's own: a failure rejects it, and the next piece in the
 * queue runs regardless.
 */
function inTurn(
  type: string,
  id: string,
  work: () => Promise<void>
): Promise<void> {
  const key = `${type}\u0000${id}`;
  const result = (pageQueue.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  pageQueue.set(key, settled);
  void settled.then(() => {
    if (pageQueue.get(key) === settled) pageQueue.delete(key);
  });
  return result;
}

/**
 * {@link inTurn}, started rather than awaited, for work after a save or a
 * delete: neither waits on it, and a failure is logged as `failed`, never
 * thrown into the write that is already done.
 */
function inTurnAfterWrite(
  ctx: PluginContext,
  type: string,
  id: string,
  failed: string,
  work: () => Promise<void>
): void {
  inTurn(type, id, work).catch((error: unknown) => {
    ctx.logger.error(failed, { error, collection: type, id });
  });
}

/** Check a page after it is saved, in its turn. */
export function recheckSaved(
  ctx: PluginContext,
  checks: ProblemChecks,
  type: string,
  id: string
): void {
  countWrite(type, id);
  inTurnAfterWrite(
    ctx,
    type,
    id,
    "The SEO plugin could not check a saved page",
    async () => {
      await checkPage(ctx, checks, type, id);
    }
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
  countWrite(type, id);
  inTurnAfterWrite(
    ctx,
    type,
    id,
    "The SEO plugin could not forget a deleted page",
    async () => {
      await markOutOfDate(ctx);
      for (const row of await readVersions(ctx, type, id)) {
        await removePage(ctx, row);
      }
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
  addresses: readonly string[],
  reader: Reader
): Promise<Problem[]> {
  const standing = addresses.length > 0 ? undefined : await readStanding(ctx);
  const targets = new Set(checks.targets);
  // A type is named, and its entries counted, only for a reader of it.
  const without = (await typesWithoutAddress()).filter(
    type =>
      type.kind === "collection" &&
      targets.has(type.slug) &&
      reader.readsType(type.slug)
  );
  const types = await Promise.all(
    without.map(async ({ slug }) => {
      const code = declared(ctx, slug);
      return {
        key: slug,
        label: code?.label ?? slug,
        entries: await reader.count(slug),
        inCode: code !== undefined,
      };
    })
  );
  return [
    ...productionAddressProblems(addresses, standing),
    ...noAddressProblems(types),
    // Redirects are site-wide SEO's: their count is told no one else.
    ...(reader.seesRedirects ? await unservedRedirects(ctx) : []),
    ...connectionProblems(await connectionsReport(ctx, checks)),
  ];
}

/**
 * The site's saved redirects going unserved for want of a running Proxy. A
 * status that cannot be read is reported as nothing, never as a failed list.
 */
async function unservedRedirects(ctx: PluginContext): Promise<Problem[]> {
  try {
    const status = await readProxyStatus(ctx);
    if (status.state === "running") return [];
    return proxyProblems(
      status,
      await ctx.services.ownCollections.count(redirectsSlug(ctx))
    );
  } catch (error) {
    ctx.logger.warn("Whether the Proxy runs could not be read", { error });
    return [];
  }
}

/**
 * What the optional connections last reported: IndexNow's last notice while
 * it is switched on, and Search Console's last failure. A connection that
 * cannot be read is reported as nothing, never as a failed list.
 */
async function connectionsReport(
  ctx: PluginContext,
  checks: ProblemChecks
): Promise<ConnectionsReport> {
  if (ctx.settings === undefined) return {};
  try {
    const [rules, stored] = await Promise.all([
      checks.readers.readRules(ctx, undefined),
      readConnections(ctx),
    ]);
    return {
      ...(rules.indexNow === true && stored.indexNowLast !== undefined
        ? { indexNow: stored.indexNowLast }
        : {}),
      ...(stored.searchConsoleFailed === undefined
        ? {}
        : { searchConsole: { message: stored.searchConsoleFailed.message } }),
    };
  } catch (error) {
    ctx.logger.warn("The optional connections could not be read", { error });
    return {};
  }
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
 * What the person reading the list may read: what the list names of a page
 * or a content type is shown only to someone who may read it.
 */
export interface Reader {
  /** Which of `pages` they may read, as `type:id` keys. */
  pages(pages: readonly PageRef[]): Promise<ReadonlySet<string>>;
  /** Whether they may read any entry of the content type `type`. */
  readsType(type: string): boolean;
  /** How many entries of `type` they may read. */
  count(type: string): Promise<number>;
  /**
   * Whether they may see the site's redirects, which only site-wide SEO
   * may: a problem naming a redirect is shown to no one else.
   */
  seesRedirects: boolean;
}

/** A page's key in a {@link Reader.pages} answer. */
export const pageRefKey = (page: PageRef): string => `${page.type}:${page.id}`;

/** The page a problem is about, where it is about one. */
function pageOf(problem: Problem): PageRef | undefined {
  const { type, id } = problem.subject;
  return type === undefined || id === undefined ? undefined : { type, id };
}

/**
 * The list as `reader` may see it: every problem of
 * the whole site, and the problems of the pages they may read, with pages
 * compared only among those.
 */
export async function problemList(
  ctx: PluginContext,
  checks: ProblemChecks,
  reader: Reader,
  now: number = Date.now()
): Promise<ProblemListBody> {
  const site = await readSiteCheck(ctx);
  const rules = await checks.readers.readRules(ctx, undefined);
  // A type whose SEO is switched off raises no problems. What was found for
  // its pages is kept, so switching it on again shows it at once.
  const on = (page: PageRef | undefined) =>
    page === undefined || !isSeoOff(rules, page.type);
  const rows = (await readPages(ctx)).filter(row => on(row.subject));
  const allowed = await reader.pages([
    ...rows.map(row => row.subject),
    ...site.problems.flatMap(problem => pageOf(problem) ?? []),
  ]);
  const pages = rows.filter(row => allowed.has(pageRefKey(row.subject)));
  const found = site.problems.filter(problem => {
    if (problem.kind === "redirectChain" && !reader.seesRedirects) {
      return false;
    }
    const page = pageOf(problem);
    return on(page) && (page === undefined || allowed.has(pageRefKey(page)));
  });
  const addresses = productionAddressesOf(rules.productionAddresses);
  const host =
    addresses[0] === undefined ? undefined : new URL(addresses[0]).host;
  const problems = once([
    // A type-level problem (a type with no address) names its type and no
    // page, and goes with the type's switch too.
    ...(await siteProblems(ctx, checks, addresses, reader)).filter(
      problem =>
        problem.subject.type === undefined ||
        !isSeoOff(rules, problem.subject.type)
    ),
    ...found,
    ...pages.flatMap(row => row.problems),
    ...sharedValueProblems(pages),
  ]).sort(byKind);
  const checkedAt = site.checkedAt;
  const age = checkedAt === undefined ? Infinity : now - Date.parse(checkedAt);
  const defaultLanguage = await ctx.publicAddresses.defaultLanguage();
  return {
    problems,
    // Each version of a page the reader may read that a check read, named
    // as its problems name it: a language only where not the default.
    checked: pages.map(({ subject, locale }) => ({
      type: subject.type,
      id: subject.id,
      ...(locale === defaultLanguage || locale === "" ? {} : { locale }),
    })),
    ...(host === undefined ? {} : { site: host }),
    ...(checkedAt === undefined ? {} : { checkedAt }),
    pagesChecked: site.pagesChecked,
    outOfDate: site.outOfDate,
    due: !(age <= FULL_CHECK_MAX_AGE_MS),
  };
}
