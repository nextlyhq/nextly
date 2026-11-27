/**
 * The site's optional outputs for AI tools, both off until switched on in the
 * SEO settings: `/llms.txt`, a plain list of the site's pages, and a
 * plain-text copy of each listed page beside it.
 *
 * Both list exactly the pages the sitemap lists, read from the one listing,
 * and both answer every reader alike: no reader is told apart by who it is.
 * A copy is answered at its own address, and at the page's own address only
 * to a request that asks for Markdown over HTML in its `Accept` header; that
 * answer is never kept by a shared cache, so a browser is always served the
 * page.
 *
 * @module outputs/ai-outputs
 */
import {
  addressOfRequest,
  getCachedNextly,
  languageAddressOf,
  NextlyError,
  publicAddressOf,
  type PageMetadataValues,
  type PluginContext,
  type PublicAddressType,
  type PluginProxyHandler,
  type ProxyAnswer,
} from "@nextlyhq/plugin-sdk";

import {
  addressRecordReady,
  addressRecordReadyWithin,
} from "../address-record/catch-up";
import {
  addressHolders,
  withAddressHolders,
} from "../address-record/participant";
import { singleDeclaration } from "../bulk/singles";
import { codePages } from "../code-pages/answers";
import { codePagesSlug } from "../code-pages/collection";
import type { CodeRoute, ReadCodeRoutes } from "../code-pages/routes";
import type { StatedMarkdown } from "../code-pages/stated";
import { codePageDocument } from "../code-pages/store";
import { onceEach, resolveIn, servedAt } from "../languages/versions";
import { originOf } from "../origin";
import { isRecord, textOf } from "../plain-values";
import { NOT_NOTED, type ProxySeenNotes } from "../redirects/proxy-seen";
import {
  ownTitleIn,
  pageNameOf,
  titleSourcesOf,
  type TitleFields,
} from "../resolver/own-name";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import {
  readRouteValues,
  routeValuesKey,
  type RouteValuesPage,
} from "../route-values/store";

import { noteCopyResults, type CopyFailure } from "./copy-failures";
import { listedPageAt, listPages, type ListedPage } from "./listing";
import {
  llmsFullTxt,
  llmsTxt,
  type LlmsEntry,
  type LlmsFullPage,
} from "./llms-txt";
import {
  copyAddressOf,
  copyPathsOf,
  descriptionCopyOf,
  pagesOfCopy,
  plainCopyOf,
  relatedDocumentsIn,
  relatedKey,
  withFrontMatter,
  type CopyAbout,
  type CopyField,
  type RelatedPage,
  type RelatedPages,
} from "./plain-copy";
import {
  renderedCopyAt,
  RENDERING_HEADER,
  type RenderedPage,
} from "./rendered-fetch";
import { siteOriginFor } from "./site-origin";

/** What the AI outputs read: the site's rules, and what the sitemap lists. */
export interface AiOutputsConfig {
  readRules: ReadRules;
  /** The site's configured origin, where its settings name no address. */
  origin?: string;
  /** The pages built in code the sitemap lists, where any are known. */
  codeRoutes?: ReadCodeRoutes;
  /**
   * The pages built in code the build's own files name, read with nothing
   * started: what the Proxy claims a request by before it can read more.
   */
  builtRoutes?: () => readonly CodeRoute[];
  /**
   * The Markdown source the site states for the page built in code at a
   * path, which its copy is made of rather than the rendered page.
   */
  codeMarkdown?: (path: string) => StatedMarkdown | undefined;
  /** The collections the sitemap is narrowed to, where it is. */
  collections?: readonly string[];
}

/** The heading a page of a Single is listed under in llms.txt. */
const SINGLES_SECTION = "Pages";

/** A collection's plural label, as the admin's lists use it. */
async function collectionLabel(
  ctx: PluginContext,
  slug: string
): Promise<string> {
  const meta: unknown = await ctx.services.collections.getCollection(slug, {});
  const record = isRecord(meta) ? meta : {};
  const labels = isRecord(record.labels) ? record.labels : {};
  return (
    textOf(labels.plural) ??
    textOf(labels.singular) ??
    textOf(record.label) ??
    slug
  );
}

/** The heading each listed page goes under, its type's label read once. */
async function sectionsOf(
  ctx: PluginContext,
  pages: readonly ListedPage[]
): Promise<Map<string, string>> {
  const sections = new Map<string, string>();
  for (const { holder } of pages) {
    if (sections.has(holder.collection)) continue;
    sections.set(
      holder.collection,
      holder.collection.startsWith("single:")
        ? SINGLES_SECTION
        : await collectionLabel(ctx, holder.collection)
    );
  }
  return sections;
}

/**
 * Each listed page's copy address to link, by its place in `pages`, where
 * copies are on: not where a page of the site holds the copy's address, nor
 * where another listed page has the copy's name for itself (a page named
 * `index.html` keeps `index.html.md`, and its folder's page links itself).
 */
async function linkedCopies(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  rules: SiteRules,
  config: AiOutputsConfig
): Promise<(at: number) => string | undefined> {
  if (rules.plainTextCopies !== true) return () => undefined;
  const copies = pages.map(page => copyAddressOf(page.loc));
  const taken = await copiesTaken(ctx, copies, config);
  const copySet = new Set(copies);
  const literal = new Set(
    pages.map(page => `${page.loc}.md`).filter(copy => copySet.has(copy))
  );
  return at => {
    const copy = copies[at];
    const own = `${pages[at]?.loc}.md`;
    return copy === undefined ||
      taken.has(copy) ||
      (literal.has(copy) && copy !== own)
      ? undefined
      : copy;
  };
}

/** What a page's head says, and the page's own name, as the outputs list it. */
interface HeadNames {
  title?: string;
  description?: string;
  /**
   * The page's own name (`pageNameOf`): the title the outputs list it by,
   * with no markup and without the site's name.
   */
  name?: string;
  /** The top-level field its name was read from, said once in its copy. */
  nameField?: string;
  /** Its type is a Single whose `title` is Nextly's, left out of its copy. */
  labelTitle?: boolean;
}

/** A listed page's head as the public may read it, and its published document. */
interface ListedHead extends HeadNames {
  readable: boolean;
  /** The published document, as the public reads it, where it may. */
  document?: Record<string, unknown>;
}

