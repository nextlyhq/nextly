/**
 * What the SEO plugin's server and its admin screens agree on: its names,
 * where its settings live and are edited, the choices the settings offer,
 * and the shapes its routes answer with. It imports nothing, so the admin's
 * client bundle reads it without bringing any server code along.
 *
 * @module settings/contract
 */

/** The plugin's package name, which its cache tags and routes are under. */
export const SEO_PLUGIN_NAME = "@nextlyhq/plugin-seo";

/** The Single the settings live in. */
export const SEO_SETTINGS_SLUG = "seo-settings";

/** The kinds of site setup asks about, which decide what Google is told. */
export const SITE_KINDS = ["company", "blog", "shop", "local"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/** What AI tools are asked to do with the site's pages. */
export const AI_CRAWLER_CHOICES = ["all", "search", "block"] as const;
export type AiCrawlerChoice = (typeof AI_CRAWLER_CHOICES)[number];

/** First-time setup's three steps; this many done means it is finished. */
export const SETUP_STEPS = 3;

/**
 * Where the settings screen asks which Single holds the settings: its slug
 * as the host registered it, which a host's rename changes.
 */
export const SETTINGS_DOCUMENT_ROUTE_PATH = "/settings/document";

/** What the settings document route answers. */
export interface SettingsDocumentBody {
  single: string;
}

/** Where the settings screen reads its content types, under the plugin's routes. */
export const CONTENT_TYPES_ROUTE_PATH = "/settings/content-types";

/**
 * The plugin's admin slug, which core derives from its name with
 * `pluginAdminSlug`; a unit test holds the two together.
 */
export const SEO_ADMIN_SLUG = "nextlyhq-plugin-seo";

/** The SEO settings screen: its path under the plugin, and its component. */
export const SETTINGS_PAGE: {
  readonly path: "settings";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoSettingsPage";
} = {
  path: "settings",
  component: "@nextlyhq/plugin-seo/admin#SeoSettingsPage",
};

/** Where the SEO settings screen is, for a link. */
export const SETTINGS_PAGE_HREF: string = `/admin/plugins/${SEO_ADMIN_SLUG}/${SETTINGS_PAGE.path}`;

/** A field a title pattern may name, with the variable that names it. */
export interface PatternField {
  name: string;
  token: string;
}

/** A field a structured data detail may be read from, as the screen names it. */
export interface MappableField {
  name: string;
  label: string;
}

/** A page of a type a pattern is previewed with: its title and fields. */
export interface PatternExample {
  /** The page's title, which `{Title}` stands for. */
  title?: string;
  /** Its other fields' values, by field name. */
  values: Record<string, string | number>;
  /** Where the page is served, where its type declares an address. */
  address?: string;
}

/** One content type, as the SEO settings screen lists it. */
export interface SeoContentType {
  /** Its key in the settings' patterns: the collection's slug. */
  key: string;
  label: string;
  /** The fields its title pattern may name. */
  fields: PatternField[];
  /** The newest page of the type, where the reader may see one. */
  example?: PatternExample;
  /** How many entries of the type the reader may read. */
  count?: number;
  /** The type's own fields a structured data detail may be read from. */
  mappableFields: MappableField[];
  /** Whether its pages have a public address yet. */
  public: boolean;
}

/**
 * One of the site's own content types the plugin does not add SEO to, which
 * the screen lists greyed, since the switch is set in the site's code.
 */
export interface SwitchedOffType {
  key: string;
  label: string;
  /** How many entries of the type the reader may read. */
  count?: number;
  /** Whether its pages have a public address, with SEO or without. */
  public: boolean;
  seo: false;
}

/** What the content types route lists: each type with SEO, then those without. */
export type ListedContentType = SeoContentType | SwitchedOffType;

/** Whether a listed type is one the plugin does not add SEO to. */
export function isSwitchedOff(
  type: ListedContentType
): type is SwitchedOffType {
  return "seo" in type && type.seo === false;
}
