/**
 * The rows that hold the SEO of pages with no entry: read by address, the
 * page as the resolver reads it, what a route records when it calls the
 * metadata function, and what a person saves from the screen.
 *
 * @module code-pages/store
 */
import {
  NextlyError,
  type PageMetadataImage,
  type PageMetadataValues,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { sha256 } from "../address-record/rows";
import { isRecord, textOf } from "../plain-values";

import { CODE_PAGES_CACHE_PART, codePagesSlug } from "./collection";

/** A row, read back, every column checked rather than trusted. */
export interface CodePageRow {
  id: string;
  path: string;
  name?: string;
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: string;
  noindex: boolean;
  connected: boolean;
  /** What the route's code supplied when it last called, as its head used it. */
  code: PageMetadataValues;
  /**
   * When the route says the page last changed, as ISO text, from its
   * `openGraph.modifiedTime` when it last called: the page's sitemap date.
   */
  lastModified?: string;
}

/** The longest address kept; a longer one is not a page anyone links to. */
const LONGEST_ADDRESS = 2048;

/**
 * `path` as an address is kept: from the root, with no query or fragment,
 * and with no trailing slash but the root's. Nothing for anything else.
 */
export function codeAddressOf(path: string): string | undefined {
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  if (/[?#\s]/.test(path) || path.length > LONGEST_ADDRESS) return undefined;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * The name a page goes by where its route gives none, from its address:
 * `/thank-you` is "Thank you", and the root is "Home".
 */
export function nameOfAddress(path: string): string {
  const last = path.split("/").findLast(segment => segment !== "");
  if (last === undefined) return "Home";
  let words: string;
  try {
    words = decodeURIComponent(last);
  } catch {
    words = last;
  }
  words = words.replace(/[-_]+/g, " ").trim();
  return words === "" ? "Home" : words[0].toUpperCase() + words.slice(1);
}

/** A stored image, every part checked. */
function imageOf(value: unknown): PageMetadataImage | undefined {
  if (!isRecord(value)) return undefined;
  const url = textOf(value.url);
  if (url === undefined) return undefined;
  return {
    url,
    ...(typeof value.width === "number" ? { width: value.width } : {}),
    ...(typeof value.height === "number" ? { height: value.height } : {}),
    ...(textOf(value.alt) === undefined ? {} : { alt: String(value.alt) }),
  };
}

/**
 * Stored code values read back, each one checked rather than trusted. Also
 * how the values a content route supplies are kept (`route-values`), so the
 * two records read alike.
 */
export function codeValuesOf(value: unknown): PageMetadataValues {
  const stored = isRecord(value) ? value : {};
  const values: PageMetadataValues = {};
  for (const name of [
    "title",
    "description",
    "socialTitle",
    "socialDescription",
  ] as const) {
    const text = textOf(stored[name]);
    if (text !== undefined) values[name] = text;
  }
  const image = imageOf(stored.image);
  if (image !== undefined) values.image = image;
  // The route's code hid the page: kept, so the sitemap and the screen read
  // the page hidden as it is served.
  if (stored.hidden === true) values.hidden = true;
  return values;
}

/** A date as ISO text, where `value` is one. */
function isoDateOf(value: unknown): string | undefined {
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The date a route states its page last changed: its metadata's
 * `openGraph.modifiedTime`, as ISO text. Nothing where it states none: a
 * page built in code is never given the time of a build or a request.
 */
export function statedDateOf(metadata: unknown): string | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.openGraph)) return undefined;
  return isoDateOf(metadata.openGraph.modifiedTime);
}

/** JSON with object keys sorted, so equal values are equal text. */
export function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        )
      : inner
  );
}

/** A row read back. */
function codePageRowOf(entry: unknown): CodePageRow {
  const row = isRecord(entry) ? entry : {};
  const optional = (name: string, value: unknown) => {
    const text = textOf(value);
    return text === undefined ? {} : { [name]: text };
  };
  return {
    id: String(row.id),
    path: typeof row.path === "string" ? row.path : "",
    ...optional("name", row.name),
    ...optional("metaTitle", row.metaTitle),
    ...optional("metaDescription", row.metaDescription),
    ...optional("ogImage", row.ogImage),
    noindex: row.noindex === true,
    connected: row.connected === true,
    code: codeValuesOf(row.codeValues),
    // Kept beside the code values, in the same stored JSON.
    ...optional(
      "lastModified",
      isRecord(row.codeValues)
        ? isoDateOf(row.codeValues.lastModified)
        : undefined
    ),
  };
}

