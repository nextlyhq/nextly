/**
 * The addresses a collection's entry holds while it is drawn on the site (its
 * collection's template is published, or its own design is):
 * `<the collection's address>/<the entry's slug>`, in every language the site
 * serves, while the entry is published.
 *
 * Pure, so the save hook, a template's or an own design's write and the
 * start-up pass ask one answer.
 *
 * @module address-claims/entry-claims
 */
import {
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../templates/template-preview-contract";

import {
  claimKey,
  servedAddress,
  spaceHolding,
  type ServedAddress,
} from "./claim-key";

/** The field whose value is an entry's part of its address. */
export const ENTRY_SLUG_FIELD = "slug";

/** Why an entry that should be served has no address to be served at. */
export const NO_ADDRESS = "no-address";

/**
 * Whether a document as stored is published. Every entry of a collection
 * without a Draft/Published lifecycle is live, whatever an ordinary field of
 * its named `status` holds, so the collection's lifecycle is asked, never
 * read off the row.
 */
export function isPublished(
  data: Readonly<Record<string, unknown>>,
  lifecycle: boolean
): boolean {
  return !lifecycle || data.status === "published";
}

/**
 * The addresses the entry `data` holds under `address` (the collection's
 * address segments), one per language in `locales`, in a collection with a
 * Draft/Published `lifecycle` or without one: none while it is not
 * published, and {@link NO_ADDRESS} when it is published with a slug that
 * names no address (missing, empty, or holding a `/` or a character the
 * route refuses), so the caller can refuse or report it.
 */
export function entryAddresses(
  data: Readonly<Record<string, unknown>>,
  address: readonly string[],
  locales: readonly string[],
  lifecycle: boolean
): readonly ServedAddress[] | typeof NO_ADDRESS {
  if (!isPublished(data, lifecycle)) return [];
  const slug = data[ENTRY_SLUG_FIELD];
  if (typeof slug !== "string" || slug === "") return NO_ADDRESS;
  // Each segment encoded as a request carries it, so a slug holding `/` is
  // one segment that the store refuses, never two that land elsewhere. Text
  // that is not well-formed Unicode (a lone surrogate) cannot be encoded,
  // and names no address either.
  let path: string;
  try {
    path = `/${[...address, slug].map(encodeURIComponent).join("/")}`;
  } catch {
    return NO_ADDRESS;
  }
  const addresses: ServedAddress[] = [];
  for (const locale of locales) {
    const served = servedAddress(locale, path);
    // Exactly the collection's segments and the slug: a slug the store reads
    // as anything else (a `.` segment, a reserved path) names no address.
    if (
      served === null ||
      served.segments.length !== address.length + 1 ||
      served.segments.at(-1) !== slug
    ) {
      return NO_ADDRESS;
    }
    addresses.push(served);
  }
  return addresses;
}

/** The pages an entry's addresses could fall on, and the keys they would. */
export interface PageCandidates {
  /** Slugs of the pages that could be served at one of the addresses. */
  readonly slugs: readonly string[];
  /** The address keys a page holding one of them would hold. */
  readonly addresses: ReadonlySet<string>;
  /** The keys of the list spaces the addresses fall in. */
  readonly lists: ReadonlySet<string>;
}

/** Every ending of `segments`, longest first: `a/b/c`, `b/c`, `c`. */
function pathEndings(segments: readonly string[]): string[] {
  return segments.map((_, at) => segments.slice(at).join("/"));
}

/**
 * The pages `addresses` (one entry's, one per language) could be held by: a
 * page served at one of them, and a paginated page whose later pages they are
 * among (`/blog/page/2` is in the space of the page at `/blog`). A page's
 * slug is its served path, or the end of it under a prefix the host serves
 * pages at, so the candidates are the endings of each path.
 */
export function pageCandidates(
  addresses: readonly ServedAddress[]
): PageCandidates {
  const lists = addresses.flatMap(at => {
    const list = spaceHolding(at);
    return list === null ? [] : [list];
  });
  return {
    slugs: [
      ...pathEndings(addresses[0]?.segments ?? []),
      ...pathEndings(lists[0]?.segments ?? []),
    ],
    addresses: new Set(addresses.map(at => claimKey("address", at))),
    lists: new Set(lists.map(at => claimKey("space", at))),
  };
}

/** A collection whose entries a template's write starts or stops serving. */
export interface TemplateChange {
  readonly collection: string;
  /** Whether its entries are served from now on. */
  readonly served: boolean;
}

/** The collection a template row serves while published, or null. */
function servedCollection(row: Readonly<Record<string, unknown>> | null) {
  return row !== null &&
    row.status === "published" &&
    typeof row.collection === "string"
    ? row.collection
    : null;
}

/**
 * What a template's write changes about the entries it serves: a first
 * publish starts its collection's, an unpublish or a delete stops them, and
 * a published template pointed at another collection (its own renamed or
 * deleted) stops the old one's and starts the new one's. A write that leaves
 * it serving what it served changes nothing.
 *
 * @param data - The template as the write leaves it; for a delete, as it was.
 * @param before - For an update, the template before the write.
 */
export function templateChanges(
  operation: "create" | "update" | "delete",
  data: Readonly<Record<string, unknown>>,
  before: Readonly<Record<string, unknown>> | null
): TemplateChange[] {
  const now = operation === "delete" ? null : servedCollection(data);
  const was = servedCollection(operation === "delete" ? data : before);
  if (now === was) return [];
  return [
    ...(was === null ? [] : [{ collection: was, served: false }]),
    ...(now === null ? [] : [{ collection: now, served: true }]),
  ];
}

/** What decides whether, and where, one entry is served. */
export interface EntryServing {
  /**
   * The collection's address, as segments: declared in code, else stored on
   * its template; null where it has none left.
   */
  readonly address: readonly string[] | null;
  /** Whether the collection's template is published. */
  readonly templatePublished: boolean;
  /**
   * Whether the entry's own design is published, asked only when the
   * answer depends on it, so a save under a published template reads no
   * design.
   */
  readonly ownDesignPublished: () => boolean | Promise<boolean>;
}

/**
 * Where an entry is served, as segments, or null for nowhere: at its
 * collection's address while either the collection's template or the
 * entry's own design is published, since either draws it, and nowhere once
 * neither is or the collection has no address. The one answer every path
 * that holds or gives up an entry's address asks: the entry's save, a
 * template's publish, unpublish, delete or address change, an own design's
 * publish, unpublish or removal, and the start-up pass.
 *
 * An entry whose collection's address lived only on a template since
 * deleted (a collection created at runtime) has no address left, and is
 * served nowhere whatever its own design: the design has no address of its
 * own to be served at.
 */
export async function servedAt(
  serving: EntryServing
): Promise<readonly string[] | null> {
  if (serving.address === null) return null;
  if (serving.templatePublished) return serving.address;
  return (await serving.ownDesignPublished()) ? serving.address : null;
}

/** The entry an own design serves, and whether the design is published. */
export interface DesignedEntry {
  readonly collection: string;
  readonly id: string;
  readonly published: boolean;
}

/**
 * The entry the templates row `row` serves as its own design, or null for a
 * collection's template (or no row): an own design names its entry's
 * collection and id, and no collection.
 */
export function designedEntry(
  row: Readonly<Record<string, unknown>> | null
): DesignedEntry | null {
  const collection = row?.[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const id = row?.[TEMPLATE_ENTRY_ID_FIELD];
  if (
    typeof collection !== "string" ||
    collection === "" ||
    typeof id !== "string" ||
    id === ""
  ) {
    return null;
  }
  return { collection, id, published: row?.status === "published" };
}