/**
 * Whether a page may be rendered to make its copy: only where the site
 * names its own addresses (a production address, or the configured
 * origin), so a listed address is one the site chose, never the host a
 * request named, and no request can send the site to fetch another host.
 * Serving a copy, llms.txt and a page's head all ask this, so none links a
 * rendered copy that is not served.
 */
async function rendersPages(
  ctx: PluginContext,
  config: AiOutputsConfig
): Promise<boolean> {
  return (await siteOriginFor(undefined, ctx, config)) !== undefined;
}

/**
 * Each listed page's title and description as the public may read them,
 * and whether the public may read it at all, by its place in `pages`. A page
 * built in code has no document: its head is the SEO set for its address,
 * which every visitor's page already carries, and its copy is made from the
 * page as it renders, so the public may read it wherever the site's pages
 * may be rendered.
 */
async function listedHeads(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  config: AiOutputsConfig,
  readRules: ReadRules
): Promise<(at: number) => ListedHead> {
  const codeSlug = codePagesSlug(ctx);
  const readable = await publicDocuments(
    pages.filter(page => page.holder.collection !== codeSlug)
  );
  const heads = await publicHeads(ctx, pages, readable, readRules);
  const codeHeads = await codeHeadsOf(ctx, config, readRules);
  // Each page built in code whose copy is served, decided as serving it is,
  // whether pages may be rendered read once for them all.
  const renders = await rendersPages(ctx, config);
  const codeCopies = new Set<string>();
  for (const page of pages) {
    if (
      page.holder.collection === codeSlug &&
      (await codeCopyServed(ctx, config, page.path, renders))
    ) {
      codeCopies.add(page.path);
    }
  }
  return at => {
    const page = pages[at];
    if (page === undefined) return { readable: false };
    if (page.holder.collection === codeSlug) {
      // Its copy is made from the Markdown the options give for it, or from
      // the page as it renders, where it may be.
      return {
        ...codeHeads.get(page.path),
        readable: codeCopies.has(page.path),
      };
    }
    const document = readable.get(readingKey(page));
    return {
      ...heads.get(at),
      readable: document !== undefined,
      ...(document === undefined ? {} : { document }),
    };
  };
}

/**
 * The pages both llms files list, as the sitemap lists them, with the site's
 * rules read once per language for the whole file, as the listing reads
 * them, not once a page.
 */
async function llmsPagesOf(
  ctx: PluginContext,
  origin: string,
  config: AiOutputsConfig
): Promise<{ pages: readonly ListedPage[]; readRules: ReadRules }> {
  const readRules = onceEach(config.readRules);
  const { pages } = await listPages(ctx, {
    origin,
    readRules,
    ...(config.codeRoutes === undefined
      ? {}
      : { codeRoutes: config.codeRoutes }),
    ...(config.collections === undefined
      ? {}
      : { collections: config.collections }),
  });
  return { pages, readRules };
}

/**
 * The llms.txt of the site at `origin`, by the site's `rules`, or null while
 * it is switched off. Each page links to its plain-text copy where copies are
 * switched on and the public may read it, else to the page itself; a page
 * the public may not read is listed by its address alone, as the sitemap
 * lists it.
 */
export async function llmsTxtOf(
  ctx: PluginContext,
  origin: string,
  config: AiOutputsConfig,
  rules: SiteRules
): Promise<string | null> {
  if (rules.llmsTxt !== true) return null;
  const { pages, readRules } = await llmsPagesOf(ctx, origin, config);
  const sections = await sectionsOf(ctx, pages);
  const linked = await linkedCopies(ctx, pages, rules, config);
  const headOf = await listedHeads(ctx, pages, config, readRules);
  const entries: LlmsEntry[] = pages.map((page, at) => {
    const head = headOf(at);
    return {
      section: sections.get(page.holder.collection) ?? SINGLES_SECTION,
      title: head.name ?? head.title ?? page.path,
      url: (head.readable ? linked(at) : undefined) ?? page.loc,
      ...(head.description === undefined
        ? {}
        : { description: head.description }),
    };
  });
  return llmsTxt({
    ...fileHeadOf(origin, rules),
    ...(rules.llmsFullTxt === true
      ? { fullTxt: new URL("/llms-full.txt", origin).href }
      : {}),
    entries,
  });
}

/** What both llms files begin with: the site's name, summary and own words. */
function fileHeadOf(
  origin: string,
  rules: SiteRules
): { name: string; description?: string; intro?: string } {
  return {
    name: rules.siteName ?? new URL(origin).host,
    ...(rules.description === undefined
      ? {}
      : { description: rules.description }),
    ...(rules.llmsIntro === undefined ? {} : { intro: rules.llmsIntro }),
  };
}

/** How many pages llms-full.txt renders at once, at most. */
const RENDERS_AT_ONCE = 4;

/**
 * How long llms-full.txt spends rendering pages, all told: a page whose
 * render would start past it is given its description instead.
 */
const FULL_RENDER_BUDGET_MS = 20_000;

/** Why a page past {@link FULL_RENDER_BUDGET_MS} was not rendered. */
const OUT_OF_TIME = "llms-full.txt ran out of time before rendering it";

/** What making copies found, kept once the file is written. */
interface CopyResults {
  failed: Omit<CopyFailure, "at">[];
  /** The pages whose rendered copy was made. */
  made: string[];
}

/** What llms-full.txt's pages are written with, read once for the file. */
interface FullWriting {
  ctx: PluginContext;
  config: AiOutputsConfig;
  headOf: (at: number) => ListedHead;
  fields: ReadonlyMap<string, readonly CopyField[] | undefined>;
  titleFields: TitleFields | undefined;
  /** Whether the site's pages may be rendered (`rendersPages`). */
  renders: boolean;
  /** When rendering stops, as a time in milliseconds. */
  deadline: number;
  /** Where asking again makes a page's copy again. */
  retry: (page: ListedPage) => string;
  results: CopyResults;
}

/**
 * The llms-full.txt of the site at `origin`, or null unless both it and
 * llms.txt are switched on: llms.txt's head, then every page llms.txt lists,
 * in its order, with the words its plain-text copy holds. A page built in
 * code, or one whose stored fields hold no words (a Page Builder layout), is
 * written from the Markdown the site's options give for it, else from the
 * page as it renders, a few at a time and within a time budget. A page whose
 * words cannot be had is written with its description, and noted for the
 * problem list. A page the public may not read is named by its address
 * alone. Each type's fields and every page's document are read once for the
 * file, and a page's words are built only as the file takes the page, so
 * none past where the file stops short is ever built. `maxBytes` is the
 * file's size, 5 MB unless given; only a test gives a smaller one.
 */