/** The row holding the SEO of `path`, where there is one. */
export async function readCodePage(
  ctx: PluginContext,
  path: string
): Promise<CodePageRow | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    codePagesSlug(ctx),
    {
      where: { pathKey: { equals: sha256(path) } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [entry] = data as unknown[];
  return entry === undefined ? undefined : codePageRowOf(entry);
}

/** How many rows one read takes. */
const PAGE = 200;

/** Every row, by address. */
export async function readCodePages(
  ctx: PluginContext
): Promise<Map<string, CodePageRow>> {
  const rows = new Map<string, CodePageRow>();
  for (let page = 1; ; page++) {
    const result = await ctx.services.ownCollections.listEntries(
      codePagesSlug(ctx),
      {
        sort: { field: "id", direction: "asc" },
        pagination: { limit: PAGE, page },
        depth: 0,
      }
    );
    for (const entry of result.data as unknown[]) {
      const row = codePageRowOf(entry);
      rows.set(row.path, row);
    }
    if (!result.pagination.hasMore) return rows;
  }
}

/**
 * The page with no entry at `path` as the resolver reads a page: its name
 * where `{Title}` reads one, and what a person typed in the shape of an
 * entry's `seo` group, so the one order of who wins answers it as it
 * answers every other page.
 */
export function codePageDocument(
  path: string,
  row: CodePageRow | undefined,
  name: string | undefined,
  lastModified?: string
): Record<string, unknown> {
  return {
    id: row?.id ?? "",
    path,
    title: name ?? row?.name ?? nameOfAddress(path),
    // The date the route states, recorded with its call.
    ...(lastModified === undefined ? {} : { lastModified }),
    seo: {
      ...(row?.metaTitle === undefined ? {} : { metaTitle: row.metaTitle }),
      ...(row?.metaDescription === undefined
        ? {}
        : { metaDescription: row.metaDescription }),
      ...(row?.ogImage === undefined ? {} : { ogImage: row.ogImage }),
      noindex: row?.noindex === true,
    },
  };
}

/** Make the row for `path` or change it, as one write either way. */
async function upsert(
  ctx: PluginContext,
  path: string,
  values: Record<string, unknown>
): Promise<void> {
  const slug = codePagesSlug(ctx);
  const existing = await readCodePage(ctx, path);
  if (existing !== undefined) {
    // Applied over whatever version is current: the row is the plugin's
    // own bookkeeping, never edited beside it.
    await ctx.services.collections.updateEntry(slug, existing.id, {
      ...values,
      _overwrite: true,
    });
    return;
  }
  try {
    await ctx.services.collections.createEntry(slug, {
      pathKey: sha256(path),
      path,
      ...values,
    });
  } catch (error) {
    // Another request made the row first: change that one.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    const made = await readCodePage(ctx, path);
    if (made === undefined) throw error;
    await ctx.services.collections.updateEntry(slug, made.id, {
      ...values,
      _overwrite: true,
    });
  }
}

/** What a route's call says about the page it serves. */
export interface Connection {
  name?: string;
  /** The values the route's code supplied, as the page's head reads them. */
  code: PageMetadataValues;
  /** When the route says the page last changed, as ISO text. */
  lastModified?: string;
}

/** Whether `row` already says what `connection` would record. */
export function recorded(
  row: CodePageRow | undefined,
  connection: Connection
): boolean {
  return (
    row !== undefined &&
    row.connected &&
    row.name === connection.name &&
    row.lastModified === connection.lastModified &&
    sortedJson(row.code) === sortedJson(codeValuesOf(connection.code))
  );
}

/**
 * Record that the route serving `path` calls the metadata function, with
 * what its code supplies. Written only where it changes something, so a
 * route rendering again writes nothing.
 */
export async function recordConnection(
  ctx: PluginContext,
  path: string,
  row: CodePageRow | undefined,
  connection: Connection
): Promise<void> {
  if (recorded(row, connection)) return;
  await upsert(ctx, path, {
    connected: true,
    name: connection.name ?? null,
    codeValues: {
      ...codeValuesOf(connection.code),
      ...(connection.lastModified === undefined
        ? {}
        : { lastModified: connection.lastModified }),
    },
  });
}

/** What a person saves for a page with no entry; blank text is no value. */
export interface TypedValues {
  title: string;
  description: string;
  hidden: boolean;
  image?: string | null;
}

/**
 * Save what a person typed for `path`, and expire every page head built
 * from it, so the page serves it from its next visit.
 */
export async function saveTypedValues(
  ctx: PluginContext,
  path: string,
  values: TypedValues
): Promise<void> {
  await upsert(ctx, path, {
    metaTitle: textOf(values.title) ?? null,
    metaDescription: textOf(values.description) ?? null,
    noindex: values.hidden,
    ...(values.image === undefined
      ? {}
      : { ogImage: textOf(values.image) ?? null }),
  });
  await ctx.cache.expire(CODE_PAGES_CACHE_PART);
}
