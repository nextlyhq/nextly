/**
 * What the template preview routes take and answer, named where both ends can
 * read them.
 *
 * A template is drawn, while it is edited, with a real entry of the
 * collection it names: the editor lists the entries the author may read
 * (`/template-preview/entries`) and reads the one being previewed
 * (`/template-preview/entry`). Both are reads, made as the author, and
 * neither stores anything: which entry is previewed is the editor's state.
 *
 * FREE OF RUNTIME IMPORTS, so the admin's bundle reads it without the server's
 * runtime, as `library-contract.ts` is.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/template-preview-contract
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";

/**
 * The field naming the collection a template renders. Unique, so a
 * collection has one template: read by the guard that names the template
 * already there, by everything that finds a collection's template, and by the
 * editor, which previews an entry of it.
 */
export const TEMPLATE_COLLECTION_FIELD = "collection";

/**
 * The field an entry's own design names its entry's collection in: an own
 * design leaves `collection` empty and draws that collection's entry.
 */
export const TEMPLATE_ENTRY_COLLECTION_FIELD = "entryCollection";

/** The field an entry's own design names the one entry it serves in, by id. */
export const TEMPLATE_ENTRY_ID_FIELD = "entryId";

/** The field holding the key of the entry an own design serves, unique. */
export const TEMPLATE_ENTRY_FIELD = "entry";

/** The field naming the template an own design was copied from. */
export const TEMPLATE_FORKED_FROM_FIELD = "forkedFrom";

/**
 * The fields a template names the collection it draws in, in order: a
 * collection's template by `collection`, an entry's own design by
 * `entryCollection`.
 */
export const TEMPLATE_TARGET_FIELDS: readonly string[] = [
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
];

/**
 * The text field whose value is an entry's part of its address: a collection
 * with none has nothing to serve an entry at, so it may have no template. The
 * guard refuses one by it, and the template form offers only the collections
 * that declare it.
 */
export const TEMPLATE_ENTRY_ADDRESS_FIELD = "slug";

/** Where the entries a template may preview are listed. */
export const TEMPLATE_PREVIEW_ENTRIES_PATH = "/template-preview/entries";

/** Where the entry a template previews is read. */
export const TEMPLATE_PREVIEW_ENTRY_PATH = "/template-preview/entry";

/** How many entries one list answers: the most recently updated. */
export const TEMPLATE_PREVIEW_LIMIT = 20;

/** The longest search the list takes. */
export const TEMPLATE_PREVIEW_SEARCH_MAX = 200;

/**
 * Where an entry stands, in the admin's own words: a draft, published, or
 * published with a working draft waiting (`changed`).
 */
export type PreviewEntryStatus = "draft" | "published" | "changed";

/** One entry the template may preview, as the list shows it. */
export interface PreviewEntryItem {
  readonly id: string;
  /** The entry's title, or its id where it has none the author can read. */
  readonly title: string;
  readonly status: PreviewEntryStatus;
  /** When the entry was last updated, as ISO 8601; `null` where it keeps no time. */
  readonly updatedAt: string | null;
}

/** What the list asks. */
export interface PreviewEntriesRequest {
  /** The template's collection. */
  readonly collection: string;
  /** Matched against the entries' titles; absent lists the most recent. */
  readonly search?: string;
  /** The language being edited. */
  readonly locale?: string;
}

/** The collection's names, for "No posts to preview" and "New post". */
export interface PreviewCollectionLabels {
  readonly singular: string;
  readonly plural: string;
}

/**
 * The list's meta: its pagination, whether the author may create an entry
 * of the collection, and the collection's names.
 */
export interface PreviewEntriesMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
  readonly mayCreate: boolean;
  readonly labels: PreviewCollectionLabels;
}

/** What the list answers: the canonical list envelope. */
export interface PreviewEntriesResponse {
  readonly items: readonly PreviewEntryItem[];
  readonly meta: PreviewEntriesMeta;
}

/** What the entry read asks. */
export interface PreviewEntryRequest {
  readonly collection: string;
  readonly id: string;
  readonly locale?: string;
}

/**
 * What the entry read answers: the entry as the author reads it, drafts
 * included, and as the public reads it, with the field shapes the public may
 * read, so a binding the published page would not fill is told apart.
 */
export interface PreviewEntryResponse {
  readonly id: string;
  readonly title: string;
  readonly status: PreviewEntryStatus;
  /** The entry as the author reads it, its working draft where one waits. */
  readonly editorValues: Readonly<Record<string, unknown>>;
  /** The published entry as an anonymous visitor reads it, or `null` where they may not. */
  readonly publicValues: Readonly<Record<string, unknown>> | null;
  /** The collection's fields as the public may read them; empty where it may read none. */
  readonly fields: readonly BindingFieldShape[];
}
