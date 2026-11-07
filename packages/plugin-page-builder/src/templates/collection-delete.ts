/**
 * What deleting a collection takes from the page builder, and its removal in
 * the delete's own transaction (`ctx.hooks.onCollectionDelete`).
 *
 * A collection's template, and each of its entries' own designs, are rows of
 * the plugin's `templates` collection that name the collection by slug. Left
 * behind by the collection's delete, they would draw a collection that no
 * longer exists, and the template's place would stay taken for a collection
 * created later under the same slug. So the delete dialog lists them, and the
 * delete removes them with the collection, or not at all.
 *
 * A template names its collection in `collection`. An entry's own design
 * names the collection of its entry in `entryCollection`, and the entry in
 * `entryId`.
 *
 * The plugin's own collections are skipped: none of them is drawn with a
 * template, and deleting one is not this module's to answer for.
 *
 * A template written while its collection is being deleted is the other
 * half ({@link holdTemplateCollection}): the write holds the collection's
 * registry row for share in its own transaction, which the delete holds for
 * update before it reads what to remove. So the write either commits before
 * that read, and is removed with the collection, or waits and is refused
 * once the collection is gone. Without the hold, a template created after the
 * delete's read and committed after it would be left drawing nothing, and
 * would take the place of a collection later created under the same slug.
 *
 * @module templates/collection-delete
 */
import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
} from "../collections/templates";

import { templateCollectionRefusal } from "./template-guard";

/** How many designs one read takes. */
const PAGE = 100;

/** One thing deleting a collection takes with it, as the dialog lists it. */
export interface DeleteImpactItem {
  readonly label: string;
  readonly kind: string;
}

/** A page of rows, as the services answer a list. */
interface Page {
  data: readonly Record<string, unknown>[];
}

/** List options, as the services take them. */
interface ListOptions {
  where: Record<string, unknown>;
  pagination: { limit: number; page?: number };
  depth: number;
}

/** The reads and writes the impact and the removal make. */
export interface TemplateDeleteServices<Tx> {
  /** The plugin's own read of its templates, hook-free and as the system. */
  listTemplates(options: ListOptions): Promise<Page>;
  /** The same read on the delete's transaction, rows locked for update. */
  listTemplatesInTransaction(tx: Tx, options: ListOptions): Promise<Page>;
  /** Delete one template on the delete's transaction. */
  deleteTemplateInTransaction(tx: Tx, id: string): Promise<unknown>;
  /** The entries of `collection` with these ids, as the system. */
  listEntries(collection: string, ids: readonly string[]): Promise<Page>;
}

/** What an in-transaction handler is told about a template's write. */
interface TemplateWrite<Tx> {
  readonly operation: "create" | "update" | "delete";
  readonly data?: Record<string, unknown>;
  readonly originalData?: Record<string, unknown>;
  readonly transaction: Tx;
}

/**
 * The in-transaction handler that holds, for the rest of a template's write,
 * each collection the template newly names: on a create, and on an update
 * that points it at another. One that no longer exists refuses the write, as
 * the guard refuses a collection that is not there.
 */
export function holdTemplateCollection<Tx>(
  hold: (tx: Tx, collection: string) => Promise<boolean>
): (write: TemplateWrite<Tx>) => Promise<void> {
  return async write => {
    if (write.operation === "delete") return;
    for (const field of [
      TEMPLATE_COLLECTION_FIELD,
      TEMPLATE_ENTRY_COLLECTION_FIELD,
    ]) {
      const collection = write.data?.[field];
      if (typeof collection !== "string" || collection === "") continue;
      if (
        write.operation === "update" &&
        write.originalData?.[field] === collection
      ) {
        continue;
      }
      if (!(await hold(write.transaction, collection))) {
        throw templateCollectionRefusal(
          `There is no collection "${collection}" to give a template.`
        );
      }
    }
  };
}

/** The templates rows that name `collection`: its template and own designs. */
function namingCollection(collection: string): Record<string, unknown> {
  return {
    or: [
      { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
      { [TEMPLATE_ENTRY_COLLECTION_FIELD]: { equals: collection } },
    ],
  };
}

/** A row's string field, or undefined. */
function stringOf(row: Record<string, unknown>, field: string) {
  const value = row[field];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * Collection-delete handlers for the templates collection `templates`,
 * skipping the plugin's own collections (`own`).
 */
export function templateCollectionDelete<Tx>(args: {
  services: TemplateDeleteServices<Tx>;
  own: () => ReadonlySet<string>;
}): {
  impact: (slug: string) => Promise<DeleteImpactItem[]>;
  inTransaction: (context: { slug: string; transaction: Tx }) => Promise<void>;
} {
  const { services, own } = args;
  return {
    impact: async slug => {
      if (own().has(slug)) return [];
      const items: DeleteImpactItem[] = [];
      for (let page = 1; ; page += 1) {
        const found = await services.listTemplates({
          where: namingCollection(slug),
          pagination: { limit: PAGE, page },
          depth: 0,
        });
        // A page's own designs are named by their entries' titles, read in
        // one list per page rather than one read per design.
        const designs = found.data.filter(
          row => stringOf(row, TEMPLATE_ENTRY_COLLECTION_FIELD) === slug
        );
        const entryIds = designs.flatMap(row => {
          const id = stringOf(row, TEMPLATE_ENTRY_ID_FIELD);
          return id === undefined ? [] : [id];
        });
        const titles = new Map<string, string>();
        if (entryIds.length > 0) {
          const entries = await services.listEntries(slug, entryIds);
          for (const entry of entries.data) {
            const id = stringOf(entry, "id");
            const title = stringOf(entry, "title");
            if (id !== undefined && title !== undefined) titles.set(id, title);
          }
        }
        for (const row of found.data) {
          const id = stringOf(row, "id") ?? "";
          if (stringOf(row, TEMPLATE_ENTRY_COLLECTION_FIELD) === slug) {
            const entryId = stringOf(row, TEMPLATE_ENTRY_ID_FIELD);
            items.push({
              label:
                (entryId === undefined ? undefined : titles.get(entryId)) ??
                entryId ??
                id,
              kind: "design",
            });
          } else {
            items.push({
              label: stringOf(row, "title") ?? id,
              kind: "template",
            });
          }
        }
        if (found.data.length < PAGE) return items;
      }
    },
    inTransaction: async ({ slug, transaction }) => {
      if (own().has(slug)) return;
      // The first page again after each is deleted: what was deleted is gone
      // from the transaction's own reads, so the next rows move up to it.
      // Locked for update, so a template saved meanwhile elsewhere waits for
      // the delete instead of surviving it.
      for (;;) {
        const found = await services.listTemplatesInTransaction(transaction, {
          where: namingCollection(slug),
          pagination: { limit: PAGE },
          depth: 0,
        });
        let deleted = 0;
        for (const row of found.data) {
          const id = stringOf(row, "id");
          if (id !== undefined) {
            await services.deleteTemplateInTransaction(transaction, id);
            deleted += 1;
          }
        }
        // A short page was the last; a page with nothing to delete would be
        // read again unchanged.
        if (found.data.length < PAGE || deleted === 0) return;
      }
    },
  };
}
