/**
 * Reading a content type's pages for the bulk edit screen and the import:
 * each page's name, address and version, what a person typed in its `seo`
 * group, and what its title and description are without anything typed,
 * worked out by the resolver's own reading of a page, so the table's grey
 * text and an import's "same as automatic" never disagree with the page.
 *
 * The automatic values are read with no share image looked up, since
 * neither the table nor the comparison needs one, with what each page's
 * route last supplied in code (`route-values`), so they are what the page is
 * served, and with the address record read once for every page of a read
 * rather than once a page.
 *
 * A content type is named by its key: a collection's slug, or
 * `single:<slug>` for a Single, whose one document is its one page.
 *
 * @module bulk/pages
 */
import {
  humanizeFieldName,
  NextlyError,
  publicAddressOf,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
  type PageMetadataInput,
  type PageMetadataValues,
  type PluginContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";

import { withAddressHolders } from "../address-record/participant";
import { idText } from "../import/records";
import { isRecord, textOf } from "../plain-values";
import { pageTypeOf } from "../problems/page-types";
import { resolveOrder, type Levels } from "../resolver/order";
import { levelsOf, type SiteRules } from "../resolver/page-levels";
import { readRouteValues, routeValuesKey } from "../route-values/store";
import { TITLE_FIELDS } from "../settings/patterns";
import { mediaReadFor } from "../tab/route";
import { SEO_GROUP, withoutTyped } from "../tab/typed";

import {
  readSingle,
  singleDeclaration,
  singleKeepsDrafts,
  type SingleAccess,
} from "./singles";

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
  /**
   * Its title and description without anything typed, and whether its
   * route's code hides it from search.
   */
  auto: { title?: string; description?: string; hiddenByCode?: true };
  /**
   * Every level of the order for the page with nothing typed, which the
   * page's answer for any typed values is worked out over.
   */
  levels: Levels;
}

/** What a read of pages needs beside the context. */
export interface PageReadOptions {
  /** Who the read is for: their access decides which pages are read. */
  as: ServiceOpts;
  /**
   * The same person as a Single's read takes them, where a Single is read:
   * through the Direct API, which names them by their identity.
   */
  singleAs?: SingleAccess;
  /** The language the pages are read in, where the site has several. */
  locale?: string;
  rules: SiteRules;
}

/** The type's declaration in the app's configuration, where it is there. */
function declarationOf(
  ctx: PluginContext,
  key: string
): Record<string, unknown> | undefined {
  const type = pageTypeOf(key);
  if (type.kind === "single") return singleDeclaration(ctx, type.slug);
  const slug = type.slug;
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
  return labelOfPage(ctx, slug, document);
}

/**
 * A page's own name: its type's title field, a usual one, else a Single's
 * own name, else its id.
 */
function labelOfPage(
  ctx: PluginContext,
  key: string,
  document: Readonly<Record<string, unknown>>
): string {
  const titleField = titleFieldOf(declarationOf(ctx, key));
  const named = [titleField, ...TITLE_FIELDS]
    .filter((name): name is string => name !== undefined)
    .map(name => textOf(document[name]))
    .find(value => value !== undefined);
  if (named !== undefined) return named;
  if (pageTypeOf(key).kind === "single") return typeNamesOf(ctx, key).singular;
  return idText(document.id) ?? "";
}

/**
 * A type's names for many pages and for one. A Single is one page, so both
 * are its own name, as it declares it (`label`, or `label.singular`).
 */
export function typeNamesOf(
  ctx: PluginContext,
  key: string
): { label: string; singular: string } {
  const declaration = declarationOf(ctx, key);
  const type = pageTypeOf(key);
  const readable = humanizeFieldName(type.slug);
  if (type.kind === "single") {
    const named = declaration?.label;
    const name =
      (isRecord(named) ? textOf(named.singular) : textOf(named)) ?? readable;
    return { label: name, singular: name };
  }
  const labels = isRecord(declaration?.labels) ? declaration.labels : {};
  const plural = textOf(labels.plural) ?? textOf(declaration?.label);
  const singular = textOf(labels.singular);
  return {
    label: plural ?? singular ?? readable,
    singular: singular ?? plural ?? readable,
  };
}