export async function llmsFullTxtOf(
  ctx: PluginContext,
  origin: string,
  config: AiOutputsConfig,
  rules: SiteRules,
  maxBytes?: number
): Promise<string | null> {
  if (rules.llmsTxt !== true || rules.llmsFullTxt !== true) return null;
  const { pages, readRules } = await llmsPagesOf(ctx, origin, config);
  const headOf = await listedHeads(ctx, pages, config, readRules);
  // The fields of each type with a page the public may read, one read a
  // type, taken before the file is written so the pages can be built as
  // the file takes them, with nothing left to wait for.
  const fields = new Map<string, readonly CopyField[] | undefined>();
  for (const [at, page] of pages.entries()) {
    const { collection } = page.holder;
    if (headOf(at).document !== undefined && !fields.has(collection)) {
      fields.set(collection, await fieldsOf(ctx, collection));
    }
  }
  const fullAddress = new URL("/llms-full.txt", origin).href;
  const writing: FullWriting = {
    ctx,
    config,
    headOf,
    fields,
    titleFields: rules.titleFields,
    renders: await rendersPages(ctx, config),
    deadline: Date.now() + FULL_RENDER_BUDGET_MS,
    // A page's copy makes it again where copies are served; else this file.
    retry: page =>
      rules.plainTextCopies === true ? copyAddressOf(page.loc) : fullAddress,
    results: { failed: [], made: [] },
  };
  const file = await llmsFullTxt({
    ...fileHeadOf(origin, rules),
    pages: fullPagesOf(pages, writing),
    listUrl: new URL("/llms.txt", origin).href,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
  await noteCopyResults(ctx, writing.results.failed, writing.results.made);
  return file;
}

/** Keep what rendering `page` gave in `results`. */
function noteRendered(
  results: CopyResults,
  page: ListedPage,
  rendered: RenderedPage,
  retry: string
): void {
  if ("copy" in rendered) results.made.push(page.loc);
  else results.failed.push({ url: page.loc, reason: rendered.failed, retry });
}

/**
 * The words of `page` as it renders, where the site's pages may be rendered
 * and the file's time for rendering has not run out; none otherwise, the
 * reason noted where it is a failure.
 */
async function renderedBodyOf(
  writing: FullWriting,
  page: ListedPage
): Promise<string | undefined> {
  if (!writing.renders) return undefined;
  const retry = writing.retry(page);
  if (Date.now() > writing.deadline) {
    writing.results.failed.push({ url: page.loc, reason: OUT_OF_TIME, retry });
    return undefined;
  }
  const rendered = await renderedCopyAt(writing.ctx, page.loc, page.loc);
  noteRendered(writing.results, page, rendered, retry);
  return "copy" in rendered ? rendered.copy.body : undefined;
}

/** The words of a page built in code: the Markdown the options give, else the page as it renders. */
async function codeBodyOf(
  writing: FullWriting,
  page: ListedPage
): Promise<string | undefined> {
  const stated = await statedMarkdownAt(writing.ctx, writing.config, page.path);
  return stated ?? (await renderedBodyOf(writing, page));
}

/**
 * The words of a page with a published document: its stored copy, else,
 * where its stored fields hold none beyond its name, the page as it renders.
 */
async function documentBodyOf(
  writing: FullWriting,
  page: ListedPage,
  head: ListedHead & { document: Record<string, unknown> }
): Promise<string | undefined> {
  const stored = await documentCopyOf(writing.ctx, page, head.document, head, {
    fields: writing.fields.get(page.holder.collection),
    titleFields: writing.titleFields,
  });
  if (holdsWords(stored)) return stored;
  return renderedBodyOf(writing, page);
}

/**
 * The pages of llms-full.txt, in the listing's order, each built only when
 * the file asks for it: the file stops asking once a page will not fit, so
 * the words of the pages after it are never built or kept, however large
 * the site. A page built in code is rendered a few pages ahead of the one
 * written, {@link RENDERS_AT_ONCE} at most at once, so the file does not
 * wait on each render in turn. Every page the public may read has words:
 * its own, else its description.
 */
async function* fullPagesOf(
  pages: readonly ListedPage[],
  writing: FullWriting
): AsyncGenerator<LlmsFullPage> {
  const codeSlug = codePagesSlug(writing.ctx);
  const ahead = new Map<number, Promise<string | undefined>>();
  try {
    yield* pagesInOrder(pages, writing, codeSlug, ahead);
  } finally {
    // The file may stop before every page rendered ahead was taken: each is
    // let finish, so what it found is kept with the rest and no render
    // outlives the answer.
    await Promise.allSettled(ahead.values());
  }
}

/** The pages of {@link fullPagesOf}, rendering those built in code ahead into `ahead`. */
async function* pagesInOrder(
  pages: readonly ListedPage[],
  writing: FullWriting,
  codeSlug: string,
  ahead: Map<number, Promise<string | undefined>>
): AsyncGenerator<LlmsFullPage> {
  for (const [at, page] of pages.entries()) {
    const last = Math.min(pages.length, at + RENDERS_AT_ONCE);
    for (let next = at; next < last; next += 1) {
      const coming = pages[next];
      if (
        coming !== undefined &&
        !ahead.has(next) &&
        coming.holder.collection === codeSlug &&
        writing.headOf(next).readable
      ) {
        ahead.set(next, codeBodyOf(writing, coming));
      }
    }
    const head = writing.headOf(at);
    const { document } = head;
    let body: string | undefined;
    const started = ahead.get(at);
    if (started !== undefined) {
      ahead.delete(at);
      body = await started;
    } else if (document !== undefined) {
      body = await documentBodyOf(writing, page, { ...head, document });
    }
    yield {
      title: head.name ?? head.title ?? page.path,
      url: page.loc,
      ...(head.readable
        ? { body: body ?? descriptionCopyOf(undefined, head.description) }
        : {}),
    };
  }
}

/**
 * The fields a page's type declares, where the site can say: a Single's as
 * its code declares them, with their labels and options, else as the
 * registry keeps them.
 */
async function fieldsOf(
  ctx: PluginContext,
  collection: string
): Promise<readonly CopyField[] | undefined> {
  if (collection.startsWith("single:")) {
    const slug = collection.slice("single:".length);
    const declared = singleDeclaration(ctx, slug)?.fields;
    if (Array.isArray(declared)) return declared.filter(isCopyField);
    const { data } = await ctx.services.singles.list({ limit: 500 });
    const single = data.find(each => each.slug === slug);
    return single?.fields;
  }
  const meta: unknown = await ctx.services.collections.getCollection(
    collection,
    {}
  );
  return isRecord(meta) && Array.isArray(meta.fields)
    ? meta.fields.filter(isCopyField)
    : undefined;
}

/** Whether a declared field is one a copy can read: an object naming its type. */
function isCopyField(field: unknown): field is CopyField {
  return isRecord(field) && typeof field.type === "string";
}

/** A page refused to the public, or no longer found, has no public reading. */
function refusedToPublic(error: unknown): boolean {
  return (
    NextlyError.isCode(error, "FORBIDDEN") ||
    NextlyError.isCode(error, "AUTH_REQUIRED") ||
    NextlyError.isCode(error, "NOT_FOUND")
  );
}

/** How many of a type's pages one public read takes. */
const PUBLIC_READ = 100;

/** The key a page's public reading is kept under. */
const readingKey = (page: ListedPage): string =>
  `${page.holder.collection}|${page.holder.id}|${page.language}`;

/** The Direct API every public reading is made through. */
type Reader = Awaited<ReturnType<typeof getCachedNextly>>;

/** A Single's published document, as the public reads it, into `found`. */
async function publicSingle(
  nextly: Reader,
  page: ListedPage,
  found: Map<string, Record<string, unknown>>
): Promise<void> {
  const document: unknown = await nextly.findSingle({
    slug: page.holder.collection.slice("single:".length),
    createIfMissing: false,
    overrideAccess: false,
    status: "published",
    depth: 1,
    locale: page.language,
  });
  if (isRecord(document)) found.set(readingKey(page), document);
}

/** A collection's published pages in one language, as the public reads them. */
async function publicEntries(
  nextly: Reader,
  pages: readonly ListedPage[],
  found: Map<string, Record<string, unknown>>
): Promise<void> {
  const [first] = pages;
  if (first === undefined) return;
  const { collection } = first.holder;
  for (let at = 0; at < pages.length; at += PUBLIC_READ) {
    const ids = pages.slice(at, at + PUBLIC_READ).map(page => page.holder.id);
    const result = await nextly.find({
      collection,
      where: { id: { in: ids } },
      overrideAccess: false,
      status: "published",
      depth: 1,
      limit: ids.length,
      locale: first.language,
    });
    for (const document of (result.items as unknown[]).filter(isRecord)) {
      found.set(
        `${collection}|${String(document.id)}|${first.language}`,
        document
      );
    }
  }
}

/**
 * The published documents of `pages`, read as a visitor with no session
 * reads them: the Public role's grants, the type's read rule and each
 * field's read rule decide what is in each, so nothing an output publishes
 * holds more than the public may read. A page the public may not read has
 * none. One read per type and language, a hundred pages at a time.
 */
async function publicDocuments(
  pages: readonly ListedPage[]
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const groups = new Map<string, ListedPage[]>();
  for (const page of pages) {
    const group = `${page.holder.collection}|${page.language}`;
    const list = groups.get(group) ?? [];
    list.push(page);
    groups.set(group, list);
  }
  const nextly = await getCachedNextly();
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    try {
      await (first.holder.collection.startsWith("single:")
        ? publicSingle(nextly, first, found)
        : publicEntries(nextly, group, found));
    } catch (error) {
      if (!refusedToPublic(error)) throw error;
    }
  }
  return found;
}

/** The page `page` is, as its route's values are kept. */
const routePageOf = (page: ListedPage): RouteValuesPage => ({
  type: page.holder.collection,
  id: page.holder.id,
  language: page.language,
});

/**
 * The head of each of `pages` the public may read, by its place in `pages`:
 * worked out language by language, inside one read of who holds every
 * page's address, as the listing works them out, with what each page's
 * route last supplied, read once for them all, so each is named as the
 * page is served.
 */
async function publicHeads(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  readable: ReadonlyMap<string, Record<string, unknown>>,
  readRules: ReadRules
): Promise<Map<number, HeadNames>> {
  const heads = new Map<number, HeadNames>();
  const supplied = await readRouteValues(
    ctx,
    pages.filter(page => readable.has(readingKey(page))).map(routePageOf)
  );
  const byLanguage = new Map<string, number[]>();
  for (const [at, page] of pages.entries()) {
    const list = byLanguage.get(page.language) ?? [];
    list.push(at);
    byLanguage.set(page.language, list);
  }
  for (const [language, places] of byLanguage) {
    const paths = places.flatMap(at => pages[at]?.path ?? []);
    await withAddressHolders(ctx, language, paths, async () => {
      for (const at of places) {
        const page = pages[at];
        const document = page && readable.get(readingKey(page));
        if (page === undefined || document === undefined) continue;
        const code = supplied.get(routeValuesKey(routePageOf(page))) ?? {};
        heads.set(at, await publicHead(ctx, page, document, readRules, code));
      }
    });
  }
  return heads;
}

/**
 * The head of each page built in code, by its address; of the one at
 * `only` alone, where given, so a single copy works out one head.
 */
async function codeHeadsOf(
  ctx: PluginContext,
  config: AiOutputsConfig,
  readRules: ReadRules,
  only?: string
): Promise<Map<string, HeadNames>> {
  const heads = new Map<string, HeadNames>();
  if (config.codeRoutes === undefined) return heads;
  const routes = await config.codeRoutes(ctx);
  const { siteName, titleFields } = await readRules(ctx, undefined);
  const codeSlug = codePagesSlug(ctx);
  const { fields } = titleSourcesOf(ctx, codeSlug, titleFields);
  for (const { route, row, answer } of await codePages(
    ctx,
    only === undefined ? routes : routes.filter(route => route.path === only),
    readRules
  )) {
    const title = answer.title?.value;
    const codeTitle = row?.code.title;
    // Named from what structured data names it by: the page's record (the
    // name its route gives it, else one from its address), its route's own
    // title and its head's.
    const name = pageNameOf({
      home: route.path === "/",
      document: codePageDocument(route.path, row, undefined),
      fields,
      ...(codeTitle === undefined ? {} : { codeTitle }),
      codePage: true,
      ...(title === undefined ? {} : { title }),
      ...(siteName === undefined ? {} : { siteName }),
    });
    heads.set(route.path, {
      ...(title === undefined ? {} : { title }),
      ...(answer.description === undefined
        ? {}
        : { description: answer.description.value }),
      ...(name === undefined ? {} : { name }),
    });
  }
  return heads;
}

/** The type a listed page is of. */
const typeOfPage = (page: ListedPage): PublicAddressType =>
  page.holder.collection.startsWith("single:")
    ? { kind: "single", slug: page.holder.collection.slice("single:".length) }
    : { kind: "collection", slug: page.holder.collection };

/**
 * The title and description a page's head carries, worked out from what
 * the public may read of it, so a value kept from the public is never told,
 * and what its route last supplied (`code`); and the page's own name, as
 * structured data names it (`pageNameOf`).
 */
async function publicHead(
  ctx: PluginContext,
  page: ListedPage,
  document: Record<string, unknown>,
  readRules: ReadRules,
  code: PageMetadataValues = {}
): Promise<HeadNames> {
  const answer = await resolveIn(
    ctx,
    typeOfPage(page),
    document,
    page.language,
    readRules,
    code
  );
  const rules = await readRules(ctx, page.language);
  const sources = titleSourcesOf(
    ctx,
    page.holder.collection,
    rules.titleFields
  );
  const title = answer.title?.value;
  const name = pageNameOf({
    home: page.path === "/",
    document,
    fields: sources.fields,
    ...(code.title === undefined ? {} : { codeTitle: code.title }),
    codePage: false,
    ...(title === undefined ? {} : { title }),
    ...(rules.siteName === undefined ? {} : { siteName: rules.siteName }),
  });
  const own = ownTitleIn(document, sources.fields)?.field;
  return {
    ...(title === undefined ? {} : { title }),
    ...(answer.description === undefined
      ? {}
      : { description: answer.description.value }),
    ...(name === undefined ? {} : { name }),
    // A dotted path names a field inside a group, which the copy writes
    // where the group is: only a top-level field is left out below the
    // heading.
    ...(own === undefined || own.includes(".") ? {} : { nameField: own }),
    ...(sources.labelTitle ? { labelTitle: true } : {}),
  };
}

/**
 * The language and kept path of each page of `candidates`, paths on `url`'s
 * host, in their order, with the path as the site serves it. A path is kept
 * without its trailing slash, as the record keys it.
 */
async function pageAddressesAsked(
  url: URL,
  candidates: readonly string[]
): Promise<{ locale: string; path: string; served: string }[]> {
  const asked: { locale: string; path: string; served: string }[] = [];
  for (const candidate of candidates) {
    const pageUrl = new URL(url.href);
    pageUrl.pathname = candidate;
    pageUrl.search = "";
    const address = await addressOfRequest(pageUrl);
    if (address === undefined) continue;
    const { locale, path } = address;
    asked.push({
      locale,
      path: path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path,
      // As the site serves it, its language prefix kept.
      served: bare(candidate),
    });
  }
  return asked;
}

/** What a copy's front matter says of `page`, from its head. */
function aboutOf(
  page: ListedPage,
  head: { title?: string; description?: string }
): CopyAbout {
  return {
    ...(head.title === undefined ? {} : { title: head.title }),
    ...(head.description === undefined
      ? {}
      : { description: head.description }),
    url: page.loc,
    ...(page.lastModified === undefined
      ? {}
      : { lastUpdated: page.lastModified }),
  };
}

/**
 * The copy of `page` made from the page as it is rendered, asked for at its
 * own listed address; its front matter from `head`, else the rendered
 * page's own head. None where the page does not render, which is noted for
 * the problem list, as a copy made is taken off it.
 */
async function renderedCopyFor(
  ctx: PluginContext,
  page: ListedPage,
  head: { title?: string; description?: string }
): Promise<string | null> {
  const rendered = await renderedCopyAt(ctx, page.loc, page.loc);
  const results: CopyResults = { failed: [], made: [] };
  noteRendered(results, page, rendered, copyAddressOf(page.loc));
  await noteCopyResults(ctx, results.failed, results.made);
  if (!("copy" in rendered)) return null;
  const title = head.title ?? rendered.copy.title;
  const description = head.description ?? rendered.copy.description;
  return withFrontMatter(
    aboutOf(page, {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    }),
    rendered.copy.body
  );
}

/**
 * The copy of a page whose words could not be had: its front matter from
 * `head`, its name as the heading and its description beneath.
 */
const descriptionCopyFor = (page: ListedPage, head: HeadNames): string =>
  withFrontMatter(
    aboutOf(page, head),
    descriptionCopyOf(head.name ?? head.title, head.description)
  );

/**
 * The Markdown the site's options give for the page built in code at
 * `path`, made; none where they give none for its route, or theirs gives
 * nothing. A source that fails is logged, and counts as none.
 */
async function statedMarkdownAt(
  ctx: PluginContext,
  config: AiOutputsConfig,
  path: string
): Promise<string | null> {
  const source = config.codeMarkdown?.(path);
  if (source === undefined) return null;
  let markdown: string | undefined;
  try {
    markdown = await source.markdown(source.page);
  } catch (error) {
    ctx.logger.warn(
      "The Markdown codeAddresses gives for a page could not be made",
      { path, error }
    );
    return null;
  }
  return typeof markdown === "string" && markdown.trim() !== ""
    ? markdown.trim()
    : null;
}

/**
 * Whether the copy of the page built in code at `path` is served: made from
 * the page as it renders, where the site lets it be (`rendersPages`), else
 * from the Markdown its options give, where that gives some. The one answer
 * serving a copy, its head's link and llms.txt's link read; `renders`, where
 * the caller has read whether pages may be rendered already.
 */
async function codeCopyServed(
  ctx: PluginContext,
  config: AiOutputsConfig,
  path: string,
  renders?: boolean
): Promise<boolean> {
  if (renders ?? (await rendersPages(ctx, config))) return true;
  return (await statedMarkdownAt(ctx, config, path)) !== null;
}

/**
 * The copy of the page built in code `page` made from the Markdown the
 * site's options give for it, with its front matter from its head; none
 * where they give none, or it gives nothing, and the copy is then made from
 * the rendered page.
 */
async function statedCopyFor(
  ctx: PluginContext,
  page: ListedPage,
  config: AiOutputsConfig
): Promise<string | null> {
  const markdown = await statedMarkdownAt(ctx, config, page.path);
  if (markdown === null) return null;
  const heads = await codeHeadsOf(ctx, config, config.readRules, page.path);
  return withFrontMatter(aboutOf(page, heads.get(page.path) ?? {}), markdown);
}

/** Whether a copy says anything beyond its heading. */
const holdsWords = (copy: string): boolean =>
  copy.replace(/^# [^\n]*\n*/, "").trim() !== "";

/**
 * A listed page's plain-text copy. A page built in code is copied from the
 * Markdown the site's options give for it, else from the page as it
 * renders, since it has no stored words; so is a page whose stored fields
 * hold none beyond its title, such as a Page Builder layout, whose words
 * only the rendered page shows. Every other page is copied from its
 * published document, read as the public reads it. A page whose words
 * cannot be had is copied as its name and description. The front matter is
 * the head the public may read, and the sitemap's last change.
 *
 * A page is rendered only where `render` says it may be
 * ({@link rendersPages}).
 */
async function copyOf(
  ctx: PluginContext,
  page: ListedPage,
  config: AiOutputsConfig,
  render: boolean
): Promise<string | null> {
  const { readRules } = config;
  if (page.holder.collection === codePagesSlug(ctx)) {
    const stated = await statedCopyFor(ctx, page, config);
    if (stated !== null) return stated;
    if (!render) return null;
    const heads = await codeHeadsOf(ctx, config, readRules, page.path);
    const head = heads.get(page.path) ?? {};
    return (
      (await renderedCopyFor(ctx, page, head)) ?? descriptionCopyFor(page, head)
    );
  }
  const document = (await publicDocuments([page])).get(readingKey(page));
  if (document === undefined) return null;
  const code = (await readRouteValues(ctx, [routePageOf(page)])).get(
    routeValuesKey(routePageOf(page))
  );
  const head = await publicHead(ctx, page, document, readRules, code);
  // The stored copy without front matter, so a page whose stored fields
  // hold no words can be copied from its rendered page instead.
  const stored = await documentCopyOf(ctx, page, document, head, {
    fields: await fieldsOf(ctx, page.holder.collection),
    titleFields: (await readRules(ctx, page.language)).titleFields,
  });
  if (holdsWords(stored)) return withFrontMatter(aboutOf(page, head), stored);
  if (render) {
    const rendered = await renderedCopyFor(ctx, page, head);
    if (rendered !== null) return rendered;
  }
  return descriptionCopyFor(page, head);
}

/**
 * A page's plain-text copy from its published document: headed by the
 * page's own name (`pageNameOf`), the field it was read from said once,
 * and a Single's `title` that is Nextly's left out; each page a
 * relationship field names written by its title, linked to its address;
 * without front matter, which each caller adds where it wants one.
 */
async function documentCopyOf(
  ctx: PluginContext,
  page: ListedPage,
  document: Record<string, unknown>,
  head: HeadNames,
  {
    fields,
    titleFields,
  }: {
    fields: readonly CopyField[] | undefined;
    titleFields: TitleFields | undefined;
  }
): Promise<string> {
  const title = head.name ?? head.title;
  const related =
    fields === undefined
      ? undefined
      : await relatedPagesOf(ctx, fields, document, page, titleFields);
  return plainCopyOf({
    ...(title === undefined ? {} : { title }),
    ...(head.nameField === undefined ? {} : { titleField: head.nameField }),
    document,
    ...(fields === undefined ? {} : { fields }),
    base: page.loc,
    ...(head.labelTitle === true ? { skip: ["title"] } : {}),
    ...(related === undefined ? {} : { related }),
  });
}

/**
 * The address of `document`, a page of `collection` read with `page`, in
 * `page`'s language, made whole against `page`'s; none where its type
 * declares none, or it cannot be formed.
 */
async function relatedAddressOf(
  collection: string,
  document: Readonly<Record<string, unknown>>,
  page: ListedPage
): Promise<string | undefined> {
  try {
    const own = await publicAddressOf(
      { kind: "collection", slug: collection },
      document,
      page.language
    );
    if (own.status !== "resolved") return undefined;
    const inLanguage = await languageAddressOf(own.path, page.language);
    const path = inLanguage.status === "resolved" ? inLanguage.path : own.path;
    return new URL(path, page.loc).href;
  } catch (error) {
    // A type no longer declared names no address: the page is named alone.
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
}

/**
 * Each page the relationship fields of `document` name and that was read
 * with it, as its copy writes it: by its own name, from the fields its type
 * names its pages by, and linked to its address where it has one. One
 * address worked out a page, however often it is named.
 */
async function relatedPagesOf(
  ctx: PluginContext,
  fields: readonly CopyField[],
  document: Readonly<Record<string, unknown>>,
  page: ListedPage,
  titleFields: TitleFields | undefined
): Promise<RelatedPages> {
  const found = new Map<string, RelatedPage>();
  for (const target of relatedDocumentsIn(fields, document)) {
    const key = relatedKey(target.collection, target.document.id);
    if (target.document.id === undefined || found.has(key)) continue;
    const { fields: named } = titleSourcesOf(
      ctx,
      target.collection,
      titleFields
    );
    const name = ownTitleIn(target.document, named)?.value;
    if (name === undefined) continue;
    const url = await relatedAddressOf(
      target.collection,
      target.document,
      page
    );
    found.set(key, { name, ...(url === undefined ? {} : { url }) });
  }
  return found;
}

/**
 * Which of `copies`, copy addresses, a page of the site holds itself, such
 * as a page whose address is `/guide.md`: that page is served there, so no
 * copy is, and none is linked. A page built in code holds the path its
 * route serves, which the record does not hold, so the site's routes are
 * read too. One read of the record per language.
 */
async function copiesTaken(
  ctx: PluginContext,
  copies: readonly string[],
  config: Pick<AiOutputsConfig, "codeRoutes">
): Promise<Set<string>> {
  const taken = new Set<string>();
  const built = new Set(
    ((await config.codeRoutes?.(ctx)) ?? []).map(route => route.path)
  );
  const byLanguage = new Map<string, { copy: string; path: string }[]>();
  for (const copy of copies) {
    if (built.has(new URL(copy).pathname)) {
      taken.add(copy);
      continue;
    }
    const address = await addressOfRequest(new URL(copy));
    if (address === undefined) continue;
    const list = byLanguage.get(address.locale) ?? [];
    list.push({ copy, path: address.path });
    byLanguage.set(address.locale, list);
  }
  for (const [language, asked] of byLanguage) {
    const paths = asked.map(each => each.path);
    await withAddressHolders(ctx, language, paths, async () => {
      for (const { copy, path } of asked) {
        if ((await addressHolders(ctx, path, language)).length > 0) {
          taken.add(copy);
        }
      }
    });
  }
  return taken;
}

/** A copy found for a request, and what its answer says beside it. */
interface FoundCopy {
  body: string;
  page: ListedPage;
  /** Whether llms.txt is served, which the answer then points to. */
  llmsTxt: boolean;
}

/**
 * Whether `page` is the one a request for `url` asks the copy of: the page
 * whose copy is served at that address, or, asked `atPage`, the page at
 * that address itself.
 */
function asksFor(page: ListedPage, url: URL, atPage: boolean): boolean {
  if (!atPage) return copyPathsOf(page.loc).includes(url.pathname);
  // `/a` and `/a/` are one page, whichever way the site writes it.
  return bare(new URL(page.loc).pathname) === bare(url.pathname);
}

/** A path with its trailing slashes taken off, `/` itself kept. */
const bare = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;

/**
 * The first listed page a request for `url` asks the copy of, trying
 * `candidates` in order: the page the name says literally before the
 * folder's own page, as llms.txt links them. Each is read at the site's
 * origin, as the sitemap lists it, whichever of the site's hosts the
 * request reached; a language served on a domain of its own is listed on
 * that domain.
 */
async function pageAsked(
  ctx: PluginContext,
  url: URL,
  config: AiOutputsConfig,
  candidates: readonly string[],
  atPage: boolean
): Promise<ListedPage | null> {
  const site = (await siteOriginFor(url.origin, ctx, config)) ?? url.origin;
  for (const address of await pageAddressesAsked(url, candidates)) {
    const own = originOf(await servedAt("/", address.locale));
    const { path, locale, served } = address;
    const page = await listedPageAt(
      ctx,
      { path, language: locale, served },
      {
        origin: own === url.origin ? url.origin : site,
        readRules: config.readRules,
        ...(config.codeRoutes === undefined
          ? {}
          : { codeRoutes: config.codeRoutes }),
        ...(config.collections === undefined
          ? {}
          : { collections: config.collections }),
      }
    );
    if (page !== null && asksFor(page, url, atPage)) return page;
  }
  return null;
}

/**
 * The listed page at `loc` where the copy at `url`, a copy's address, is
 * its copy, else null: no page of the site holds the address itself, and
 * the first listed page it names is that page. The one decision both serving a copy and
 * linking one make, so a link never leads to another page's copy.
 */
async function copyServedAt(
  ctx: PluginContext,
  url: URL,
  loc: string,
  config: AiOutputsConfig
): Promise<ListedPage | null> {
  if ((await copiesTaken(ctx, [url.href], config)).size > 0) return null;
  const page = await pageAsked(
    ctx,
    url,
    config,
    pagesOfCopy(url.pathname),
    false
  );
  return page !== null && new URL(page.loc).pathname === new URL(loc).pathname
    ? page
    : null;
}

/**
 * Where the copy of the listed page at `loc` is served, as the head links
 * it: the first of its copy's addresses that is this page's copy, or none
 * where another page holds them all, or where the public may not read the
 * page, which then has no copy to serve.
 */
export async function servedCopyAddress(
  ctx: PluginContext,
  loc: string,
  config: AiOutputsConfig
): Promise<string | undefined> {
  for (const path of copyPathsOf(loc)) {
    const url = new URL(path, loc);
    const page = await copyServedAt(ctx, url, loc, config);
    if (page === null) continue;
    if (page.holder.collection === codePagesSlug(ctx)) {
      return (await codeCopyServed(ctx, config, page.path))
        ? url.href
        : undefined;
    }
    return (await publicDocuments([page])).has(readingKey(page))
      ? url.href
      : undefined;
  }
  return undefined;
}

/**
 * The plain-text copy asked for at `url`, or null where none is served
 * there: copies are switched off, the address is not a copy's, or no page
 * the sitemap lists is at the page address it names. Asked `atPage`, `url`
 * is the page's own address rather than its copy's.
 */
async function plainCopyAt(
  ctx: PluginContext,
  url: URL,
  config: AiOutputsConfig,
  atPage = false
): Promise<FoundCopy | null> {
  const rules = await config.readRules(ctx, undefined);
  if (rules.plainTextCopies !== true) return null;
  // A page of the site's at the copy's address is served there instead.
  if (!atPage && (await copiesTaken(ctx, [url.href], config)).size > 0) {
    return null;
  }
  const candidates = atPage ? [url.pathname] : pagesOfCopy(url.pathname);
  const page = await pageAsked(ctx, url, config, candidates, atPage);
  if (page === null) return null;
  const body = await copyOf(ctx, page, config, await rendersPages(ctx, config));
  return body === null ? null : { body, page, llmsTxt: rules.llmsTxt === true };
}

/** A media range of an `Accept` header and the weight it is given. */
interface AcceptedType {
  type: string;
  q: number;
  at: number;
}

/** The media ranges an `Accept` header lists, each with its weight and place. */
function acceptedTypes(accept: string): AcceptedType[] {
  return accept.split(",").flatMap((part, at) => {
    const [type = "", ...params] = part.split(";").map(each => each.trim());
    if (type === "") return [];
    const weight = params
      .map(param => /^q=([0-9.]+)$/i.exec(param)?.[1])
      .find(value => value !== undefined);
    const q = weight === undefined ? 1 : Number(weight);
    return [{ type: type.toLowerCase(), q: Number.isFinite(q) ? q : 0, at }];
  });
}

/**
 * Whether an `Accept` header asks for Markdown over HTML: `text/markdown`
 * named with a weight above nothing, and above `text/html`'s, or as high
 * and named first, as coding agents send it (`text/markdown, text/html`). A
 * browser never names Markdown, so it is always served the page.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (accept === null) return false;
  const types = acceptedTypes(accept);
  const markdown = types.find(each => each.type === "text/markdown");
  if (markdown === undefined || markdown.q <= 0) return false;
  // HTML's weight from the range naming it most specifically, as RFC 9110
  // reads it: `text/html`, else `text/*`, else `*/*`.
  const html = ["text/html", "text/*", "*/*"]
    .map(range => types.find(each => each.type === range))
    .find(each => each !== undefined);
  if (html === undefined) return true;
  return (
    markdown.q > html.q || (markdown.q === html.q && markdown.at < html.at)
  );
}

/** Where a program finds the site's description of itself, where llms.txt is served. */
const describedBy = (copy: FoundCopy): string[] =>
  copy.llmsTxt
    ? [
        `<${new URL("/llms.txt", copy.page.loc).href}>; rel="describedby"; type="text/plain"`,
      ]
    : [];

/**
 * The headers a copy is answered with. At its own address it is cacheable,
 * kept out of search results (its page is the one to list) and names its
 * page as canonical. At the page's own address, asked for by `Accept`, it is
 * never kept by a shared cache, which might not tell readers apart by what
 * they accept and hand it to a browser, and is never marked noindex, which a
 * cache's mistake would then put on the page.
 */
function copyHeaders(copy: FoundCopy, atPage: boolean): Record<string, string> {
  return {
    "content-type": "text/markdown; charset=utf-8",
    link: [`<${copy.page.loc}>; rel="canonical"`, ...describedBy(copy)].join(
      ", "
    ),
    vary: "Accept",
    ...(atPage
      ? { "cache-control": "private, no-store" }
      : {
          "cache-control": "public, max-age=300",
          "x-robots-tag": "noindex",
        }),
  };
}

/**
 * The copy `request` asks for: its address, and whether it is asked for at
 * the page's own address (by `Accept`) rather than at a `.md` address; none
 * where it asks for no copy.
 */
function copyAskedFor(
  request: Request
): { url: URL; atPage: boolean } | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  // A page asked for to make a copy from is the page, never a copy.
  if (request.headers.has(RENDERING_HEADER)) return undefined;
  const url = new URL(request.url);
  if (url.pathname.endsWith(".md")) return { url, atPage: false };
  return prefersMarkdown(request.headers.get("accept"))
    ? { url, atPage: true }
    : undefined;
}

/**
 * Whether the site's code builds a page at `url`, as its build's own files
 * name them: read with nothing started, so the Proxy can claim by it.
 */
function builtAt(
  config: Pick<AiOutputsConfig, "builtRoutes">,
  url: URL
): boolean {
  return (config.builtRoutes?.() ?? []).some(
    route => route.path === url.pathname
  );
}

/** Whether the site's code builds a page at `url`, as every source names them. */
async function codeServesAt(
  ctx: PluginContext,
  config: Pick<AiOutputsConfig, "codeRoutes">,
  url: URL
): Promise<boolean> {
  return ((await config.codeRoutes?.(ctx)) ?? []).some(
    route => route.path === url.pathname
  );
}

/**
 * How long a request at a copy's own address waits for the address record
 * to catch up. A catch-up with nothing to do takes a few reads; one still
 * running past this is answered "try again" rather than held further.
 */
const COPY_RECORD_WAIT_MS = 5000;

/**
 * The answer at a copy's own address while the address record is not ready,
 * as the sitemap's is: readers come back, and nothing between keeps it.
 */
function copyNotReady(): Response {
  const unavailable = NextlyError.serviceUnavailable({
    publicMessage: "The plain-text copy is being brought up to date.",
  });
  return new Response(unavailable.publicMessage, {
    status: unavailable.statusCode,
    headers: { "cache-control": "no-store", "retry-after": "120" },
  });
}

/**
 * What a request for a copy is answered with while the address record catches
 * up, or `"ready"` once the record is ready to answer it. A page may not hold
 * its address yet. A copy's own address waits for the record, up to a limit:
 * on a server that has only just started, the catch-up is still running when
 * the first request comes, and the site serves no page there; where the
 * record is behind, the wait runs the catch-up itself, as a failed one is
 * tried again (`addressRecordReadyWithin`). Past the limit it is asked to
 * come back rather than answered not found, which a reader may keep. Never
 * held: a page's own address asked for by `Accept`, which
 * the page answers; a page the site's code builds; and a copy's address
 * where copies are switched off.
 */
async function waitForRecord(
  ctx: PluginContext,
  url: URL,
  atPage: boolean,
  config: AiOutputsConfig
): Promise<ProxyAnswer | undefined | "ready"> {
  if (
    atPage ||
    builtAt(config, url) ||
    (await codeServesAt(ctx, config, url))
  ) {
    return undefined;
  }
  const rules = await config.readRules(ctx, undefined);
  if (rules.plainTextCopies !== true) return undefined;
  if (await addressRecordReadyWithin(COPY_RECORD_WAIT_MS)) return "ready";
  // A page of the site at this address, one built in code or one the record
  // already holds, is served there as ever.
  if ((await copiesTaken(ctx, [url.href], config)).size > 0) return undefined;
  return { response: copyNotReady() };
}

/**
 * The Proxy handler that answers a request for a page's plain-text copy:
 * a GET or HEAD of an address ending in `.md`, or of a page's own address
 * whose `Accept` header asks for Markdown over HTML. Every other request
 * passes untouched, and so does one for a copy that is not served. The copy
 * names its page as canonical, so search engines keep the page.
 */
export function plainCopyProxyHandler(
  config: AiOutputsConfig,
  seen: ProxySeenNotes = NOT_NOTED
): PluginProxyHandler {
  return {
    name: "plain-text-copies",
    // A copy's own address is served by no page, so a Proxy still starting
    // waits for the start rather than send it on to be answered not found.
    // A page's own address, asked for by `Accept`, is the page's to answer,
    // and so is a page the site's code builds at a copy's address, which the
    // build names before anything has started.
    claims: request => {
      const asked = copyAskedFor(request);
      return asked?.atPage === false && !builtAt(config, asked.url);
    },
    async handle(request, ctx) {
      // Noted in the background, so the admin can tell the Proxy runs.
      void seen.note(ctx);
      const asked = copyAskedFor(request);
      if (asked === undefined) return;
      const { url, atPage } = asked;
      if (!addressRecordReady()) {
        const waited = await waitForRecord(ctx, url, atPage, config);
        if (waited !== "ready") return waited;
      }
      const copy = await plainCopyAt(ctx, url, config, atPage);
      if (copy === null) return;
      return {
        response: new Response(request.method === "HEAD" ? null : copy.body, {
          headers: copyHeaders(copy, atPage),
        }),
      };
    },
  };
}
