/**
 * The page-metadata contract: what a plugin that works out a page's SEO is
 * asked, and what it answers.
 *
 * A leaf on purpose. It holds the two names a provider declares and the shapes
 * it exchanges, and imports nothing, so plugin boot validation and the route
 * helpers read one spelling of each name without either reaching the other's
 * graph. Nothing here knows Next.js: the answer is plain data, and only the
 * route helpers turn it into Next.js `Metadata`, so a provider such as
 * `@nextlyhq/plugin-seo` stays free of `next`.
 *
 * A plugin provides it by declaring the capability and contributing the
 * service under its name:
 *
 * ```ts
 * definePlugin({
 *   provides: ["page-metadata"],
 *   contributes: { services: { pageMetadata: () => resolver } },
 * });
 * ```
 *
 * One plugin at most provides it: boot refuses a capability provided twice.
 *
 * @experimental The contract settles as the SEO plugin exercises it.
 * @module runtime/seo/page-metadata-contract
 */

/** The capability a page-metadata provider declares in `provides`. */
export const PAGE_METADATA_CAPABILITY = "page-metadata";

/** The `contributes.services` key the provider's resolver is registered under. */
export const PAGE_METADATA_SERVICE = "pageMetadata";

/**
 * @experimental An image for a page's social card. `url` is absolute, or
 * root-relative and resolved against the app's `metadataBase`.
 */
export interface PageMetadataImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

/**
 * @experimental The values one level of the order of who wins can supply:
 * what a route's code set, or what the page's own content offers.
 */
export interface PageMetadataValues {
  title?: string;
  description?: string;
  /** The social card's title, where it differs from the page title. */
  socialTitle?: string;
  /** The social card's description, where it differs from the page's. */
  socialDescription?: string;
  image?: PageMetadataImage;
  /**
   * The route's own metadata hides the page from search (`noindex`). Set
   * for the route's code level only. A provider may hide a page its route
   * lists, never list one its route hides: core serves the page hidden
   * whatever the answer says, so a provider that also reports it hidden
   * keeps every output built from the answer in step with the page.
   */
  hidden?: boolean;
}

/** @experimental The document a route resolved the page to. */
export type PageMetadataSource =
  | {
      readonly kind: "entry";
      /** The collection the entry was resolved from. */
      readonly collection: string;
      /** The entry, as the route read it for this request. */
      readonly entry: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "single";
      /** The Single's slug. */
      readonly slug: string;
      /** The Single's document, as the route read it for this request. */
      readonly document: Readonly<Record<string, unknown>>;
    };

/** @experimental One entry a page lists, such as a post on a blog's index. */
export interface PageListItem {
  /** The entry's name, as the list shows it. */
  name: string;
  /** Its own page: absolute, or from the site's root. */
  url: string;
}

/** @experimental One question a page answers, with its answer, as shown. */
export interface PageQuestion {
  question: string;
  /** The answer as plain text, as a reader sees it on the page. */
  answer: string;
}

/**
 * @experimental What a route knows about its page that the page's document
 * does not hold, for its structured data: what kind of page it is, its own
 * name, the entries it lists and the questions it answers. Every part is
 * what the page shows; a provider describes nothing a reader cannot see.
 */
export interface PageStructuredDataHints {
  /**
   * The kind of page, as the provider names its types (for the SEO plugin,
   * `"aboutPage"`, `"contactPage"`, `"collectionPage"`, ...): used where
   * neither the page nor its content type chose one. A kind the provider
   * does not offer is ignored.
   */
  type?: string;
  /** The page's own name, as its heading shows it, without the site's name. */
  name?: string;
  /** The entries the page lists, in the order shown. */
  items?: readonly PageListItem[];
  /** The questions the page answers, in the order shown. */
  questions?: readonly PageQuestion[];
}

/** @experimental What a resolver is asked about one page. */
export interface PageMetadataInput {
  /**
   * The address the route served this page at, from `/`, as requested. Absent
   * where the route cannot know it: a Single route is mounted by the app, and
   * is told where only when the app says so.
   */
  readonly path?: string;
  /** The language the route read the page in, verbatim; absent when unset. */
  readonly locale?: string;
  readonly source: PageMetadataSource;
  /**
   * What the route's code supplied: a title, a description, social values,
   * and whether it hides the page. A route never supplies the canonical
   * address: core keeps the route's own only where the answer names none.
   */
  readonly code: PageMetadataValues;
  /** What the page's own content offers, such as a Page Builder page's blocks. */
  readonly derived: PageMetadataValues;
  /**
   * What the route says about the page for its structured data, where it
   * says anything. Given only when the page's structured data is asked for,
   * never with its head, which it cannot change.
   */
  readonly structuredDataHints?: PageStructuredDataHints;
}

/** @experimental The page's answer: the values its head is built from. */
export interface PageMetadataAnswer {
  title?: string;
  description?: string;
  /** Absolute, or root-relative and resolved against `metadataBase`. */
  canonical?: string;
  robots?: { index: boolean; follow: boolean };
  social?: {
    title?: string;
    description?: string;
    image?: PageMetadataImage;
    siteName?: string;
    /** The page's language as the social card states it, e.g. `en_US`. */
    locale?: string;
    type?: "website" | "article";
  };
  /** The page's address in each language, keyed by language code. */
  languages?: Record<string, string>;
  /**
   * The page's structured data: JSON-LD nodes, written without `@context`,
   * which the route helpers hand the page's render as one schema.org graph.
   * Plain JSON only, since the answer is cached as JSON.
   */
  structuredData?: StructuredDataNode[];
  /**
   * Tags a service reads to confirm who owns the site, placed in the head as
   * `<meta name content>`, keyed by name, such as
   * `{ "msvalidate.01": "8A2F61C4" }`. A name is a letter followed by letters,
   * digits and `. _ : -`; an answer naming one otherwise is refused whole.
   * They join any the route sets itself.
   */
  verification?: Record<string, string>;
}

/** @experimental A JSON value, as a structured data node may hold. */
export type StructuredDataValue =
  | string
  | number
  | boolean
  | null
  | StructuredDataValue[]
  | { [key: string]: StructuredDataValue };

/**
 * @experimental One JSON-LD node of a page's structured data, such as
 * `{ "@type": "WebPage", "@id": "https://example.com/about", name: "About" }`.
 */
export type StructuredDataNode = { [key: string]: StructuredDataValue };

/**
 * @experimental A page-metadata provider's service.
 *
 * `resolve` answers one page. `tags` names the cache tags the answer depends on
 * beyond the page's own document, such as the provider's settings, so that a
 * change to them expires every page whose head they decided.
 */
export interface PageMetadataResolver {
  resolve(
    input: PageMetadataInput
  ): PageMetadataAnswer | Promise<PageMetadataAnswer>;
  tags?(input: PageMetadataInput): readonly string[];
}