/**
 * Whether a change to a published page of the type is held as a working
 * draft: core's own answer, asked of the type's registered record, which
 * holds its versions resolved whether code or the Schema Builder made it.
 */
export async function keepsDrafts(
  ctx: PluginContext,
  key: string
): Promise<boolean> {
  const type = pageTypeOf(key);
  if (type.kind === "single") return singleKeepsDrafts(ctx, type.slug);
  const record = await ctx.services.collections.getCollection(type.slug, {});
  return (await resolvedCollectionDraftSplit(resolvedCollectionView(record)))
    .eligible;
}

/** The page's address, as its type forms it, or none. */
async function pathOf(
  key: string,
  document: Readonly<Record<string, unknown>>,
  locale: string | undefined
): Promise<string | undefined> {
  try {
    const address = await publicAddressOf(pageTypeOf(key), document, locale);
    return address.status === "resolved" ? address.path : undefined;
  } catch {
    // A type the address rules cannot read has no address to show; the
    // page is still listed.
    return undefined;
  }
}

/**
 * A page's levels with nothing typed, and its title and description then:
 * with `code`, what its route last supplied, at that level.
 */
async function automaticOf(
  ctx: PluginContext,
  key: string,
  document: Record<string, unknown>,
  options: PageReadOptions,
  code: PageMetadataValues
): Promise<Pick<ReadPage, "auto" | "levels">> {
  const type = pageTypeOf(key);
  const page = withoutTyped(document);
  const input: PageMetadataInput = {
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    source:
      type.kind === "single"
        ? { kind: "single", slug: type.slug, document: page }
        : { kind: "entry", collection: type.slug, entry: page },
    code,
    derived: {},
  };
  // No image is needed, so none is looked up.
  const levels = await levelsOf(mediaReadFor(ctx, false), input, options.rules);
  const answer = resolveOrder(levels);
  return {
    levels,
    auto: {
      ...(answer.title === undefined ? {} : { title: answer.title.value }),
      ...(answer.description === undefined
        ? {}
        : { description: answer.description.value }),
      ...(answer.robots.from === "code" ? { hiddenByCode: true } : {}),
    },
  };
}

/** Each stored entry of a read as one page. */
async function pagesOf(
  ctx: PluginContext,
  slug: string,
  entries: readonly unknown[],
  options: PageReadOptions
): Promise<ReadPage[]> {
  const documents = entries.filter(isRecord);
  const paths = await Promise.all(
    documents.map(document => pathOf(slug, document, options.locale))
  );
  const language =
    options.locale ?? (await ctx.publicAddresses.defaultLanguage());
  // What each page's route last supplied in code, one read for them all.
  const supplied = await readRouteValues(
    ctx,
    documents.map(document => ({
      type: slug,
      id: String(document.id),
      language,
    }))
  );
  const codeOf = (document: Record<string, unknown>) =>
    supplied.get(
      routeValuesKey({ type: slug, id: String(document.id), language })
    ) ?? {};
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
        label: labelOfPage(ctx, slug, document),
        ...(path === undefined ? {} : { path }),
        ...(slugValue === undefined ? {} : { slug: slugValue }),
        ...(typeof rev === "string" ? { rev } : {}),
        document,
        seo: isRecord(document[SEO_GROUP]) ? { ...document[SEO_GROUP] } : {},
        ...(await automaticOf(ctx, slug, document, options, codeOf(document))),
      });
    }
    return pages;
  });
}

/**
 * Who a Single is read as: the person the options name. A read of a Single
 * with no such person is refused rather than made as the system.
 */
function singleAsOf(options: PageReadOptions): SingleAccess {
  if (options.singleAs !== undefined) return options.singleAs;
  if (options.as.as === "system") return { overrideAccess: true };
  throw NextlyError.internal({
    logContext: { reason: "seo-bulk-single-reader-missing" },
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
  const type = pageTypeOf(slug);
  if (type.kind === "single") {
    // A Single's one document is its one page, on the first page of a read.
    const document = await readSingle(
      type.slug,
      singleAsOf(options),
      options.locale
    );
    const entries = document === undefined ? [] : [document];
    return {
      pages: await pagesOf(
        ctx,
        slug,
        options.page === 1 ? entries : [],
        options
      ),
      total: entries.length,
    };
  }
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
