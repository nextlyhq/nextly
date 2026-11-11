/**
 * The site's optional outputs for AI tools, both off until switched on in the
 * SEO settings: `/llms.txt`, a plain list of the site's pages, and a
 * plain-text copy of each listed page beside it.
 *
 * Both list exactly the pages the sitemap lists, read from the one listing,
 * and both answer every reader alike: no reader is told apart from another.
 * Neither can affect a page: llms.txt is its own file, and a copy is answered
 * only at a copy's address, never at a page's.
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
import { resolveIn, servedAt } from "../languages/versions";
import { originOf } from "../origin";
import { isRecord, textOf } from "../plain-values";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { TITLE_FIELDS } from "../settings/patterns";

import { listedPageAt, listPages, type ListedPage } from "./listing";
import { llmsTxt, type LlmsEntry } from "./llms-txt";
import {
  copyAddressOf,
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
 * The llms.txt of the site at `origin`, by the site's `rules`, or null while
 * it is switched off. Each page links to its plain-text copy where copies are
 * switched on, else to the page itself.
 */
export async function llmsTxtOf(
  ctx: PluginContext,
  origin: string,
  config: AiOutputsConfig,
  rules: SiteRules
): Promise<string | null> {
  if (rules.llmsTxt !== true) return null;
  const { pages } = await listPages(ctx, {
    origin,
    readRules: config.readRules,
    ...(config.collections === undefined
      ? {}
      : { collections: config.collections }),
  });
  const sections = await sectionsOf(ctx, pages);
  // Each page's copy, where copies are on and no page holds its address,
  // and no other page listed has the copy's name for itself: a page named
  // `index.html` keeps `index.html.md`, and its folder's page links itself.
  const copies =
    rules.plainTextCopies === true
      ? pages.map(page => copyAddressOf(page.loc))
      : [];
  const taken = await copiesTaken(ctx, copies);
  const copySet = new Set(copies);
  const literal = new Set(
    pages.map(page => `${page.loc}.md`).filter(copy => copySet.has(copy))
  );
  const linked = (at: number): string | undefined => {
    const copy = copies[at];
    const own = `${pages[at]?.loc}.md`;
    return copy === undefined ||
      taken.has(copy) ||
      (literal.has(copy) && copy !== own)
      ? undefined
      : copy;
  };
  // Each page's title and description as the public may read them; a page
  // the public may not read is listed by its address alone, as the sitemap
  // lists it.
  const readable = await publicDocuments(pages);
  const entries: LlmsEntry[] = [];
  for (const [at, page] of pages.entries()) {
    const document = readable.get(readingKey(page));
    const head =
      document === undefined
        ? {}
        : await publicHead(ctx, page, document, config.readRules);
    entries.push({
      section: sections.get(page.holder.collection) ?? SINGLES_SECTION,
      title: head.title ?? page.path,
      // A page the public may not read has no copy to link.
      url: (document === undefined ? undefined : linked(at)) ?? page.loc,
      ...(head.description === undefined
        ? {}
        : { description: head.description }),
    });
  }
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
    groups.set(group, [...(groups.get(group) ?? []), page]);
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
 * The language and kept path of each page a request for `url` may ask for a
 * copy of, in the order they are tried (`pagesOfCopy`). A path is kept
 * without its trailing slash, as the record keys it.
 */
async function pageAddressesAsked(
  url: URL
): Promise<{ locale: string; path: string }[]> {
  const asked: { locale: string; path: string }[] = [];
  for (const candidate of pagesOfCopy(url.pathname)) {
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

/** A listed page's plain-text copy, from its published document. */
async function copyOf(
  ctx: PluginContext,
  page: ListedPage,
  readRules: ReadRules
): Promise<string | null> {
  const document = (await publicDocuments([page])).get(readingKey(page));
  if (document === undefined) return null;
  // The page's own title, as the page shows it, and the field it is in;
  // else its head's, worked out from what the public may read.
  const titleField = TITLE_FIELDS.find(
    name => textOf(document[name]) !== undefined
  );
  const title =
    titleField === undefined
      ? (await publicHead(ctx, page, document, readRules)).title
      : textOf(document[titleField]);
  const fields = await fieldsOf(ctx, page.holder.collection);
  return plainCopyOf({
    ...(title === undefined ? {} : { title }),
    ...(titleField === undefined ? {} : { titleField }),
    document,
    ...(fields === undefined ? {} : { fields }),
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

/**
 * The plain-text copy asked for at `url`, or null where none is served
 * there: copies are switched off, the address is not a copy's, or no page
 * the sitemap lists is at the page address it names. The page is read at
 * the site's origin, as the sitemap lists it, whichever of the site's hosts
 * the request reached.
 */
async function plainCopyAt(
  ctx: PluginContext,
  url: URL,
  config: AiOutputsConfig
): Promise<{ body: string; page: ListedPage } | null> {
  const rules = await config.readRules(ctx, undefined);
  if (rules.plainTextCopies !== true) return null;
  // A page of the site's at the copy's address is served there instead.
  if ((await copiesTaken(ctx, [url.href])).size > 0) return null;
  const site = (await siteOriginFor(url.origin, ctx, config)) ?? url.origin;
  // The first listed page whose own copy this is: the page the name says
  // literally before the folder's own page, as llms.txt links them.
  for (const address of await pageAddressesAsked(url)) {
    // A language served on a domain of its own is listed on that domain.
    const own = originOf(await servedAt("/", address.locale));
    const origin = own === url.origin ? url.origin : site;
    const page = await listedPageAt(ctx, address.path, address.locale, {
      origin,
      readRules: config.readRules,
      ...(config.collections === undefined
        ? {}
        : { collections: config.collections }),
    });
    if (
      page === null ||
      new URL(copyAddressOf(page.loc)).pathname !== url.pathname
    ) {
      continue;
    }
    const body = await copyOf(ctx, page, config.readRules);
    return body === null ? null : { body, page };
  }
  return null;
}

/**
 * The Proxy handler that answers a request for a page's plain-text copy.
 * Only a GET or HEAD of an address ending in `.md` is looked at; every other
 * request passes untouched, and so does one for a copy that is not served.
 * The copy names its page as canonical, so search engines keep the page.
 */
export function plainCopyProxyHandler(
  config: AiOutputsConfig
): PluginProxyHandler {
  return {
    name: "plain-text-copies",
    async handle(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return;
      const url = new URL(request.url);
      if (!url.pathname.endsWith(".md")) return;
      // While the address record catches up, a page may not hold its address
      // yet: the request passes to the site as if no copy were served, and a
      // catch-up that failed is tried again.
      if (!addressRecordReady()) {
        retryFailedCatchUp();
        return;
      }
      const copy = await plainCopyAt(ctx, url, config);
      if (copy === null) return;
      return {
        response: new Response(request.method === "HEAD" ? null : copy.body, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            link: `<${copy.page.loc}>; rel="canonical"`,
          },
        }),
      };
    },
  };
}
