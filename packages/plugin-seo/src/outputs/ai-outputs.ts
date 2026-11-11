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
import { isRecord, textOf } from "../plain-values";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { TITLE_FIELDS } from "../settings/patterns";

import { listedPageAt, listPages, type ListedPage } from "./listing";
import { llmsTxt, type LlmsEntry } from "./llms-txt";
import {
  copyAddressOf,
  pageAddressOfCopy,
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
  // Each page's copy, where copies are on and no page holds its address.
  const copies =
    rules.plainTextCopies === true
      ? pages.map(page => copyAddressOf(page.loc))
      : [];
  const taken = await copiesTaken(ctx, copies);
  const entries: LlmsEntry[] = pages.map((page, at) => ({
    section: sections.get(page.holder.collection) ?? SINGLES_SECTION,
    title: page.title ?? page.path,
    url:
      copies[at] !== undefined && !taken.has(copies[at])
        ? copies[at]
        : page.loc,
    ...(page.description === undefined
      ? {}
      : { description: page.description }),
  }));
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

/**
 * The published page a listed page is, read as a visitor with no session
 * reads it: the type's and each field's read access decide what is in it,
 * so a copy never holds more than the public may read. None where the
 * public may not read the page at all.
 */
async function documentOf(
  page: ListedPage
): Promise<Record<string, unknown> | undefined> {
  const { collection, id } = page.holder;
  try {
    const nextly = await getCachedNextly();
    if (collection.startsWith("single:")) {
      const document: unknown = await nextly.findSingle({
        slug: collection.slice("single:".length),
        createIfMissing: false,
        overrideAccess: false,
        status: "published",
        depth: 1,
        locale: page.language,
      });
      return isRecord(document) ? document : undefined;
    }
    const result = await nextly.find({
      collection,
      where: { id: { equals: id } },
      overrideAccess: false,
      status: "published",
      depth: 1,
      limit: 1,
      locale: page.language,
    });
    const [document] = (result.items as unknown[]).filter(isRecord);
    return document;
  } catch (error) {
    // A page the public may not read, or no longer finds, has no copy.
    if (
      NextlyError.isCode(error, "FORBIDDEN") ||
      NextlyError.isCode(error, "AUTH_REQUIRED") ||
      NextlyError.isCode(error, "NOT_FOUND")
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The language and kept path of the page a request for `url` asks for a copy
 * of, or nothing where `url` is not a copy's address. A path is kept without
 * its trailing slash, as the record keys it.
 */
async function pageAddressAsked(
  url: URL
): Promise<{ locale: string; path: string } | undefined> {
  const asked = pageAddressOfCopy(url.pathname);
  if (asked === undefined) return undefined;
  const pageUrl = new URL(url.href);
  pageUrl.pathname = asked;
  pageUrl.search = "";
  const address = await addressOfRequest(pageUrl);
  if (address === undefined) return undefined;
  const { locale, path } = address;
  return {
    locale,
    path: path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path,
  };
}

/** A listed page's plain-text copy, from its published document. */
async function copyOf(
  ctx: PluginContext,
  page: ListedPage
): Promise<string | null> {
  const document = await documentOf(page);
  if (document === undefined) return null;
  // The page's own title, as the page shows it, and the field it is in;
  // its head's where it has none.
  const titleField = TITLE_FIELDS.find(
    name => textOf(document[name]) !== undefined
  );
  const title =
    titleField === undefined ? page.title : textOf(document[titleField]);
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
  const address = await pageAddressAsked(url);
  if (address === undefined) return null;
  const origin = (await siteOriginFor(url.origin, ctx, config)) ?? url.origin;
  const page = await listedPageAt(ctx, address.path, address.locale, {
    origin,
    readRules: config.readRules,
    ...(config.collections === undefined
      ? {}
      : { collections: config.collections }),
  });
  // One address per copy: the one the page's own address gives, and only
  // where no page of the site's holds that address itself.
  if (
    page === null ||
    new URL(copyAddressOf(page.loc)).pathname !== url.pathname ||
    (await copiesTaken(ctx, [url.href])).size > 0
  ) {
    return null;
  }
  const body = await copyOf(ctx, page);
  return body === null ? null : { body, page };
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
