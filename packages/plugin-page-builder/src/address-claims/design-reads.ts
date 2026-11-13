/**
 * The reads an entry's claims make of the designs that may draw it: its own
 * published design, every published own design of its collection, and its
 * collection's published template, each judged for a list split into pages
 * (`splitsList`). Hook-free and as the system, as the template guard reads
 * templates, and always on the write's own transaction, so a write holding
 * the pool's last connection never waits for a second one, and a template's
 * or an own design's write is read as it leaves the row.
 *
 * @module address-claims/design-reads
 */
import {
  entryDesignKey,
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_CONTENT_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";

import type { Tx } from "./claim-store";
import type { EntryClaimsDeps, OwnDesign } from "./entry-claims-hook";
import { splitsList } from "./page-claims";

/** The read options the design reads make. */
interface DesignRead {
  where: Record<string, unknown>;
  pagination: { limit: number; page?: number };
  sort?: { field: string; direction: "asc" | "desc" };
  select: Record<string, boolean>;
  depth: number;
}

/**
 * The plugin's own read of a collection, on a write's transaction or, for
 * a read with none, as last committed.
 */
export interface OwnDesignReads {
  listEntries(
    slug: string,
    options: DesignRead
  ): Promise<{ data: readonly unknown[] }>;
  listEntriesInTransaction(
    tx: Tx,
    slug: string,
    options: DesignRead
  ): Promise<{ data: readonly unknown[] }>;
}

/**
 * How many published own designs one read takes, each with its document,
 * when a template's write or the start-up pass settles a collection's
 * entries.
 */
const DESIGN_PAGE = 100;

/** A row as read, or an empty one for anything else. */
function rowOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** The design reads of the templates collection `templates`, through `own`. */
export function entryDesignReads(
  own: OwnDesignReads,
  templates: string
): Pick<
  EntryClaimsDeps,
  "publishedOwnDesign" | "publishedDesigns" | "templatePaginates"
> {
  return {
    publishedOwnDesign: (collection, id, tx) =>
      publishedOwnDesign(own, templates, { collection, id }, tx),
    publishedDesigns: (collection, tx) =>
      publishedDesigns(own, templates, collection, tx),
    templatePaginates: (collection, tx?) =>
      templatePaginates(own, templates, collection, tx),
  };
}

/**
 * The entry's own design, or null where it has no published one: its
 * routing columns and its document alone, found by the unique key its entry
 * makes and compared again exactly, since a database may compare text
 * loosely.
 */
async function publishedOwnDesign(
  own: OwnDesignReads,
  templates: string,
  entry: { readonly collection: string; readonly id: string },
  tx: Tx
): Promise<OwnDesign | null> {
  const key = entryDesignKey(entry.collection, entry.id);
  const found = await own.listEntriesInTransaction(tx, templates, {
    where: { [TEMPLATE_ENTRY_FIELD]: { equals: key } },
    pagination: { limit: 1 },
    select: {
      id: true,
      [TEMPLATE_ENTRY_FIELD]: true,
      status: true,
      [TEMPLATE_CONTENT_FIELD]: true,
    },
    depth: 0,
  });
  const row = rowOf(found.data[0]);
  return row[TEMPLATE_ENTRY_FIELD] === key && row.status === "published"
    ? { paginates: splitsList(row[TEMPLATE_CONTENT_FIELD]) }
    : null;
}

/**
 * Every published own design of `collection`'s entries, by entry id, a page
 * at a time in a unique order, stopping on a short page (the total beside a
 * page is an unlocked count). Published ones only, filtered by the database,
 * since a draft design holds nothing; each row is still compared exactly
 * with the key its entry makes. Each document is judged and dropped, a page
 * of them at a time, since documents are large.
 */
async function publishedDesigns(
  own: OwnDesignReads,
  templates: string,
  collection: string,
  tx: Tx
): Promise<ReadonlyMap<string, OwnDesign>> {
  const designs = new Map<string, OwnDesign>();
  for (let page = 1; ; page += 1) {
    const found = await own.listEntriesInTransaction(tx, templates, {
      where: {
        [TEMPLATE_ENTRY_COLLECTION_FIELD]: { equals: collection },
        status: { equals: "published" },
      },
      pagination: { limit: DESIGN_PAGE, page },
      sort: { field: "id", direction: "asc" },
      select: {
        id: true,
        [TEMPLATE_ENTRY_FIELD]: true,
        [TEMPLATE_ENTRY_ID_FIELD]: true,
        status: true,
        [TEMPLATE_CONTENT_FIELD]: true,
      },
      depth: 0,
    });
    for (const value of found.data) {
      const row = rowOf(value);
      const id = row[TEMPLATE_ENTRY_ID_FIELD];
      if (
        typeof id === "string" &&
        row[TEMPLATE_ENTRY_FIELD] === entryDesignKey(collection, id) &&
        row.status === "published"
      ) {
        designs.set(id, { paginates: splitsList(row[TEMPLATE_CONTENT_FIELD]) });
      }
    }
    if (found.data.length < DESIGN_PAGE) return designs;
  }
}

/**
 * Whether `collection`'s published template splits a list into pages: false
 * where it has none, or none published.
 */
async function templatePaginates(
  own: OwnDesignReads,
  templates: string,
  collection: string,
  tx?: Tx
): Promise<boolean> {
  const read: DesignRead = {
    where: { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
    pagination: { limit: 1 },
    select: {
      id: true,
      [TEMPLATE_COLLECTION_FIELD]: true,
      status: true,
      [TEMPLATE_CONTENT_FIELD]: true,
    },
    depth: 0,
  };
  const found =
    tx === undefined
      ? await own.listEntries(templates, read)
      : await own.listEntriesInTransaction(tx, templates, read);
  const row = rowOf(found.data[0]);
  return (
    row[TEMPLATE_COLLECTION_FIELD] === collection &&
    row.status === "published" &&
    splitsList(row[TEMPLATE_CONTENT_FIELD])
  );
}
