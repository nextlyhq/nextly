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
  NextlyError,
  type PluginContext,
  type PublicAddressType,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import {
  addressRecordReady,
  retryFailedCatchUp,
} from "../address-record/catch-up";
import {
  addressHolders,
  withAddressHolders,
} from "../address-record/participant";
import { codePages } from "../code-pages/answers";
import { codePagesSlug } from "../code-pages/collection";
import type { CodeRoute } from "../code-pages/routes";
import { onceEach, resolveIn, servedAt } from "../languages/versions";
import { originOf } from "../origin";
import { isRecord, textOf } from "../plain-values";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { TITLE_FIELDS } from "../settings/patterns";

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
  pagesOfCopy,
  plainCopyOf,
  withFrontMatter,
  type CopyAbout,
  type CopyField,
} from "./plain-copy";
import { renderedCopyAt, RENDERING_HEADER } from "./rendered-fetch";
import { siteOriginFor } from "./site-origin";

/** What the AI outputs read: the site's rules, and what the sitemap lists. */
export interface AiOutputsConfig {
  readRules: ReadRules;
  /** The site's configured origin, where its settings name no address. */
  origin?: string;
  /** The pages built in code the sitemap lists, where any are known. */
  codeRoutes?: () => readonly CodeRoute[];
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

/** A listed page's head as the public may read it, and its published document. */
interface ListedHead {
  title?: string;
  description?: string;
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
  const renders = await rendersPages(ctx, config);
  return at => {
    const page = pages[at];
    if (page === undefined) return { readable: false };
    if (page.holder.collection === codeSlug) {
      // Its copy is made from the page as it renders, where it may be.
      return { ...codeHeads.get(page.path), readable: renders };
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
      title: head.title ?? page.path,
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

/**
 * The llms-full.txt of the site at `origin`, or null unless both it and
 * llms.txt are switched on: llms.txt's head, then every page llms.txt lists,
 * in its order, with the words its plain-text copy holds. A page the public
 * may not read, or one built in code, is named by its address alone. Each
 * type's fields and every page's document are read once for the file, and a
 * page's words are built only as the file takes the page, so none past
 * where the file stops short is ever built. `maxBytes` is the file's size,
 * 5 MB unless given; only a test gives a smaller one.
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
  return llmsFullTxt({
    ...fileHeadOf(origin, rules),
    pages: fullPagesOf(pages, headOf, fields),
    listUrl: new URL("/llms.txt", origin).href,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

/**
 * The pages of llms-full.txt, in the listing's order, each built only when
 * the file asks for it: the file stops asking once a page will not fit, so
 * the words of the pages after it are never built or kept, however large
 * the site.
 */
function* fullPagesOf(
  pages: readonly ListedPage[],
  headOf: (at: number) => ListedHead,
  fields: ReadonlyMap<string, readonly CopyField[] | undefined>
): Generator<LlmsFullPage> {
  for (const [at, page] of pages.entries()) {
    const head = headOf(at);
    yield {
      title: head.title ?? page.path,
      url: page.loc,
      ...(head.document === undefined
        ? {}
        : {
            body: copyOfDocument(page, head.document, head.title, {
              fields: fields.get(page.holder.collection),
            }),
          }),
    };
  }
}

/** The fields a page's type declares, where the site can say. */
async function fieldsOf(
  ctx: PluginContext,
  collection: string
): Promise<readonly CopyField[] | undefined> {
  if (collection.startsWith("single:")) {
    const slug = collection.slice("single:".length);
    const { data } = await ctx.services.singles.list({ limit: 500 });
    const single = data.find(each => each.slug === slug);
    return single?.fields;
  }
  const meta: unknown = await ctx.services.collections.getCollection(
    collection,
    {}
  );
  return isRecord(meta) && Array.isArray(meta.fields)
    ? (meta.fields as CopyField[])
    : undefined;
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

/**
 * The head of each of `pages` the public may read, by its place in `pages`:
 * worked out language by language, inside one read of who holds every
 * page's address, as the listing works them out.
 */
async function publicHeads(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  readable: ReadonlyMap<string, Record<string, unknown>>,
  readRules: ReadRules
): Promise<Map<number, { title?: string; description?: string }>> {
  const heads = new Map<number, { title?: string; description?: string }>();
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
        heads.set(at, await publicHead(ctx, page, document, readRules));
      }
    });
  }
  return heads;
}

/** The head of each page built in code, by its address. */
async function codeHeadsOf(
  ctx: PluginContext,
  config: AiOutputsConfig,
  readRules: ReadRules
): Promise<Map<string, { title?: string; description?: string }>> {
  const heads = new Map<string, { title?: string; description?: string }>();
  if (config.codeRoutes === undefined) return heads;
  for (const { route, answer } of await codePages(
    ctx,
    config.codeRoutes(),
    readRules
  )) {
    heads.set(route.path, {
      ...(answer.title === undefined ? {} : { title: answer.title.value }),
      ...(answer.description === undefined
        ? {}
        : { description: answer.description.value }),
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
 * the public may read of it, so a value kept from the public is never told.
 */
async function publicHead(
  ctx: PluginContext,
  page: ListedPage,
  document: Record<string, unknown>,
  readRules: ReadRules
): Promise<{ title?: string; description?: string }> {
  const answer = await resolveIn(
    ctx,
    typeOfPage(page),
    document,
    page.language,
    readRules
  );
  return {
    ...(answer.title === undefined ? {} : { title: answer.title.value }),
    ...(answer.description === undefined
      ? {}
      : { description: answer.description.value }),
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
 * page's own head. None where the page does not render.
 */
async function renderedCopyFor(
  ctx: PluginContext,
  page: ListedPage,
  head: { title?: string; description?: string }
): Promise<string | null> {
  const rendered = await renderedCopyAt(ctx, page.loc, page.loc);
  if (rendered === null) return null;
  const title = head.title ?? rendered.title;
  const description = head.description ?? rendered.description;
  return withFrontMatter(
    aboutOf(page, {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    }),
    rendered.body
  );
}

/** Whether a copy says anything beyond its heading. */
const holdsWords = (copy: string): boolean =>
  copy.replace(/^# [^\n]*\n*/, "").trim() !== "";

/**
 * A listed page's plain-text copy. A page built in code is copied from the
 * page as it renders, since it has no stored words; so is a page whose
 * stored fields hold none beyond its title, such as a Page Builder layout,
 * whose words only the rendered page shows. Every other page is copied from
 * its published document, read as the public reads it. The front matter is
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
    if (!render) return null;
    const heads = await codeHeadsOf(ctx, config, readRules);
    return renderedCopyFor(ctx, page, heads.get(page.path) ?? {});
  }
  const document = (await publicDocuments([page])).get(readingKey(page));
  if (document === undefined) return null;
  const head = await publicHead(ctx, page, document, readRules);
  // The stored copy without front matter, so a page whose stored fields
  // hold no words can be copied from its rendered page instead.
  const stored = copyOfDocument(page, document, head.title, {
    fields: await fieldsOf(ctx, page.holder.collection),
  });
  if (render && !holdsWords(stored)) {
    const rendered = await renderedCopyFor(ctx, page, head);
    if (rendered !== null) return rendered;
  }
  return withFrontMatter(aboutOf(page, head), stored);
}

/**
 * A page's plain-text copy from its published document: headed by the
 * page's own title, as the page shows it (and the field it is in, said
 * once), else `headTitle`, worked out from what the public may read;
 * without front matter, which each caller adds where it wants one.
 */
function copyOfDocument(
  page: ListedPage,
  document: Record<string, unknown>,
  headTitle: string | undefined,
  { fields }: { fields?: readonly CopyField[] | undefined }
): string {
  const titleField = TITLE_FIELDS.find(
    name => textOf(document[name]) !== undefined
  );
  const title =
    titleField === undefined ? headTitle : textOf(document[titleField]);
  return plainCopyOf({
    ...(title === undefined ? {} : { title }),
    ...(titleField === undefined ? {} : { titleField }),
    document,
    ...(fields === undefined ? {} : { fields }),
    base: page.loc,
  });
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
  const built = new Set(config.codeRoutes?.().map(route => route.path) ?? []);
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
      return (await rendersPages(ctx, config)) ? url.href : undefined;
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
 * The Proxy handler that answers a request for a page's plain-text copy:
 * a GET or HEAD of an address ending in `.md`, or of a page's own address
 * whose `Accept` header asks for Markdown over HTML. Every other request
 * passes untouched, and so does one for a copy that is not served. The copy
 * names its page as canonical, so search engines keep the page.
 */
export function plainCopyProxyHandler(
  config: AiOutputsConfig
): PluginProxyHandler {
  return {
    name: "plain-text-copies",
    async handle(request, ctx) {
      const asked = copyAskedFor(request);
      if (asked === undefined) return;
      const { url, atPage } = asked;
      // While the address record catches up, a page may not hold its address
      // yet: the request passes to the site as if no copy were served, and a
      // catch-up that failed is tried again.
      if (!addressRecordReady()) {
        retryFailedCatchUp();
        return;
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
