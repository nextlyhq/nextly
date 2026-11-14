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
import { llmsTxt, type LlmsEntry } from "./llms-txt";
import {
  copyAddressOf,
  copyPathsOf,
  pagesOfCopy,
  plainCopyOf,
  type CopyField,
} from "./plain-copy";
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
  rules: SiteRules
): Promise<(at: number) => string | undefined> {
  if (rules.plainTextCopies !== true) return () => undefined;
  const copies = pages.map(page => copyAddressOf(page.loc));
  const taken = await copiesTaken(ctx, copies);
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

/**
 * Each listed page's title and description as the public may read them,
 * and whether the public may read it at all, by its place in `pages`. A page
 * built in code has no entry: its head is the SEO set for its address, which
 * every visitor's page already carries.
 */
async function listedHeads(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  config: AiOutputsConfig,
  readRules: ReadRules
): Promise<
  (at: number) => { title?: string; description?: string; readable: boolean }
> {
  const codeSlug = codePagesSlug(ctx);
  const readable = await publicDocuments(
    pages.filter(page => page.holder.collection !== codeSlug)
  );
  const heads = await publicHeads(ctx, pages, readable, readRules);
  const codeHeads = await codeHeadsOf(ctx, config, readRules);
  return at => {
    const page = pages[at];
    if (page === undefined) return { readable: false };
    if (page.holder.collection === codeSlug) {
      return { ...codeHeads.get(page.path), readable: false };
    }
    return {
      ...heads.get(at),
      readable: readable.has(readingKey(page)),
    };
  };
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
  // The site's rules read once per language for the whole file, as the
  // listing reads them, not once a page.
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
  const sections = await sectionsOf(ctx, pages);
  const linked = await linkedCopies(ctx, pages, rules);
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
    name: rules.siteName ?? new URL(origin).host,
    ...(rules.description === undefined
      ? {}
      : { description: rules.description }),
    entries,
  });
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
 * host, in their order. A path is kept without its trailing slash, as the
 * record keys it.
 */
async function pageAddressesAsked(
  url: URL,
  candidates: readonly string[]
): Promise<{ locale: string; path: string }[]> {
  const asked: { locale: string; path: string }[] = [];
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
    });
  }
  return asked;
}

/**
 * A listed page's plain-text copy, from its published document: its front
 * matter from the head the public may read and the sitemap's last change.
 */
async function copyOf(
  ctx: PluginContext,
  page: ListedPage,
  readRules: ReadRules
): Promise<string | null> {
  const document = (await publicDocuments([page])).get(readingKey(page));
  if (document === undefined) return null;
  const head = await publicHead(ctx, page, document, readRules);
  // The page's own title, as the page shows it, and the field it is in;
  // else its head's, worked out from what the public may read.
  const titleField = TITLE_FIELDS.find(
    name => textOf(document[name]) !== undefined
  );
  const title =
    titleField === undefined ? head.title : textOf(document[titleField]);
  const fields = await fieldsOf(ctx, page.holder.collection);
  return plainCopyOf({
    ...(title === undefined ? {} : { title }),
    ...(titleField === undefined ? {} : { titleField }),
    document,
    ...(fields === undefined ? {} : { fields }),
    base: page.loc,
    about: {
      ...(head.title === undefined ? {} : { title: head.title }),
      ...(head.description === undefined
        ? {}
        : { description: head.description }),
      url: page.loc,
      ...(page.lastModified === undefined
        ? {}
        : { lastUpdated: page.lastModified }),
    },
  });
}

/**
 * Which of `copies`, copy addresses, a page of the site holds itself, such
 * as a page whose address is `/guide.md`: that page is served there, so no
 * copy is, and none is linked. One read of the record per language.
 */
async function copiesTaken(
  ctx: PluginContext,
  copies: readonly string[]
): Promise<Set<string>> {
  const byLanguage = new Map<string, { copy: string; path: string }[]>();
  for (const copy of copies) {
    const address = await addressOfRequest(new URL(copy));
    if (address === undefined) continue;
    const list = byLanguage.get(address.locale) ?? [];
    list.push({ copy, path: address.path });
    byLanguage.set(address.locale, list);
  }
  const taken = new Set<string>();
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
  const { pathname } = new URL(page.loc);
  return pathname === url.pathname || pathname === `${url.pathname}/`;
}

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
    const page = await listedPageAt(ctx, address.path, address.locale, {
      origin: own === url.origin ? url.origin : site,
      readRules: config.readRules,
      ...(config.collections === undefined
        ? {}
        : { collections: config.collections }),
    });
    if (page !== null && asksFor(page, url, atPage)) return page;
  }
  return null;
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
  if (!atPage && (await copiesTaken(ctx, [url.href])).size > 0) return null;
  const candidates = atPage ? [url.pathname] : pagesOfCopy(url.pathname);
  const page = await pageAsked(ctx, url, config, candidates, atPage);
  if (page === null) return null;
  const body = await copyOf(ctx, page, config.readRules);
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
  const html = types.find(each => each.type === "text/html");
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
      if (request.method !== "GET" && request.method !== "HEAD") return;
      const url = new URL(request.url);
      const atPage =
        !url.pathname.endsWith(".md") &&
        prefersMarkdown(request.headers.get("accept"));
      if (!url.pathname.endsWith(".md") && !atPage) return;
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
