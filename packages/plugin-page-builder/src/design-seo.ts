/**
 * What the design drawing an entry's page says about the page, offered to
 * other plugins as a service: the title, description and share image a Page
 * Builder route hands a page-metadata provider as the page's design level.
 *
 * A page-metadata provider is told these by the route only while a page is
 * served. A check or an admin screen that asks about a page outside a request
 * (an SEO problem list, an entry's SEO tab) asks here, and is answered by the
 * route's own derivation (`designMetadataFor`), so it reads what the
 * published page is answered with.
 *
 * Which design draws the page is the route's answer too: a page of the
 * plugin's pages collection draws its own blocks field; any other entry is
 * drawn by its own published design, else its collection's published
 * template, read as the public reads them. An entry no design draws has
 * none.
 *
 * @module design-seo
 */
import type { PageMetadataValues } from "@nextlyhq/plugin-sdk";

import {
  pageBuilderContent,
  type PageBuilderContentDirectApi,
} from "./page-content";

/** The service's name under the plugin's services. */
export const DESIGN_SEO_SERVICE = "designSeo";

/** One page to ask about. */
export interface DesignSeoRequest {
  /** The collection the entry belongs to, by its slug. */
  readonly collection: string;
  /** The entry as stored; its `id` says which entry's own design to read. */
  readonly entry: Readonly<Record<string, unknown>>;
  /** The language the page is drawn in. */
  readonly locale?: string;
  /**
   * The design to draw the page with, where it is not the one saved: a
   * design being edited, previewed with the entry before it is saved.
   */
  readonly document?: unknown;
}

/**
 * What drew a page: its own design (a page's blocks, an entry's own
 * design), or its collection's template.
 */
export type DesignDrawnBy = "design" | "template";

/** A page's design level and what drew it. */
export interface DesignSeoAnswer {
  readonly values: PageMetadataValues;
  readonly drawnBy: DesignDrawnBy;
}

/**
 * The design level of a page, or undefined where no design draws it.
 *
 * @experimental Settles with the page-metadata contract.
 */
export interface DesignSeoService {
  valuesFor(request: DesignSeoRequest): Promise<PageMetadataValues | undefined>;
  /** The design level with what drew it, or undefined as `valuesFor`. */
  designFor(request: DesignSeoRequest): Promise<DesignSeoAnswer | undefined>;
}

/** How the service derives a design's values: the route's derivation. */
export type DeriveDesignValues = (args: {
  readonly config: { readonly nextly: unknown };
  readonly collection: string;
  readonly entry: Record<string, unknown>;
  readonly locale?: string;
  readonly field?: string;
  readonly document?: unknown;
}) => Promise<PageMetadataValues>;

/** What the service reads with. */
export interface DesignSeoDeps {
  /** The Direct API, resolved when first asked. */
  readonly nextly: () => Promise<PageBuilderContentDirectApi>;
  /** The pages collection, by its resolved slug, and its blocks field. */
  readonly pages: { readonly collection: string; readonly field: string };
  /** The templates collection, by its resolved slug. */
  readonly templatesCollection: string;
  /** The route's derivation. */
  readonly derive: DeriveDesignValues;
}

/** The entry's id as stored, or nothing for one never saved. */
function idOf(entry: Readonly<Record<string, unknown>>): string | undefined {
  const { id } = entry;
  if (typeof id === "string" && id !== "") return id;
  return typeof id === "number" ? String(id) : undefined;
}

export function designSeoService(deps: DesignSeoDeps): DesignSeoService {
  const designFor = async ({
    collection,
    entry,
    locale,
    document,
  }: DesignSeoRequest): Promise<DesignSeoAnswer | undefined> => {
    const nextly = await deps.nextly();
    const base = {
      config: { nextly },
      collection,
      entry: { ...entry },
      ...(locale === undefined ? {} : { locale }),
    };
    const isPage = collection === deps.pages.collection;
    // A design handed in draws the page as it is, unsaved: a page's blocks
    // in the pages collection, a template anywhere else.
    if (document !== undefined) {
      return {
        values: await deps.derive({ ...base, document }),
        drawnBy: isPage ? "design" : "template",
      };
    }
    // A page draws its own blocks, as the pages route draws them.
    if (isPage) {
      return {
        values: await deps.derive({ ...base, field: deps.pages.field }),
        drawnBy: "design",
      };
    }
    const content = pageBuilderContent({
      nextly,
      templatesCollection: deps.templatesCollection,
    });
    const id = idOf(entry);
    // An entry never saved has no own design yet: its collection's
    // template is the one that will draw it.
    const design =
      id === undefined
        ? await content.templates.read(collection, locale)
        : await content.templates.readFor(collection, id, locale);
    if (design === null) return undefined;
    return {
      values: await deps.derive({ ...base, document: design.document }),
      drawnBy: design.own ? "design" : "template",
    };
  };
  return {
    designFor,
    valuesFor: async request => (await designFor(request))?.values,
  };
}
