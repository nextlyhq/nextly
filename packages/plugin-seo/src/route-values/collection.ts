/**
 * What a content route's own code supplies for a page's head: the title,
 * description and social values its `buildMetadata` hands the page's
 * answer, kept per page and language as the route last answered it.
 *
 * The admin never runs the page's route, so without this the SEO tab, bulk
 * edit and the problem list would work a page out without that level and
 * show a pattern's text where the page is served its route's. Kept here, they
 * read the level the head was answered with.
 *
 * @module route-values/collection
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  defineCollection,
  json,
  text,
  type CollectionConfig,
} from "nextly/config";

const ROUTE_VALUES_SLUG = "nx_seo_route_values";

export function routeValuesCollection(): CollectionConfig {
  return defineCollection({
    slug: ROUTE_VALUES_SLUG,
    labels: { singular: "Value in code", plural: "Values in code" },
    internal: true,
    fields: [
      // The SHA-256 of the page's type, id and language, so one page in one
      // language is one row on every dialect.
      text({
        name: "pageKey",
        label: "Page key",
        required: true,
        unique: true,
      }),
      // The page's content type as the problem list keys it: a collection's
      // slug, or `single:<slug>`.
      text({ name: "type", label: "Content type", required: true }),
      text({ name: "pageId", label: "Page" }),
      text({ name: "language", label: "Language", required: true }),
      // What the route's code supplied, as the page's head used it.
      json({ name: "codeValues", label: "Values in code" }),
    ],
    access: {
      // Constants rather than bare `false`: access rules are validated as
      // callables. The plugin writes as the system, which these do not apply
      // to, and reads them only through its own routes.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // Written while a route renders a page, when expiring a cache is
    // refused: so no write here expires one. Nothing a page serves is read
    // from these rows.
    revalidate: { disable: true },
    webhooks: false,
    admin: {
      description:
        "What each page's route supplies in code for its title, description and share card.",
    },
  });
}

/** The collection's slug as this site has it, renamed or the plugin's own. */
export function routeValuesSlug(ctx: PluginContext): string {
  return ctx.self.collections[ROUTE_VALUES_SLUG] ?? ROUTE_VALUES_SLUG;
}
