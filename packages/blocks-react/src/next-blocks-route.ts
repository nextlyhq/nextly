/**
 * The blocks page's route config, which every factory builds on: it reads
 * the entry's document and what it embeds under the page's budget, renders it
 * with its site styles and Layout regions, derives its metadata, and logs a
 * page's read overruns and the bindings it could not use. It also holds what
 * every route shares: the Cache Components check and how a miss is answered.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-blocks-route
 */
import { hashId, mayPaginateList } from "@nextlyhq/blocks-engine";
import {
  cacheComponentsEnabled,
  cachedFind,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
} from "nextly/runtime";
import type {
  ContentEntry,
  ContentRouteConfig,
  RenderContext,
} from "nextly/runtime";
import type { ReactElement } from "react";
import { createElement, Fragment } from "react";

import { listEntryCount, listPagesOf, listWillRead } from "./blocks/list-read";
import {
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
  isBindingIssue,
} from "./context";
import type {
  BindingIssuesHandler,
  PageIssue,
  PageContext,
  QueryBudget,
  ReadClaim,
} from "./context";
import { resolveLucideIcon } from "./icons/lucide";
import { drawnDocumentOf, fittedFor } from "./next-documents";
import {
  listPageSlug,
  linkLanguageOf,
  entryPathResolver,
} from "./next-entry-paths";
import { checkedLayoutsProvider } from "./next-layouts";
import {
  MEDIA_TAG_COLLECTION,
  inRequestLanguage,
  mediaResolver,
  type MediaReadCache,
} from "./next-media";
import { namedQueryHostFor, namedListPages } from "./next-named-queries";
import {
  type SiteStylesInput,
  isSiteStylesProvider,
  type SiteStylesProvider,
  type BlocksPageConfig,
  type DerivedPageSeo,
} from "./next-page-config";
import {
  warnOfUnknownTimeZone,
  readTermsOf,
  routeReadSources,
  listBatchReads,
} from "./next-read-sources";
import { readerFor, dataFor } from "./next-readers";
import { metadataValuesOf, derivePageSeo } from "./next-seo";
import {
  effectiveLimits,
  listDayInputs,
  pagedListOf,
  readPageInputs,
  readPageStages,
  stagedContext,
  drawWithRegions,
  type EntrySource,
  type PageRendererElementProps,
  type SharedRendererProps,
} from "./page-read-stages";
import { PageRenderer } from "./page-renderer";
import { pageBindingRun } from "./prepare-document";
import { registeredBlocks } from "./resolver";

/**
 * Keys the CMS sets on the row it returns.
 *
 * Read rather than asked of the caller: both are decided by the read that
 * produced the entry, so requiring a route to restate them is requiring it to
 * guess at something it was already told.
 */
const WORKING_DRAFT_KEY = "_isWorkingDraft";

/**
 * The page's overrun, said in the server log: the page, its cap, how many
 * reads it was refused and which blocks were drawn as if their data were
 * missing, by id. Never a value.
 *
 * Once per render, when its refusals first go quiet: they come as the page
 * streams, block by block, so the line waits for a short quiet rather than
 * for a render end it cannot see; reads refused after it are not added. And
 * at most once per page, language and page of its list per process in
 * {@link OVERRUN_INTERVAL_MS}, so a
 * page over its cap that is rendered on every visit says so once in a while,
 * not on every visit.
 */
function overrunLog(
  context: RenderContext,
  /** Which page of its list the render draws, once that is known. */
  listPage: () => number | undefined,
  /** The route's cache scope: two sites served by one process count apart. */
  cacheScope: string | undefined
): {
  refused(budget: QueryBudget): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let said = false;
  return {
    refused: budget => {
      if (said) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        said = true;
        const report = budget.report?.();
        // Each scope, language and page of a list said apart: they read apart.
        const page = [
          cacheScope ?? "",
          context.collection,
          context.slug,
          context.locale ?? "",
          String(listPage() ?? 1),
        ].join("\u0000");
        if (report === undefined || !overrunMayBeSaid(page, Date.now())) {
          return;
        }
        // Each block once, whatever it missed.
        const ids = [...new Set(report.unread.map(block => block.nodeId))];
        const blocks =
          ids.length === 0
            ? "no block could be named"
            : `${String(ids.length)} block(s) drawn as if their data were missing: ${ids.join(", ")}`;
        console.warn(
          `[blocks] "${context.collection}" page "${context.slug}" needed more than its ${String(report.cap)} reads: at least ${String(report.refused)} read(s) refused; ${blocks}.`
        );
      }, OVERRUN_QUIET_MS);
      // Never what keeps a process alive.
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    },
  };
}

