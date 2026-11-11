/**
 * The SEO of pages with no entry behind them: pages a route renders from its
 * own code, such as `/pricing`. A public address has one home for its SEO:
 * an entry's `seo` group where an entry is served there, and a row here
 * where none is.
 *
 * One row per address. Besides what a person typed, a row says whether the
 * route serving the address calls the plugin's metadata function, and what
 * the route's code itself supplied, so the screen can say which value wins.
 *
 * @module code-pages/collection
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  checkbox,
  defineCollection,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

const CODE_PAGES_SLUG = "nx_seo_code_pages";

/**
 * The part of the plugin's cache tags a page's head built from these rows
 * carries, which a save of what a person typed expires.
 */
export const CODE_PAGES_CACHE_PART = "code-pages";

export function codePagesCollection(): CollectionConfig {
  return defineCollection({
    slug: CODE_PAGES_SLUG,
    labels: { singular: "Page with no entry", plural: "Pages with no entry" },
    internal: true,
    fields: [
      // The SHA-256 of the address, so one address is one row on every
      // dialect, whatever its length.
      text({
        name: "pathKey",
        label: "Path key",
        required: true,
        unique: true,
      }),
      textarea({ name: "path", label: "Address", required: true }),
      // What `{Title}` stands for in the site's title pattern.
      textarea({ name: "name", label: "Name" }),
      // What a person typed for the address.
      textarea({ name: "metaTitle", label: "Title" }),
      textarea({ name: "metaDescription", label: "Description" }),
      text({ name: "ogImage", label: "Share image" }),
      checkbox({ name: "noindex", label: "Hidden from search" }),
      // Whether the route serving the address has called the metadata
      // function, and what its code supplied when it did.
      checkbox({ name: "connected", label: "Connected" }),
      textarea({ name: "codeTitle", label: "Title in code" }),
      textarea({ name: "codeDescription", label: "Description in code" }),
    ],
    access: {
      // Constants rather than bare `false`: access rules are validated as
      // callables. The plugin writes as the system, which these do not apply
      // to; the screen reads and saves through the plugin's own routes.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // A route records that it is connected while it renders, when expiring
    // a cache is refused: so no write here expires one. A save of what a
    // person typed expires the heads built from it by the plugin's own tag.
    revalidate: { disable: true },
    webhooks: false,
    admin: {
      description:
        "The SEO of pages a route renders from its own code, by address.",
    },
  });
}

/** The collection's slug as this site has it, renamed or the plugin's own. */
export function codePagesSlug(ctx: PluginContext): string {
  return ctx.self.collections[CODE_PAGES_SLUG] ?? CODE_PAGES_SLUG;
}
