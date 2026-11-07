/**
 * An entry's own design goes with its entry, and outlives the template it
 * was copied from: deleting the entry deletes the design, and deleting that
 * template empties the design's link to it, each in the same transaction, by every path a delete takes (the admin,
 * REST, the Direct API, a bulk delete), so no own design is left naming an
 * entry that is gone.
 *
 * @module templates/entry-design-cascade
 */
import type { PluginCollectionTransaction } from "@nextlyhq/plugin-sdk";

import { entryDesignKey, TEMPLATE_ENTRY_FIELD } from "../collections/templates";

/** The slice of an in-transaction write the cascade reads. */
interface DeletedWrite {
  readonly collection: string;
  readonly operation: "create" | "update" | "delete";
  readonly id: string;
  readonly transaction: PluginCollectionTransaction;
}

/** What the cascade needs. */
export interface EntryDesignCascadeSetup {
  /** The RESOLVED templates slug: a host may rename it. */
  readonly templates: string;
  /** The page builder's own collections, whose entries have no own design. */
  readonly ownCollections: () => ReadonlySet<string>;
  /**
   * Whether `collection` has a template, read on `tx`: only a templated
   * collection's entries can have an own design, so only their deletes look
   * for one or take the entry's lock.
   */
  readonly hasTemplate: (
    tx: PluginCollectionTransaction,
    collection: string
  ) => Promise<boolean>;
  /**
   * Hold the entry's own lock row until the transaction ends, the one giving
   * the entry its own design takes, so the two take turns.
   */
  readonly lockEntry: (
    tx: PluginCollectionTransaction,
    entry: { readonly collection: string; readonly id: string }
  ) => Promise<void>;
  /** The id of the own design held under `key`, read on `tx`, or null. */
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

/** Delete the own design of the entry `write` deletes, if it has one. */
export async function deleteEntryDesign(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<void> {
  if (write.operation !== "delete") return;
  if (write.collection === setup.templates) {
    await setup.unlinkCopiesOf(write.transaction, write.id);
    return;
  }
  // A page, a template or any other of the plugin's own documents is not an
  // entry a template serves.
  if (setup.ownCollections().has(write.collection)) return;
  if (!(await setup.hasTemplate(write.transaction, write.collection))) return;
  // Under the entry's lock, which giving it a design takes too: one given
  // first has committed and is read here, and one given after waits, then
  // finds the entry gone.
  await setup.lockEntry(write.transaction, {
    collection: write.collection,
    id: write.id,
  });
  const design = await setup.designUnder(
    write.transaction,
    entryDesignKey(write.collection, write.id)
  );
  if (design === null) return;
  await setup.deleteInTransaction(write.transaction, setup.templates, design);
}

/** The where clause finding the own design held under `key`. */
export function designUnderWhere(key: string): Record<string, unknown> {
  return { [TEMPLATE_ENTRY_FIELD]: { equals: key } };
}