/** How long a page's refusals must go quiet before its overrun is logged. */
const OVERRUN_QUIET_MS = 50;

/** How long one page's overrun stays said, per process: ten minutes. */
const OVERRUN_INTERVAL_MS = 10 * 60 * 1000;

/** How many pages' last overrun line a process remembers, oldest dropped. */
const OVERRUN_PAGES_KEPT = 1000;

/** When each page's overrun was last said in this process, oldest first. */
const overrunSaid = new Map<string, number>();

/**
 * Whether a page's overrun may be said now, recording it when it may: not
 * within {@link OVERRUN_INTERVAL_MS} of the last time. The record is bounded,
 * so a site of many pages over their caps cannot grow it without end; a page
 * dropped from it may be said again early, which is the safe direction.
 */
function overrunMayBeSaid(page: string, now: number): boolean {
  const last = overrunSaid.get(page);
  if (last !== undefined && now - last < OVERRUN_INTERVAL_MS) return false;
  // Moved to the end, so the oldest page is the first one dropped.
  overrunSaid.delete(page);
  overrunSaid.set(page, now);
  if (overrunSaid.size > OVERRUN_PAGES_KEPT) {
    const oldest = overrunSaid.keys().next().value;
    if (oldest !== undefined) overrunSaid.delete(oldest);
  }
  return true;
}

/**
 * How a route reports the bindings a render could not use: one warning per
 * report, naming the page and counting each problem, never a value.
 */
function bindingIssueLog(context: RenderContext): BindingIssuesHandler {
  return (issues: readonly PageIssue[]) => {
    const page = `on "${context.collection}" page "${context.slug}"`;
    const bindings = issues.filter(isBindingIssue);
    const conditionIssues = issues.filter(issue => !isBindingIssue(issue));
    // Blocks, not issues: one block can hold several conditions it can't use.
    const conditions = new Set(conditionIssues.map(issue => issue.nodeId)).size;
    if (bindings.length > 0) {
      console.warn(
        `[blocks] ${String(bindings.length)} binding(s) ${page} ` +
          `could not be used as stored and show a fallback or the prop's own value: ${codeSummary(bindings)}.`
      );
    }
    if (conditions > 0) {
      console.warn(
        `[blocks] ${String(conditions)} block(s) ${page} ` +
          `have visibility conditions that could not be checked, so they are left out: ${codeSummary(conditionIssues)}.`
      );
    }
  };
}

/** Each code in a report, with how many times it appears; never a value. */
function codeSummary(issues: readonly PageIssue[]): string {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, count]) => `${code} x${String(count)}`)
    .join(", ");
}

/**
 * The site style inputs the config states, for one render.
 *
 * Resolved per render when the config states a provider, so style inputs
 * living in storage reach the next page view rather than the next deploy; a
 * plain value passes through unchanged. A public route caches the provider's
 * read, tagged with the Singles it names, as it caches its other reads: the
 * page is prerendered, and under Cache Components a prerender refuses a read
 * outside the cache that takes the current time, as a Single's read does.
 */
async function configuredSiteStylesFor(
  config: BlocksPageConfig,
  isPublic: boolean,
  window: number | false | undefined
): Promise<SiteStylesInput | undefined> {
  const provider = config.siteStyles;
  if (!isSiteStylesProvider(provider)) return provider;
  if (!isPublic) return await provider.read();
  // `null` stands for "none" inside the cache, which keeps values as JSON.
  const read = await cachedFind(async () => (await provider.read()) ?? null, {
    tags: provider.singles.flatMap(slug => nextlySingleTags(slug)),
    keyParts: siteStylesKey(config, provider),
    revalidate: await releaseBoundedRevalidate(window),
  });
  return read ?? undefined;
}

