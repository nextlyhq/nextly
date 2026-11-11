/**
 * The content types the SEO settings screen lists: each type the plugin adds
 * SEO to, the variables its title pattern may use, an example page to preview
 * a pattern with, and whether the type has a public address yet.
 *
 * @module settings/content-types-route
 */
import {
  publicAddressOf,
  respondList,
  typesWithoutAddress,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import {
  CONTENT_TYPES_ROUTE_PATH,
  SEO_SETTINGS_SLUG,
  type PatternExample,
  type PatternField,
  type SeoContentType,
} from "./contract";
import { patternFields } from "./pattern-fields";
import { TITLE_FIELDS } from "./patterns";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** The example a stored page gives for `fields`. */
export function exampleOf(
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

/** The newest entry of `slug`, read as the system, or none. */
async function newestEntry(
  ctx: PluginRouteContext,
  slug: string
): Promise<Record<string, unknown> | undefined> {
  const page = await ctx.services.collections.listEntries(
    slug,
    {
      depth: 0,
      sort: { field: "updatedAt", direction: "desc" },
      pagination: { limit: 1, page: 1 },
    },
    { as: "system" }
  );
  const first: unknown = (page as { data?: unknown[] }).data?.[0];
  return isRecord(first) ? first : undefined;
}

/** One content type as the screen lists it, for this reader. */
async function contentTypeOf(
  ctx: PluginRouteContext,
  slug: string,
  withoutAddress: ReadonlySet<string>
): Promise<SeoContentType> {
  const meta: unknown = await ctx.services.collections.getCollection(slug, {});
  const record = isRecord(meta) ? meta : {};
  const fields = patternFields(
    Array.isArray(record.fields)
      ? record.fields.filter(isRecord).map(field => ({
          name: typeof field.name === "string" ? field.name : undefined,
          type: typeof field.type === "string" ? field.type : "",
          label: field.label,
        }))
      : []
  );
  const isPublic = !withoutAddress.has(slug);
  // An example only for a reader who may read the type's entries: the
  // settings permission alone must not show them a page's title.
  const mayRead = (await ctx.caller?.can("read", slug)) === true;
  const entry = mayRead ? await newestEntry(ctx, slug) : undefined;
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
    ...(example === undefined ? {} : { example }),
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
