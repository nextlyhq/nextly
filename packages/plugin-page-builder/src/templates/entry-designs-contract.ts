/**
 * What the entry designs route answers, with no runtime imports, so the admin
 * and the route share one description of it.
 *
 * `GET /templates/entry-designs?collection=<slug>` lists the own designs of a
 * collection's entries, newest edit first, in the list envelope, capped at
 * {@link ENTRY_DESIGNS_MAX}. With `&entry=<id>` it answers that one entry's
 * own design, or none: the lookup a surface asks whether an entry has one,
 * since a capped list cannot say so. Asked with `?template=<id>` instead, it
 * answers for the collection that template draws or, for an entry's own
 * design, for that design's entry alone.
 *
 * Its `meta` carries what every surface needs beside the list: the
 * collection's template, whether the caller could read templates at all,
 * whether the collection may have one, what the caller may make, and the
 * collection's names. Everything is read as the caller: a caller who may not
 * read the collection or the templates is answered an empty list and no
 * template, and an own design is listed only when the caller may read its
 * entry.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/entry-designs-contract
 */
import type { PaginationMeta } from "nextly";

/** Where the read is served, under the plugin's route prefix. */
export const ENTRY_DESIGNS_ROUTE_PATH = "/templates/entry-designs";

/** The query parameters the read takes. */
export const ENTRY_DESIGNS_PARAMS = {
  collection: "collection",
  entry: "entry",
  template: "template",
} as const;

/**
 * The most own designs one read lists. Own designs are the exception in a
 * collection, so a list this long is already more than a screen shows; past
 * it, `meta.hasNext` says the list was cut.
 */
export const ENTRY_DESIGNS_MAX = 500;

/** A template's state, as stored. */
export type TemplateState = "draft" | "published";

/** One entry's own design. */
export interface EntryDesignItem {
  /** The own design's id, in the templates collection. */
  readonly id: string;
  /** The id of the entry it serves. */
  readonly entryId: string;
  /** Its name in the admin: the entry's title when it was given. */
  readonly title: string;
  readonly status: TemplateState;
  /** When it was last saved, or null where the row says not. */
  readonly updatedAt: string | null;
}

/** A collection's template, as the surfaces name it. */
export interface CollectionTemplate {
  readonly id: string;
  readonly title: string;
  readonly status: TemplateState;
}

/** What the read says beside the list. */
export interface EntryDesignsMeta extends PaginationMeta {
  /** The collection's template, or null where it has none the caller may read. */
  readonly template: CollectionTemplate | null;
  /**
   * Whether the caller could read templates and the collection, so `template`
   * and the list say what is stored. False, both were withheld: a surface
   * says nothing about the collection's template rather than "it has none".
   */
  readonly templateReadable: boolean;
  /** Whether the collection may have a template at all. */
  readonly templateAllowed: boolean;
  /**
   * Whether the caller may create the collection's template: it may have one,
   * has none, and the caller may create templates.
   */
  readonly mayCreateTemplate: boolean;
  /**
   * Whether the caller may give an entry its own design: the collection's
   * template is published, to be copied, and the caller may create templates.
   */
  readonly mayGiveDesign: boolean;
  /** The one entry the read was asked about, or null for the collection's list. */
  readonly entry: string | null;
  /** The templates collection's slug as the site resolved it. */
  readonly templatesCollection: string;
  /** The collection's names, for the words every surface uses. */
  readonly names: { readonly singular: string; readonly plural: string };
  /** The collection answered for, by slug; empty when there is none. */
  readonly collection: string;
}

/** The read's answer. */
export interface EntryDesignsResponse {
  readonly items: readonly EntryDesignItem[];
  readonly meta: EntryDesignsMeta;
}

/** The read's path for one collection. */
export function entryDesignsPath(collection: string): string {
  return `${ENTRY_DESIGNS_ROUTE_PATH}?${ENTRY_DESIGNS_PARAMS.collection}=${encodeURIComponent(collection)}`;
}

/** The read's path for one entry's own design, or none. */
export function entryDesignPath(collection: string, entry: string): string {
  return `${entryDesignsPath(collection)}&${ENTRY_DESIGNS_PARAMS.entry}=${encodeURIComponent(entry)}`;
}

/** The read's path for the collection a template draws, or serves an entry of. */
export function entryDesignsPathForTemplate(template: string): string {
  return `${ENTRY_DESIGNS_ROUTE_PATH}?${ENTRY_DESIGNS_PARAMS.template}=${encodeURIComponent(template)}`;
}