/**
 * What names a public route's cached site style read: the route, by its scope
 * and the content it serves, and the provider, by the Singles it declares and
 * the source text of its `read`. Every part is the same on every server
 * instance of one build, which a function's identity is not, and two
 * providers that read differently differ in at least one part, unless one
 * function made both over different inputs; such routes over the same
 * content set their own `cacheScope`.
 */
function siteStylesKey(
  config: BlocksPageConfig,
  provider: SiteStylesProvider
): string[] {
  return [
    "nextly-public-site-styles",
    config.cacheScope ?? "",
    JSON.stringify([config.collections, config.field]),
    JSON.stringify([...provider.singles].sort()),
    hashId(String(provider.read)),
  ];
}

export function blocksRouteConfig(
  config: BlocksPageConfig,
  isPublic: boolean,
  /**
   * How long the page's list reads may live: the route's own `revalidate`.
   * Its own argument because a Single's config withholds `revalidate` from
   * the page config it borrows, and its lists must not outlive it either.
   */
  listWindow: number | false | undefined = config.revalidate,
  /** A Single's page reads its entry as a Single, not from a collection. */
  entrySource: EntrySource = "collection"
): ContentRouteConfig<ReactElement> {
  const {
    field,
    blocks,
    styles,
    styleContext,
    data,
    blockFallback,
    limits,
    metadata,
    // Consumed by the resolvers built below rather than forwarded: passing them
    // on would hand `createContentRoute` options it does not define.
    mediaCollection: _mediaCollection,
    resolveMedia: _resolveMedia,
    resolveEntryPath: _resolveEntryPath,
    layouts: _layouts,
    timeZone: _timeZone,
    notFound,
    ...routeConfig
  } = config;
  const missHandler = perRequestNotFound(notFound, isPublic);
  if (data !== undefined && typeof data !== "function") {
    throw new Error(
      "createBlocksPage: `data` takes a function from the route's public reader " +
        "to a provider, such as `reader => createDefaultDataProvider(reader)`, " +
        "not a provider: a page's lists read only through that reader."
    );
  }
  // Checked when the route is built, not when the first page is requested: a
  // provider of the wrong shape would otherwise surface as stale regions on a
  // cached page, long after the deploy that introduced it.
  const layoutsProvider = checkedLayoutsProvider(config.layouts);
  // One resolver object for the route, handed to both the preparation and the
  // renderer: the renderer reuses a preparation only for the very resolver it
  // was made with.
  const resolver = blocks ?? registeredBlocks();
  warnOfUnknownTimeZone(config.timeZone);
  // A public route reads its images inside the cache, as it reads the rest of
  // the page, within the page's own window; an access-enforced one reads them
  // per request, as it reads the rest.
  const mediaCache: MediaReadCache | undefined = isPublic
    ? { window: listWindow }
    : undefined;

  // One page's derivation, shared by `buildMetadata` and `derivedMetadata`:
  // the content route asks both of the same entry and context, and the walk
  // spends reads, so it runs once for the pair.
  const derivations = new WeakMap<
    ContentEntry,
    WeakMap<RenderContext, Promise<DerivedPageSeo>>
  >();
  const derivedOf = (
    entry: ContentEntry,
    context: RenderContext
  ): Promise<DerivedPageSeo> => {
    let byContext = derivations.get(entry);
    if (byContext === undefined) {
      byContext = new WeakMap();
      derivations.set(entry, byContext);
    }
    let derivation = byContext.get(context);
    if (derivation === undefined) {
      derivation = derivePageSeoOf(entry, context);
      byContext.set(context, derivation);
    }
    return derivation;
  };
  /** What the page's blocks say about it, for its head. */
  async function derivePageSeoOf(
    entry: ContentEntry,
    context: RenderContext
  ): Promise<DerivedPageSeo> {
    // The page as it is drawn, so its title, description and image
    // come from the entry's own content where a template draws it.
    const document = drawnDocumentOf(entry, field, context, config);
    // Its own budget: metadata generation and the render are separate
    // invocations, so sharing one counter would let the page's reads
    // starve the preview image, or the reverse. Shared BETWEEN the two
    // reads this invocation makes, because they are one page's cost.
    const budget = createQueryBudget(config.maxQueries ?? DEFAULT_MAX_QUERIES);
    // The same reads, in the same order, as the render: the
    // components the page inlines (without them every instance would
    // be a placeholder, and a page built from components would publish
    // a title its HTML contradicts), the Layout's regions, then what
    // the bindings read. The same order spends the budget alike, so a
    // bound title cannot differ between the page and its metadata.
    const inputs = await readPageInputs({
      terms: readTermsOf(config, resolver),
      sources: routeReadSources({
        config,
        entry,
        context,
        entrySource,
        layoutsProvider,
        window: listWindow,
        budget,
      }),
      document,
      // Fitted to the components it places, as the render is.
      fit: fittedFor(entry, field, context, config),
      entrySource,
      onIssues: bindingIssueLog(context),
      regionsOnlyWhenBound: true,
    });
    const derived = await derivePageSeo(
      inputs.document,
      resolver,
      mediaResolver(
        inRequestLanguage(config, context),
        readerFor(config),
        budget,
        mediaCache
      ).resolve,
      // A later page of the page's list is its own address, so its
      // canonical names it rather than the list's first page.
      listPageSlug(context.slug, context.page),
      limits,
      styleContext,
      config.hostPolicy?.remotePatterns,
      inputs.definitions,
      inputs.bindings,
      context.locale,
      inputs.page.prepared ?? undefined,
      bindingIssueLog(context)
    );
    return derived;
  }

  return {
    ...routeConfig,
    ...(missHandler === undefined ? {} : { notFound: missHandler }),
    // The page is tagged for the records its BLOCKS read, not only for the
    // collection it was resolved from. The media and entry-path resolvers read
    // through plain `findByID`, which contributes no tag, so without this a
    // page cached under `overrideAccess` kept a stale image URL or alt text
    // until something else invalidated it. A site whose blocks reference OTHER
    // collections adds those tags itself through `tags`, which is why these are
    // merged rather than replacing what the caller passed.
    tags: [
      ...(routeConfig.tags ?? []),
      ...nextlyTags(config.mediaCollection ?? MEDIA_TAG_COLLECTION),
      ...routeConfig.collections.flatMap(collection => nextlyTags(collection)),
      // The singles a `siteStyles` provider reads, for the same reason the
      // media collection is above: that read goes through the Direct API and
      // contributes no tag of its own, so a write to the single would otherwise
      // invalidate nothing this page carries.
      ...(isSiteStylesProvider(config.siteStyles)
        ? config.siteStyles.singles
        : []
      ).flatMap(slug => nextlySingleTags(slug)),
    ],
    // Supplied only when asked for, so a route without it keeps whatever
    // `buildMetadata` the caller passed straight through to the content route.
    ...(metadata
      ? {
          buildMetadata: async (entry, context) =>
            metadata(entry, context, await derivedOf(entry, context)),
        }
      : {}),
    // What the blocks offer for the head, for a plugin that provides page
    // metadata. The content route asks only where one is started, so a site
    // without one reads nothing more for it.
    derivedMetadata: async (entry, context) =>
      metadataValuesOf(await derivedOf(entry, context)),
    // The route serves the pages of the one list a page splits into pages,
    // counted as the list itself reads: the same provider, language and
    // terms for comparing days, so the route never serves a page the list's
    // own links do not name, nor refuses one they do.
    listPages: async (entry, context) => {
      // The page as it is drawn: a list split into pages inside the entry's
      // own content, which a template draws, is the page's list.
      const document = drawnDocumentOf(entry, field, context, config);
      // Nothing is read for a page whose drawn document neither splits a
      // list into pages nor binds a list's split: composing it with its
      // components cannot add one its own nodes do not hold.
      if (
        mayPaginateList(document.nodes, effectiveLimits(config).maxNodes) ===
        undefined
      ) {
        return null;
      }
      // Counted under the page's read allowance, spent in the render's own
      // order up to the list: the page's inputs (its components, its Layout's
      // regions, what its bindings read), then the terms its lists compare
      // days by, then the list's own read. A page whose allowance runs out
      // before the list (`maxQueries: 0`, or spent on those reads) has no
      // later pages, since its list draws none.
      const budget = createQueryBudget(
        config.maxQueries ?? DEFAULT_MAX_QUERIES
      );
      const terms = readTermsOf(config, resolver);
      const sources = routeReadSources({
        config,
        entry,
        context,
        entrySource,
        layoutsProvider,
        window: listWindow,
        budget,
      });
      const inputs = await readPageInputs({
        terms,
        sources,
        document,
        // Fitted to the components it places, as the render is.
        fit: fittedFor(entry, field, context, config),
        entrySource,
        onIssues: bindingIssueLog(context),
      });
      const { page, bindings, presented } = inputs;
      // The list as the render draws it: composed with its components'
      // definitions, repaired and held to the caps.
      const list = pagedListOf(
        inputs.document,
        page,
        effectiveLimits(config).maxNodes,
        bindings === undefined
          ? undefined
          : pageBindingRun(bindings, context.locale, resolver)
      );
      if (list === undefined) return null;
      // A list that makes no read shows one page, and claims nothing.
      if (!listWillRead(list.props)) return 1;
      const days = await listDayInputs({
        terms,
        sources,
        documents: presented,
        bindings,
        where: context,
      });
      // A custom source counts its pages from its run's total, as the
      // render runs it. Its reads claim from the allowance as they are
      // made, so nothing is claimed ahead of the run.
      const namedPages = await namedListPages(
        list,
        namedQueryHostFor({
          config,
          locale: context.locale,
          window: listWindow,
          budget,
          context,
        }),
        budget,
        context.locale
      );
      if (namedPages !== undefined) return namedPages;
      // The list's first read, claimed where the render claims it: after
      // the page's inputs and day terms, before any block is drawn.
      const claim: ReadClaim = { kind: "entries", nodeId: list.id };
      if (!budget.take(claim)) return 1;
      const counted = await listEntryCount(
        list.props,
        { locale: context.locale, ...days },
        dataFor(data, config, context.locale, listWindow),
        () => budget.take(claim)
      ).catch(() => undefined);
      // A list whose read cannot say how many entries it matches shows its
      // first page alone, as a list that fails to read shows its empty state.
      return counted === undefined
        ? 1
        : listPagesOf(list.props, counted.matching);
    },
    render: async (entry, context) => {
      // The page as it is drawn: a template's with the entry's own blocks
      // content composed in (`drawnDocumentOf`), fitted below to the
      // components it places once their definitions are read.
      const drawnFirst = drawnDocumentOf(entry, field, context, config);
      const resolved = styles ? await styles(entry, context) : undefined;

      // Built from the reader the ROUTE resolved this entry through, handed
      // over in the context. A page and the records it embeds then always come
      // from one instance, which on a per-tenant setup is one database.
      // Created before the resolvers, because they claim from it too: a loop
      // over N entries whose template holds one link performs about 3N reads
      // through `resolveEntryPath`, which is exactly the amplification this
      // bounds — and a budget only the loop claimed from would have counted the
      // one read that multiplies while ignoring the ones it multiplies INTO.
      // It says when it is outrun, so the page's overrun is logged once,
      // naming the page, the cap and the blocks drawn without their data.
      // Which page of its list this render draws is known only once the
      // list's first read is claimed, below.
      const drawnPage: { number?: number | undefined } = {};
      const overrun = overrunLog(
        context,
        () => drawnPage.number,
        config.cacheScope
      );
      const budget = createQueryBudget(
        config.maxQueries ?? DEFAULT_MAX_QUERIES,
        { onRefused: () => overrun.refused(budget) }
      );
      const media = mediaResolver(
        inRequestLanguage(config, context),
        readerFor(config),
        budget,
        mediaCache
      );
      // The one provider this render's lists read through: their entries,
      // and what they read ahead for them.
      const listData = dataFor(data, config, context.locale, listWindow);
      const entryPaths = entryPathResolver(
        config,
        isPublic,
        readerFor(config),
        budget,
        // Links are formed in the language the page is drawn in.
        linkLanguageOf(config.locale, context.locale)
      );

      // `isWorkingDraft` is surfaced, not acted on: the renderer draws the
      // pending content either way, and a host that wants to say so on the page
      // has to be told which one it got.
      const pageContext: PageContext = createStandaloneContext({
        entry,
        // So a list of the entry's related entries reads the relation as the
        // public reads this entry. A Single's page has no collection entry,
        // and the provider reads no Single.
        ...(entrySource === "collection"
          ? { entryCollection: context.collection }
          : {}),
        // Reported by the route, not read off the row: the companion overlay
        // copies localized values onto the entry without stamping which locale
        // produced them, so inferring it here finds nothing on exactly the
        // localized pages that need it.
        locale: context.locale,
        isWorkingDraft: entry[WORKING_DRAFT_KEY] === true,
        // A working draft is served only to an author previewing it, so a
        // list there tells that author what it could not read as stored. A
        // published page never does.
        diagnostics: entry[WORKING_DRAFT_KEY] === true,
        data: listData,
        // Fresh for THIS render. `core/collection-loop` claims from it before
        // each read, and an absent budget reads as unlimited — the loop's own
        // check is `ctx.queries?.take() === false` — so a routed page without
        // one is unbounded by construction.
        queries: budget,
        resolveMedia: media.resolve,
        resolveEntryPath: entryPaths.resolve,
        // The published page draws the Lucide set, vendored with this package.
        resolveIcon: resolveLucideIcon,
        // A list whose source is a named query runs it as a visitor reads.
        namedQueries: namedQueryHostFor({
          config,
          locale: context.locale,
          window: listWindow,
          budget,
          context,
        }),
        // The page of its list this address draws, and where the others are.
      });

      const configuredSiteStyles = await configuredSiteStylesFor(
        config,
        isPublic,
        listWindow
      );
      // Derived ONCE, from the breakpoints the site already stated. A second
      // answer to "what are this site's breakpoints" is how the shared sheet
      // and the page sheet come to disagree about which at-rules a tier is
      // emitted under — and the disagreement is invisible, because each sheet
      // is internally consistent.
      const siteBreakpoints =
        configuredSiteStyles?.breakpoints ?? styleContext?.breakpoints;
      // A route emits the site sheet by DEFAULT: without it every `{ $token }`
      // resolves to nothing, which is the defect this closes. It needs a
      // breakpoint set to compile the block-default tier under, so a route that
      // states neither its own nor a style context gets no sheet rather than one
      // compiled against breakpoints nobody chose.
      const siteStyles =
        siteBreakpoints === undefined
          ? undefined
          : { ...configuredSiteStyles, breakpoints: siteBreakpoints };

      // Everything the page reads before it draws, in the route's order, by
      // the stages the editor's count runs too: the components it places,
      // its Layout's regions, what its bindings and conditions read, the
      // terms its lists compare days by (the site's zone and the public's
      // field shapes, read only when a list on the page compares days), then
      // the paginated list's first read, claimed before any block is drawn,
      // which is the order the route counted its pages in. Only where the
      // route serves later pages (a Single's gives no addresses, so its list
      // shows one page and claims its own read); a list whose read cannot be
      // claimed draws no links, as the route serves none of its later pages.
      const terms = readTermsOf(config, resolver);
      const staged = await readPageStages({
        terms,
        sources: routeReadSources({
          config,
          entry,
          context,
          entrySource,
          layoutsProvider,
          window: listWindow,
          budget,
        }),
        document: drawnFirst,
        // Fitted to the components it places: the entry's content is cut to
        // the room their expansion leaves, so every placement resolves.
        fit: fittedFor(entry, field, context, config),
        entrySource,
        where: context,
        budget,
        onIssues: bindingIssueLog(context),
      });
      const {
        document,
        definitions,
        page,
        regions,
        regionDefinitions,
        bindings,
      } = staged;
      drawnPage.number = staged.listPage?.page;
      // What a list reads ahead for its entries, through the page's own
      // reads: relations as the public reads them, links as the blocks drawn
      // inside the entries would read them one by one.
      const listReads = listBatchReads({
        data: listData,
        shapes: bindings?.fieldShapes,
        budget,
        entryPaths,
        media,
      });
      // What every document drawn on this page shares: the context (so the
      // regions spend the page's ONE budget and read in its locale), the
      // blocks, the caps, the host's posture and the page's bindings.
      const shared: SharedRendererProps = {
        context: stagedContext(pageContext, staged, terms, listReads),
        blocks: resolver,
        styleContext,
        blockFallback,
        limits,
        // Spread conditionally: `PageRenderer` distinguishes an absent policy
        // from one present and undefined, and passing the second would state a
        // posture the site never chose.
        ...(config.hostPolicy === undefined
          ? {}
          : { hostPolicy: config.hostPolicy }),
        ...(bindings === undefined
          ? {}
          : { bindings, onBindingIssues: bindingIssueLog(context) }),
      };
      const pageProps: PageRendererElementProps = {
        ...shared,
        document,
        styles: resolved,
        // Spread conditionally: a page holding no instance resolves to an
        // empty map, and handing `PageRenderer` an empty map rather than
        // nothing states that definitions WERE fetched and none was found —
        // which is the honest answer for a page that references none, and the
        // wrong one for a caller that never asked.
        ...(definitions.size === 0 ? {} : { definitions }),
        // Prepared once above, for the reads; the renderer reuses it.
        ...(page.prepared === null ? {} : { prepared: page.prepared }),
      };

      // The structured data the route worked out for this page, from the
      // same answer as its head, placed with the page it describes.
      if (regions.length === 0) {
        return withStructuredData(
          createElement(PageRenderer, {
            ...pageProps,
            ...(siteStyles === undefined ? {} : { siteStyles }),
          }),
          context.structuredData
        );
      }
      return withStructuredData(
        createElement(
          Fragment,
          null,
          ...drawWithRegions({
            regions,
            page: pageProps,
            shared,
            siteStyles,
            definitions: regionDefinitions,
          })
        ),
        context.structuredData
      );
    },
  };
}

