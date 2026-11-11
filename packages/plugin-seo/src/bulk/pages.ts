/**
 * Reading a content type's pages for the bulk edit screen and the import:
 * each page's name, address and version, what a person typed in its `seo`
 * group, and what its title and description are without anything typed,
 * worked out by the resolver's own reading of a page, so the table's grey
 * text and an import's "same as automatic" never disagree with the page.
 *
 * The automatic values are read with no share image looked up, since
 * neither the table nor the comparison needs one, and with the address
 * record read once for every page of a read rather than once a page.
 *
 * @module bulk/pages
 */
import {
  humanizeFieldName,
  publicAddressOf,
  type PageMetadataInput,
  type PluginContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";

import { withAddressHolders } from "../address-record/participant";
import { idText } from "../import/records";
import { isRecord, textOf } from "../plain-values";
import { resolveOrder } from "../resolver/order";
import { levelsOf, type SiteRules } from "../resolver/page-levels";
import { TITLE_FIELDS } from "../settings/patterns";
import { mediaReadFor } from "../tab/route";
import { SEO_GROUP, withoutTyped } from "../tab/typed";

/** One page as the bulk edit screen and the import read it. */
export interface ReadPage {
  type: string;
  id: string;
  label: string;
  /** Its public address, without an origin, where its type declares one. */
  path?: string;
  /** Its `slug` field, where it has one. */
  slug?: string;
  /** The version it was read at. */
  rev?: string;
  /** The page as stored, in the language it was read in. */
  document: Record<string, unknown>;
  /** Its `seo` group's values, or none. */
  seo: Record<string, unknown>;
  /** Its title and description without anything typed. */
  auto: { title?: string; description?: string };
}

/** What a read of pages needs beside the context. */
export interface PageReadOptions {
  /** Who the read is for: their access decides which pages are read. */
  as: ServiceOpts;
  /** The language the pages are read in, where the site has several. */
  locale?: string;
  rules: SiteRules;
}

/** The type's declaration in the app's configuration, where it is there. */
function declarationOf(
  ctx: PluginContext,
  slug: string
): Record<string, unknown> | undefined {
  const declared: readonly unknown[] = ctx.config.collections ?? [];
  return declared.find(
    (entity): entity is Record<string, unknown> =>
      isRecord(entity) && entity.slug === slug
  );
}

/** The field a type names its pages by, where it declares one. */
function titleFieldOf(
  declaration: Record<string, unknown> | undefined
): string | undefined {
  const admin = isRecord(declaration?.admin) ? declaration.admin : {};
  return textOf(admin.useAsTitle);
}

/** A page of `slug`'s own name, as {@link labelOfPage} reads it. */
export function pageLabel(
  ctx: PluginContext,
  slug: string,
  document: Readonly<Record<string, unknown>>
): string {
  return labelOfPage(document, titleFieldOf(declarationOf(ctx, slug)));
}

/** A page's own name: its type's title field, a usual one, else its id. */
function labelOfPage(
  document: Readonly<Record<string, unknown>>,
  titleField: string | undefined
): string {
  const named = [titleField, ...TITLE_FIELDS]
    .filter((name): name is string => name !== undefined)
    .map(name => textOf(document[name]))
    .find(value => value !== undefined);
  return named ?? idText(document.id) ?? "";
}

/** A type's names for many pages and for one. */
export function typeNamesOf(
  ctx: PluginContext,
  slug: string
): { label: string; singular: string } {
  const declaration = declarationOf(ctx, slug);
  const labels = isRecord(declaration?.labels) ? declaration.labels : {};
  const plural = textOf(labels.plural) ?? textOf(declaration?.label);
  const singular = textOf(labels.singular);
  const readable = humanizeFieldName(slug);
  return {
    label: plural ?? singular ?? readable,
    singular: singular ?? plural ?? readable,
  };
}

/**
 * Whether a change to a published page of the type is held as a draft:
 * where it has both the draft and published lifecycle and versions that
 * keep drafts, as the type declares them.
 */
export function keepsDrafts(ctx: PluginContext, slug: string): boolean {
  const declaration = declarationOf(ctx, slug);
  if (declaration?.status !== true) return false;
  const versions = declaration.versions;
  if (versions === true) return true;
  return isRecord(versions) && versions.drafts !== false;
}

/** The page's address, as its type forms it, or none. */
async function pathOf(
  slug: string,
  document: Readonly<Record<string, unknown>>,
  locale: string | undefined
): Promise<string | undefined> {
  try {
    const address = await publicAddressOf(
      { kind: "collection", slug },
      document,
      locale
    );
    return address.status === "resolved" ? address.path : undefined;
  } catch {
    // A type the address rules cannot read has no address to show; the
    // page is still listed.
    return undefined;
  }
}

/** A page's title and description with nothing typed. */
async function automaticOf(
  ctx: PluginContext,
  slug: string,
  document: Record<string, unknown>,
  options: PageReadOptions
): Promise<ReadPage["auto"]> {
  const input: PageMetadataInput = {
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    source: { kind: "entry", collection: slug, entry: withoutTyped(document) },
    code: {},
    derived: {},
  };
  // No image is needed, so none is looked up.
  const answer = resolveOrder(
    await levelsOf(mediaReadFor(ctx, false), input, options.rules)
  );
  return {
    ...(answer.title === undefined ? {} : { title: answer.title.value }),
    ...(answer.description === undefined
      ? {}
      : { description: answer.description.value }),
  };
}

/** Each stored entry of a read as one page. */
async function pagesOf(
  ctx: PluginContext,
  slug: string,
  entries: readonly unknown[],
  options: PageReadOptions
): Promise<ReadPage[]> {
  const titleField = titleFieldOf(declarationOf(ctx, slug));
  const documents = entries.filter(isRecord);
  const paths = await Promise.all(
    documents.map(document => pathOf(slug, document, options.locale))
  );
  const language =
    options.locale ?? (await ctx.publicAddresses.defaultLanguage());
  const known = paths.filter((path): path is string => path !== undefined);
  return withAddressHolders(ctx, language, known, async () => {
    const pages: ReadPage[] = [];
    for (const [at, document] of documents.entries()) {
      const path = paths[at];
      const slugValue = textOf(document.slug);
      const rev = document._rev;
      pages.push({
        type: slug,
        id: String(document.id),
        label: labelOfPage(document, titleField),
        ...(path === undefined ? {} : { path }),
        ...(slugValue === undefined ? {} : { slug: slugValue }),
        ...(typeof rev === "string" ? { rev } : {}),
        document,
        seo: isRecord(document[SEO_GROUP]) ? { ...document[SEO_GROUP] } : {},
        auto: await automaticOf(ctx, slug, document, options),
      });
    }
    return pages;
  });
}

/** How many entries one read asks for. */
const READ_PAGE = 200;

/**
 * One page of a type's entries, newest first, read as `options.as`, with
 * how many there are in all.
 */
export async function readPages(
  ctx: PluginContext,
  slug: string,
  options: PageReadOptions & { page: number; limit: number }
): Promise<{ pages: ReadPage[]; total: number }> {
  const result = await ctx.services.collections.listEntries(
    slug,
    {
      depth: 0,
      sort: { field: "createdAt", direction: "desc" },
      pagination: { limit: options.limit, page: options.page },
    },
    {
      ...options.as,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    }
  );
  const total = result.pagination.total;
  return {
    pages: await pagesOf(ctx, slug, result.data, options),
    total: typeof total === "number" ? total : result.data.length,
  };
}

/** Every entry of a type, read page by page as `options.as`. */
export async function readEveryPage(
  ctx: PluginContext,
  slug: string,
  options: PageReadOptions
): Promise<ReadPage[]> {
  const pages: ReadPage[] = [];
  for (let page = 1; ; page++) {
    const read = await readPages(ctx, slug, {
      ...options,
      page,
      limit: READ_PAGE,
    });
    pages.push(...read.pages);
    if (read.pages.length < READ_PAGE || pages.length >= read.total) {
      return pages;
    }
  }
}
