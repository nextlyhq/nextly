/**
 * The content types the SEO settings screen lists: each type the plugin adds
 * SEO to, the variables its title pattern may use, an example page to preview
 * a pattern with, and whether the type has a public address yet.
 *
 * @module settings/content-types-route
 */
import {
  addressableFields,
  humanizeFieldName,
  NextlyError,
  publicAddressOf,
  respondDoc,
  respondList,
  typesWithoutAddress,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { originsFrom, PRODUCTION_ADDRESSES_ENV } from "../canonical";
import { siteWide } from "../permissions";
import { isRecord, textOf } from "../plain-values";

import {
  CONTENT_TYPES_ROUTE_PATH,
  SEO_SETTINGS_SLUG,
  SETTINGS_DOCUMENT_ROUTE_PATH,
  type SettingsDocumentBody,
  type MappableField,
  type PatternExample,
  type PatternField,
  type ListedContentType,
  type SeoContentType,
  type SwitchedOffType,
} from "./contract";
import { patternFields } from "./pattern-fields";
import { TITLE_FIELDS } from "./patterns";

/** The example a stored page gives for `fields`. */
function exampleOf(
  document: Readonly<Record<string, unknown>>,
  fields: readonly PatternField[]
): PatternExample {
  const title = TITLE_FIELDS.map(name => textOf(document[name])).find(
    value => value !== undefined
  );
  const values: Record<string, string | number> = {};
  for (const { name } of fields) {
    const value = document[name];
    if (typeof value === "number") values[name] = value;
    else if (textOf(value) !== undefined) values[name] = String(value);
  }
  return { ...(title === undefined ? {} : { title }), values };
}

/** A field's label as the admin shows it. */
const labelOfField = (field: Record<string, unknown>, name: string): string =>
  textOf(field.label) ?? humanizeFieldName(name);

/**
 * The type's own fields a structured data detail may be read from: every
 * field the entry itself holds but its SEO group, labelled as the admin
 * labels it, and each field inside a named group by its path
 * (`event.startsAt`), which a detail reads as it reads any other.
 */
function mappableFieldsOf(
  declared: readonly Record<string, unknown>[],
  within?: MappableField
): MappableField[] {
  const fields: MappableField[] = [];
  for (const field of declared) {
    const own = mappableField(field, within);
    if (own === undefined) continue;
    fields.push(own);
    if (field.type === "group") {
      fields.push(...mappableFieldsOf(entryFields(field.fields), own));
    }
  }
  return fields;
}

/** One field as a mapping choice, inside `within` where it is in a group. */
function mappableField(
  field: Record<string, unknown>,
  within: MappableField | undefined
): MappableField | undefined {
  const { name } = field;
  if (typeof name !== "string" || name === "") return undefined;
  if (within === undefined) {
    return name === "seo"
      ? undefined
      : { name, label: labelOfField(field, name) };
  }
  return {
    name: `${within.name}.${name}`,
    label: `${within.label} › ${labelOfField(field, name)}`,
  };
}

/**
 * The fields an entry holds at one level, through groups with no name that
 * only lay fields out, as core reads them.
 */
function entryFields(fields: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const field of addressableFields(fields)) {
    if (isRecord(field)) found.push(field);
  }
  return found;
}

/** The label the admin's lists use for a collection. */
function labelOf(slug: string, meta: Record<string, unknown>): string {
  const labels = isRecord(meta.labels) ? meta.labels : {};
  return (
    textOf(labels.plural) ??
    textOf(labels.singular) ??
    textOf(meta.label) ??
    slug
  );
}

/** What the person asking may read of a type: its newest entry and how many there are. */
interface ReadableEntries {
  newest?: Record<string, unknown>;
  count?: number;
}

/**
 * The newest entry of `slug` the person asking may read, and how many they
 * may read, from one read as them, so the collection's row and field rules
 * decide both; nothing where they may read none.
 */
async function readableEntries(
  ctx: PluginRouteContext,
  slug: string
): Promise<ReadableEntries> {
  if (ctx.user === null) return {};
  try {
    const page = await ctx.services.collections.listEntries(
      slug,
      {
        depth: 0,
        sort: { field: "updatedAt", direction: "desc" },
        pagination: { limit: 1, page: 1 },
      },
      { as: "user", user: ctx.user }
    );
    const first: unknown = page.data[0];
    const total: unknown = page.pagination.total;
    return {
      ...(isRecord(first) ? { newest: first } : {}),
      ...(typeof total === "number" ? { count: total } : {}),
    };
  } catch (error) {
    // A reader refused the type's entries gets no preview page and no
    // count, not an error.
    if (NextlyError.isCode(error, "FORBIDDEN")) return {};
    throw error;
  }
}

