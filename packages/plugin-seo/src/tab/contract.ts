/**
 * What the SEO tab and its route agree on: where the route answers, and what
 * it answers. A leaf, importing nothing that runs, so the admin bundle can
 * read it without reaching the server's code.
 *
 * @module tab/contract
 */
import type { Levels } from "../resolver/order";

/** The route's path under the plugin's namespace. */
export const SEO_RESOLVE_PATH = "/resolve";

/** The plugin's name, which its admin components address its routes by. */
export const SEO_PLUGIN_NAME = "@nextlyhq/plugin-seo";

/** What the route answers. */
export interface SeoTabContext {
  /** Every level but the page's own, which the tab adds as it is typed. */
  levels: Levels;
  site: {
    /** The site's name, where the settings give one. */
    name?: string;
    /** The origin addresses are shown under, such as `https://acme.com`. */
    origin: string;
    /** Every host the site is served from, lower case, for the address check. */
    hosts: string[];
  };
  /** The content type's name for one of its pages, such as "Blog post". */
  typeLabel: string;
  /** What each of the document's fields a value came from is called. */
  fieldLabels: Record<string, string>;
}
