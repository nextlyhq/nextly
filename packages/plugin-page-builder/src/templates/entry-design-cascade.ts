/**
 * An entry's own design goes with its entry, and outlives the template it
 * was copied from: deleting the entry deletes the design, and deleting that
 * template empties the design's link to it, each in the same transaction,
 * by every path a delete takes (the admin, REST, the Direct API, a bulk
 * delete), so no own design is left naming an entry that is gone.
 *
 * @module templates/entry-design-cascade
 */
import type { PluginCollectionTransaction } from "@nextlyhq/plugin-sdk";

import { entryDesignKey, TEMPLATE_ENTRY_FIELD } from "../collections/templates";

import { isEntryDesign } from "./entry-designs";

/** The slice of an in-transaction write the cascade reads. */
interface DeletedWrite {
  readonly collection: string;
  readonly operation: "create" | "update" | "delete";
  readonly id: string;
  readonly transaction: PluginCollectionTransaction;
  /** The document as it stood before the write: for a delete, what it removes. */
  readonly originalData?: unknown;
}

/** What the cascade needs. */
export interface EntryDesignCascadeSetup {
  /** The RESOLVED templates slug: a host may rename it. */
  readonly templates: string;
  /** The page builder's own collections, whose entries have no own design. */
  readonly ownCollections: () => ReadonlySet<string>;
  /** The id of the own design held under `key`, read on `tx` for update, or null. */
  readonly designUnder: (
    tx: PluginCollectionTransaction,
    key: string
  ) => Promise<string | null>;
  /**
   * Empty, in `tx`, the `forkedFrom` of every own design copied from the
   * template `id`: a deleted template's copies are kept, and keep serving
   * their entries, but name no template that is gone.
   */
  readonly unlinkCopiesOf: (
    tx: PluginCollectionTransaction,
    id: string
  ) => Promise<void>;
  readonly deleteInTransaction: (
    tx: PluginCollectionTransaction,
    templates: string,
    id: string
  ) => Promise<unknown>;
}

/** Where the cascade is registered: core's in-transaction phase. */
interface InTransactionHooks {
  onInTransaction(
    collection: string,
    handler: (write: DeletedWrite) => Promise<void>
  ): void;
}

/** Register the cascade on every collection's deletes. */
export function registerEntryDesignCascade(
  hooks: InTransactionHooks,
  setup: EntryDesignCascadeSetup
): void {
  hooks.onInTransaction("*", write => deleteEntryDesign(write, setup));
}

/**
 * What a delete takes from the page builder's templates: a template's copies
 * lose their link to it, and an entry's own design goes with its entry.
 */
async function deleteEntryDesign(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<void> {
  if (write.operation !== "delete") return;
  if (write.collection === setup.templates) {
    await unlinkDeletedTemplate(write, setup);
    return;
  }
  await deleteDesignOfEntry(write, setup);
}

/**
 * Empty the link of every own design copied from the template `write`
 * deletes. Only a collection's template is copied: an own design deleted
 * (with its entry, or removed) has no copies to look for.
 */
async function unlinkDeletedTemplate(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<void> {
  const removed = write.originalData;
  if (
    typeof removed === "object" &&
    removed !== null &&
    isEntryDesign(removed as Record<string, unknown>)
  ) {
    return;
  }
  await setup.unlinkCopiesOf(write.transaction, write.id);
}

/**
 * Delete the own design of the entry `write` deletes, if it has one, in the
 * delete's transaction.
 *
 * No lock is taken for it: the delete locked the entry's row for update
 * before it removed it, and every write of a new own design holds that row
 * for share in its own transaction (`entry-design-write`). So a design
 * committed before the delete went on is read here, and one written after
 * waits for the delete and is refused, its entry gone. Read for update,
 * since it is deleted next: one read of the unique key per entry deleted.
 * It is not skipped for a collection found to have no designs earlier in the
 * same transaction, since a bulk delete locks each entry's row only when it
 * reaches it, and a design given to a later entry meanwhile commits first
 * and must be found.
 */
async function deleteDesignOfEntry(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<void> {
  // A page, a template or any other of the plugin's own documents is not an
  // entry a template serves.
  if (setup.ownCollections().has(write.collection)) return;
  const key = entryDesignKey(write.collection, write.id);
  const design = await setup.designUnder(write.transaction, key);
  if (design !== null) {
    await setup.deleteInTransaction(write.transaction, setup.templates, design);
  }
}

/** The where clause finding the own design held under `key`. */
export function designUnderWhere(key: string): Record<string, unknown> {
  return { [TEMPLATE_ENTRY_FIELD]: { equals: key } };
}