/** One content type as the screen lists it, for this reader. */
async function contentTypeOf(
  ctx: PluginRouteContext,
  slug: string,
  withoutAddress: ReadonlySet<string>
): Promise<SeoContentType> {
  const meta: unknown = await ctx.services.collections.getCollection(slug, {});
  const record = isRecord(meta) ? meta : {};
  const declared = entryFields(record.fields);
  const fields = patternFields(
    declared.map(field => ({
      name: typeof field.name === "string" ? field.name : undefined,
      type: typeof field.type === "string" ? field.type : "",
      label: field.label,
    }))
  );
  const mappableFields = mappableFieldsOf(declared);
  const isPublic = !withoutAddress.has(slug);
  // An example only from what the reader may read of the type's entries: the
  // settings permission alone must not show them a page's title.
  const { newest: entry, count } = await readableEntries(ctx, slug);
  let example: PatternExample | undefined;
  if (entry !== undefined) {
    example = exampleOf(entry, fields);
    if (isPublic) {
      const address = await publicAddressOf(
        { kind: "collection", slug },
        entry
      );
      if (address.status === "resolved") example.address = address.path;
    }
  }
  return {
    key: slug,
    label: labelOf(slug, record),
    fields,
    mappableFields,
    ...(example === undefined ? {} : { example }),
    ...(count === undefined ? {} : { count }),
    public: isPublic,
  };
}

/**
 * A listed collection and its slug where it is the site's own, declared in code or
 * made in the Schema Builder; nothing for a plugin's or the system's.
 */
function siteOwn(
  record: unknown
): { slug: string; row: Record<string, unknown> } | undefined {
  if (!isRecord(record)) return undefined;
  if (record.source !== "code" && record.source !== "ui") return undefined;
  const slug = textOf(record.slug) ?? textOf(record.name);
  return slug === undefined ? undefined : { slug, row: record };
}

/** How many types without SEO are counted at once. */
const COUNTED_AT_ONCE = 8;

/** How many collections one listing reads while finding the site's own. */
const LISTING_PAGE = 100;

/**
 * The site's own collections, declared in code or made in the Schema
 * Builder, that the plugin does not add SEO to: never a plugin's own or the
 * system's, which have no SEO switch to show. Sorted by slug.
 */
async function switchedOff(
  ctx: PluginRouteContext,
  withSeo: ReadonlySet<string>,
  withoutAddress: ReadonlySet<string>
): Promise<SwitchedOffType[]> {
  const found: SwitchedOffType[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await ctx.services.collections.listCollections(
      { page, limit: LISTING_PAGE, sortBy: "slug", sortOrder: "asc" },
      {}
    );
    const owns = listed.data
      .map(siteOwn)
      .filter(
        (own): own is NonNullable<typeof own> =>
          own !== undefined && !withSeo.has(own.slug)
      );
    // Counted a few at a time, so one slow type does not hold up the rest.
    for (let at = 0; at < owns.length; at += COUNTED_AT_ONCE) {
      const batch = owns.slice(at, at + COUNTED_AT_ONCE);
      const counts = await Promise.all(
        batch.map(({ slug }) => readableEntries(ctx, slug))
      );
      batch.forEach(({ slug, row }, index) => {
        const count = counts[index]?.count;
        found.push({
          key: slug,
          label: labelOf(slug, row),
          ...(count === undefined ? {} : { count }),
          public: !withoutAddress.has(slug),
          seo: false,
        });
      });
    }
    if (!listed.pagination.hasMore) return found;
  }
}

/**
 * The route that lists `collections`, the types the plugin adds SEO to, and
 * after them the site's other types, marked as having none.
 */
export function contentTypesRoute(collections: readonly string[]): PluginRoute {
  return siteWide({
    method: "GET",
    path: CONTENT_TYPES_ROUTE_PATH,
    // Whoever may read the SEO settings may see what they apply to: the
    // Single's read, and site-wide SEO.
    requiredPermission: ({ single }) => single(SEO_SETTINGS_SLUG, "read"),
    handler: async (_req, ctx) => {
      const withoutAddress = new Set(
        (await typesWithoutAddress())
          .filter(type => type.kind === "collection")
          .map(type => type.slug)
      );
      const items: ListedContentType[] = [];
      for (const slug of collections) {
        items.push(await contentTypeOf(ctx, slug, withoutAddress));
      }
      items.push(
        ...(await switchedOff(ctx, new Set(collections), withoutAddress))
      );
      return respondList(items, {
        total: items.length,
        page: 1,
        limit: Math.max(items.length, 1),
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    },
  });
}

/**
 * The route that names the Single holding the settings, as the host
 * registered it, so the screen reads and saves the renamed one.
 */
export function settingsDocumentRoute(): PluginRoute {
  return siteWide({
    method: "GET",
    path: SETTINGS_DOCUMENT_ROUTE_PATH,
    requiredPermission: ({ single }) => single(SEO_SETTINGS_SLUG, "read"),
    handler: (_req, ctx) => {
      const body: SettingsDocumentBody = {
        single: ctx.self.singles[SEO_SETTINGS_SLUG] ?? SEO_SETTINGS_SLUG,
        // Read on every request, as the canonical rule and the staging guard
        // read it, so the screen says what the server serves.
        serverAddresses: originsFrom(process.env[PRODUCTION_ADDRESSES_ENV]),
      };
      return Promise.resolve(respondDoc(body));
    },
  });
}
