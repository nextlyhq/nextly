/**
 * What the site's one content route needs from the page builder to answer
 * every path: who holds the path (a page, or a collection's entry), the
 * addresses to pre-render, and each collection's published template.
 *
 * `@nextlyhq/blocks-react/next` serves pages and entries but cannot import
 * this plugin to learn who holds an address, so the route takes a provider
 * and this is the plugin's. It answers from the address store, the same
 * store every save's collision check writes, so what is checked is what is
 * served.
 *
 * @module page-content
 */
import {
  CONTENT_ADDRESS_SERVICE,
  type ContentAddressHolder,
  type ContentAddressService,
} from "./address-claims/content-addresses";
import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_CONTENT_FIELD,
  TEMPLATES_SLUG,
} from "./collections/templates";
import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { fieldOf } from "./spacing-mode-reader";

export type { ContentAddressHolder } from "./address-claims/content-addresses";

/** The Direct API reads the provider makes. */
export interface PageBuilderContentDirectApi {
  /** The installed plugins' services, where the address store is offered. */
  readonly plugins?: unknown;
  find(args: Record<string, unknown>): Promise<{ items: readonly unknown[] }>;
}

/**
 * Options for {@link pageBuilderContent}. Every one defaults.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export interface PageBuilderContentOptions {
  /**
   * The instance to read through. Defaults to the process's Nextly,
   * resolved per read. It must offer the installed plugins' services, as a
   * booted instance does.
   */
  readonly nextly?: PageBuilderContentDirectApi;
  /** The templates collection's slug, where the host renamed it. */
  readonly templatesCollection?: string;
}

/** A collection's published template, as the route draws an entry with it. */
export interface PageBuilderContentTemplate {
  readonly id: string;
  /** The template's block document. */
  readonly document: unknown;
}

/**
 * What the content route takes from the page builder.
 *
 * Structurally the route's own config, stated here rather than imported so
 * this entry stays free of the renderer's Next-coupled subpath; a route that
 * is handed this is type-checked against the real one.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export interface PageBuilderContentProvider {
  readonly resolveAddress: (
    locale: string | undefined,
    path: string
  ) => Promise<ContentAddressHolder | null>;
  readonly addresses: (
    locale: string | undefined,
    limit: number,
    under: readonly string[]
  ) => Promise<readonly (readonly string[])[]>;
  readonly addressCollections: () => Promise<readonly string[]>;
  readonly entryPath: (
    collection: string,
    id: string,
    locale: string | undefined
  ) => Promise<string | null>;
  readonly templates: {
    readonly collection: string;
    readonly read: (
      collection: string,
      locale: string | undefined
    ) => Promise<PageBuilderContentTemplate | null>;
  };
}

/** How many addresses one read of the store takes while pre-rendering. */
const ADDRESS_PAGE = 500;

/**
 * Serve the site's pages and collections' entries from the address store.
 *
 * ```ts
 * import { createContentPage } from "@nextlyhq/blocks-react/next";
 * import { pageBuilderContent } from "@nextlyhq/plugin-page-builder";
 *
 * createContentPage({
 *   pages: { collections: ["pages"], field: "content" },
 *   ...pageBuilderContent(),
 * });
 * ```
 *
 * The holder of a path is read as last committed, as the system: the store
 * holds only published documents' addresses, and a visitor has no right to
 * read it otherwise. A template is read as the public reads it, published
 * only.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export function pageBuilderContent(
  options: PageBuilderContentOptions = {}
): PageBuilderContentProvider {
  const templates = options.templatesCollection ?? TEMPLATES_SLUG;
  // Resolved per read rather than captured, for the reason
  // `pageBuilderLayouts` gives: a route module is loaded before Nextly has
  // booted, and `getCachedNextly` waits for the boot.
  const nextly = async (): Promise<PageBuilderContentDirectApi> =>
    options.nextly ??
    ((await (
      await import("@nextlyhq/plugin-sdk")
    ).getCachedNextly()) as unknown as PageBuilderContentDirectApi);
  const service = async (): Promise<ContentAddressService> =>
    addressServiceOf(await nextly());
  return {
    resolveAddress: async (locale, path) =>
      (await service()).holderAt(locale, path),
    addresses: async (locale, limit, under) => {
      const store = await service();
      const paths: string[][] = [];
      for (let page = 1; paths.length < limit; page += 1) {
        const read = await store.addresses(locale, {
          limit: ADDRESS_PAGE,
          page,
        });
        // Only the paths under the route's mount count toward its limit, so
        // addresses elsewhere never crowd out the ones it serves.
        const within = read.paths.filter(path =>
          under.every((part, at) => path[at] === part)
        );
        paths.push(...within.slice(0, limit - paths.length));
        if (page * ADDRESS_PAGE >= read.total || read.paths.length === 0) {
          break;
        }
      }
      return paths;
    },
    addressCollections: async () => (await service()).collections(),
    entryPath: async (collection, id, locale) =>
      (await service()).pathHeldBy(locale, collection, id),
    templates: {
      collection: templates,
      read: async (collection, locale) => {
        const { items } = await (
          await nextly()
        ).find({
          collection: templates,
          where: { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
          status: "published",
          overrideAccess: false,
          limit: 1,
          depth: 0,
          ...(locale === undefined ? {} : { locale }),
        });
        const row = items[0] as Record<string, unknown> | undefined;
        if (row === undefined) return null;
        // Compared again exactly: a database may compare the text loosely.
        if (row[TEMPLATE_COLLECTION_FIELD] !== collection) return null;
        return {
          id: String(row.id),
          document: row[TEMPLATE_CONTENT_FIELD] ?? null,
        };
      },
    },
  };
}

/**
 * The address service the instance offers, or a refusal saying why there is
 * none: an instance without this plugin installed cannot answer who holds a
 * path, and answering "nobody" would serve every page as not found.
 */
function addressServiceOf(
  nextly: PageBuilderContentDirectApi
): ContentAddressService {
  const service = fieldOf(
    fieldOf(nextly.plugins, PAGE_BUILDER_PLUGIN_NAME),
    CONTENT_ADDRESS_SERVICE
  );
  if (
    typeof service === "object" &&
    service !== null &&
    typeof (service as { holderAt?: unknown }).holderAt === "function"
  ) {
    return service as ContentAddressService;
  }
  throw new Error(
    "[page-builder] the content route reads addresses through the page builder plugin, which this Nextly instance does not have installed."
  );
}