/**
 * Whether this app builds with Cache Components on.
 *
 * Read here, in code the app bundles, because Next.js inlines
 * `process.env.__NEXT_CACHE_COMPONENTS` only into that; nextly, loaded as a
 * server external, cannot see it. The value is a build-time constant, so the
 * factories decide once, when they build a route.
 */
export function underCacheComponents(): boolean {
  return cacheComponentsEnabled(process.env.__NEXT_CACHE_COMPONENTS);
}

/**
 * The site's `notFound` for a route, where the route answers its misses per
 * request: always for an access-enforced route, and for a public one only
 * under Cache Components. Without them a public route renders a path once
 * (at build, or on its first request) and keeps the answer, and Next.js
 * refuses a render it keeps that reads the request, so the handler, which
 * may read it, is left out there and the miss is answered by `notFound()`.
 */
export function perRequestNotFound<H>(
  handler: H | undefined,
  isPublic: boolean
): H | undefined {
  return isPublic && !underCacheComponents() ? undefined : handler;
}

/**
 * The page with its structured data placed before it, as the body of one
 * JSON-LD script element, so it is in the HTML a crawler receives; the page
 * as it is where the route handed none.
 *
 * The text is placed exactly as handed: the content and Single routes write
 * it so that no value can end its element, and a second escaping here would
 * change what it says.
 */
function withStructuredData(
  page: ReactElement,
  structuredData: string | undefined
): ReactElement {
  if (structuredData === undefined || structuredData === "") return page;
  return createElement(
    Fragment,
    null,
    createElement("script", {
      type: "application/ld+json",
      dangerouslySetInnerHTML: { __html: structuredData },
    }),
    page
  );
}
