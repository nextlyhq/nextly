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
  type PluginContext,
  type PluginProxyHandler,
} from "@nextlyhq/plugin-sdk";

import { addressRecordReady } from "../address-record/catch-up";
import { documentsIn, singleIn } from "../languages/versions";
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
  const entries: LlmsEntry[] = pages.map(page => ({
    section: sections.get(page.holder.collection) ?? SINGLES_SECTION,
    title: page.title ?? page.path,
    url: rules.plainTextCopies === true ? copyAddressOf(page.loc) : page.loc,
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

/** The published page a listed page is, as a visitor is served it. */
async function documentOf(
  ctx: PluginContext,
  page: ListedPage
): Promise<Record<string, unknown> | undefined> {
  const { collection, id } = page.holder;
  if (collection.startsWith("single:")) {
    const document = await singleIn(
      collection.slice("single:".length),
      page.language
    );
    return document ?? undefined;
  }
  return (
    await documentsIn(
      ctx,
      { kind: "collection", slug: collection },
      [id],
      page.language
    )
  ).get(id);
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
  const document = await documentOf(ctx, page);
  if (document === undefined) return null;
  // The page's own title, as the page shows it; its head's where it has none.
  const title =
    TITLE_FIELDS.map(name => textOf(document[name])).find(
      value => value !== undefined
    ) ?? page.title;
  const fields = await fieldsOf(ctx, page.holder.collection);
  return plainCopyOf({
    ...(title === undefined ? {} : { title }),
    document,
    ...(fields === undefined ? {} : { fields }),
  });
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
  // One address per copy: the one the page's own address gives.
  if (
    page === null ||
    new URL(copyAddressOf(page.loc)).pathname !== url.pathname
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
      // yet: the request passes to the site as if no copy were served.
      if (!addressRecordReady()) return;
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
