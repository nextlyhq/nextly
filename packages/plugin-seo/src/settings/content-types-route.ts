/**
 * The content types the SEO settings screen lists: each type the plugin adds
 * SEO to, the variables its title pattern may use, an example page to preview
 * a pattern with, and whether the type has a public address yet.
 *
 * @module settings/content-types-route
 */
import {
  humanizeFieldName,
  NextlyError,
  publicAddressOf,
  respondDoc,
  respondList,
  typesWithoutAddress,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { isRecord, textOf } from "../plain-values";

import {
  CONTENT_TYPES_ROUTE_PATH,
  SEO_SETTINGS_SLUG,
  SETTINGS_DOCUMENT_ROUTE_PATH,
  type SettingsDocumentBody,
  type MappableField,
  type PatternExample,
  type PatternField,
  type SeoContentType,
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

/**
 * The type's own fields a structured data detail may be read from: every
 * named field at the top of an entry but its SEO group, labelled as the
 * admin labels it.
 */
function mappableFieldsOf(
  declared: readonly Record<string, unknown>[]
): MappableField[] {
  const fields: MappableField[] = [];
  for (const field of declared) {
    const { name } = field;
    if (typeof name !== "string" || name === "" || name === "seo") continue;
    fields.push({
      name,
      label: textOf(field.label) ?? humanizeFieldName(name),
    });
  }
  return fields;
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
  const declared = Array.isArray(record.fields)
    ? record.fields.filter(isRecord)
    : [];
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

/** The route that lists `collections`, the types the plugin adds SEO to. */
export function contentTypesRoute(collections: readonly string[]): PluginRoute {
  return {
    method: "GET",
    path: CONTENT_TYPES_ROUTE_PATH,
    // Whoever may read the SEO settings may see what they apply to.
    requiredPermission: ({ single }) => single(SEO_SETTINGS_SLUG, "read"),
    handler: async (_req, ctx) => {
      const withoutAddress = new Set(
        (await typesWithoutAddress())
          .filter(type => type.kind === "collection")
          .map(type => type.slug)
      );
      const items: SeoContentType[] = [];
      for (const slug of collections) {
        items.push(await contentTypeOf(ctx, slug, withoutAddress));
      }
      return respondList(items, {
        total: items.length,
        page: 1,
        limit: Math.max(items.length, 1),
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    },
  };
}

/**
 * The route that names the Single holding the settings, as the host
 * registered it, so the screen reads and saves the renamed one.
 */
export function settingsDocumentRoute(): PluginRoute {
  return {
    method: "GET",
    path: SETTINGS_DOCUMENT_ROUTE_PATH,
    requiredPermission: ({ single }) => single(SEO_SETTINGS_SLUG, "read"),
    handler: (_req, ctx) => {
      const body: SettingsDocumentBody = {
        single: ctx.self.singles[SEO_SETTINGS_SLUG] ?? SEO_SETTINGS_SLUG,
      };
      return Promise.resolve(respondDoc(body));
    },
  };
}
