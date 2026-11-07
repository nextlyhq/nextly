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

import { isEntryDesign } from "./entry-designs";

/** The slice of an in-transaction write the cascade reads. */
interface DeletedWrite {
  readonly collection: string;
  readonly operation: "create" | "update" | "delete";
  readonly id: string;
  readonly transaction: PluginCollectionTransaction;
  /** The same for every handler call on one transaction. */
  readonly transactionKey?: object;
  /** The document as it stood before the write: for a delete, what it removes. */
  readonly originalData?: unknown;
}

/** What the cascade needs. */
export interface EntryDesignCascadeSetup {
  /** The RESOLVED templates slug: a host may rename it. */
  readonly templates: string;
  /** The page builder's own collections, whose entries have no own design. */
  readonly ownCollections: () => ReadonlySet<string>;
  /**
   * Whether any entry of `collection` has an own design, read on `tx`: asked
   * once per collection and transaction, so a bulk delete of a collection
   * with none makes one read, not one per entry. Asked of the designs
   * themselves, not of the collection's template, since a design outlives
   * the template it was copied from.
   */
  readonly hasDesigns: (
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
  /** Remove the entry's lock row, in `tx`, once the entry is gone. */
  readonly releaseEntryLock: (
    tx: PluginCollectionTransaction,
    entry: { readonly collection: string; readonly id: string }
  ) => Promise<void>;
  /** The id of the own design held under `key`, read on `tx` (shared), or null. */
  readonly designAt: (
    tx: PluginCollectionTransaction,
    key: string
  ) => Promise<string | null>;
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
 * Whether each collection has own designs, per transaction: one transaction's
 * every handler call shares its key, so a bulk delete asks once per collection.
 */
const designsByTransaction = new WeakMap<
  object,
  Map<string, Promise<boolean>>
>();

/** `setup.hasDesigns`, asked once per collection on the transaction keyed `key`. */
function hasDesignsOnce(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<boolean> {
  const key = write.transactionKey;
  if (key === undefined)
    return setup.hasDesigns(write.transaction, write.collection);
  let known = designsByTransaction.get(key);
  if (known === undefined) {
    known = new Map();
    designsByTransaction.set(key, known);
  }
  let answer = known.get(write.collection);
  if (answer === undefined) {
    answer = setup.hasDesigns(write.transaction, write.collection);
    known.set(write.collection, answer);
  }
  return answer;
}

/** Delete the own design of the entry `write` deletes, if it has one. */
async function deleteEntryDesign(
  write: DeletedWrite,
  setup: EntryDesignCascadeSetup
): Promise<void> {
  if (write.operation !== "delete") return;
  if (write.collection === setup.templates) {
    // Only a collection's template is copied: an own design deleted (with
    // its entry, or removed) has no copies to look for.
    const removed = write.originalData;
    if (
      typeof removed === "object" &&
      removed !== null &&
      isEntryDesign(removed as Record<string, unknown>)
    ) {
      return;
    }
    await setup.unlinkCopiesOf(write.transaction, write.id);
    return;
  }
  // A page, a template or any other of the plugin's own documents is not an
  // entry a template serves.
  if (setup.ownCollections().has(write.collection)) return;
  if (!(await hasDesignsOnce(write, setup))) return;
  const entry = { collection: write.collection, id: write.id };
  const key = entryDesignKey(write.collection, write.id);
  // An entry with no design takes no lock: a design being given to it at
  // once is removed by that give, which checks the entry again once it has
  // committed.
  if ((await setup.designAt(write.transaction, key)) === null) return;
  // Under the entry's lock, which giving it a design takes too, read again
  // for update, then deleted, and the lock row with it: the entry is gone.
  await setup.lockEntry(write.transaction, entry);
  const design = await setup.designUnder(write.transaction, key);
  if (design !== null) {
    await setup.deleteInTransaction(write.transaction, setup.templates, design);
  }
  await setup.releaseEntryLock(write.transaction, entry);
}

/** The where clause finding the own design held under `key`. */
export function designUnderWhere(key: string): Record<string, unknown> {
  return { [TEMPLATE_ENTRY_FIELD]: { equals: key } };
}
