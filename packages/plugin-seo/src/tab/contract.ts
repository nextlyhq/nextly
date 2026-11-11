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
export { SEO_PLUGIN_NAME } from "../settings/contract";

/** The `seo` group's field holding the page's own structured data type. */
export const STRUCTURED_DATA_FIELD = "structuredDataType";

/** A structured data type as the tab offers it. */
export interface TabStructuredType {
  key: string;
  label: string;
}

/** The page's structured data, as the tab shows and chooses it. */
export interface TabStructuredData {
  /** The type the page is described as. */
  type: TabStructuredType;
  /** Whether the page chose it, its content type did, or it is automatic. */
  chosen: "page" | "type" | "automatic";
  /** What the page is described as while it chooses nothing. */
  automatic: TabStructuredType;
  /** The types the page may choose from. */
  offered: TabStructuredType[];
  /** What keeps the type's markup out, each in one sentence. */
  problems: {
    message: string;
    /** Where it is fixed: the page's content, the mapping, the route or the settings. */
    fix: "content" | "mapping" | "route" | "settings";
    /** The page's field the detail is read from, and what it is called. */
    field?: { name: string; label: string };
  }[];
  /** The details the type is described with, as a person names them. */
  details: string[];
}

/** What the route answers. */
export interface SeoTabContext {
  /** Every level but the page's own, which the tab adds as it is typed. */
  levels: Levels;
  site: {
    /** The site's name, where the settings give one. */
    name?: string;
    /** The origin addresses are shown under, such as `https://acme.com`. */
    origin: string;
  };
  /**
   * The page's own address as its language serves it, root-relative or on
   * the language's own domain: on a site that puts the language in every
   * address, with it. None where the page has no address of its own.
   */
  served?: string;
  /** The content type's name for one of its pages, such as "Blog post". */
  typeLabel: string;
  /** What each of the document's fields a value came from is called. */
  fieldLabels: Record<string, string>;
  /** The `seo` group's fields, so the tab offers a control for each alone. */
  fields: string[];
  /**
   * Whether the person may change this page's SEO, where the site gives it
   * a permission of its own; true where it does not, since then the page's
   * own update decides. A save by someone who may not keeps the stored SEO,
   * so the tab shows it read-only.
   */
  mayChange: boolean;
  /** The page's structured data, where the group holds its type. */
  structuredData?: TabStructuredData;
  /** What keeps the page's share image from showing well on a card. */
  shareImage?: {
    problems: {
      message: string;
      /** Made from the picture, set by the route or design, or in the settings. */
      fix: "make" | "route" | "settings";
    }[];
  };
}
