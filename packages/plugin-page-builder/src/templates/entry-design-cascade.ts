/**
 * An entry's own design goes with its entry: deleting the entry deletes the
 * design in the same transaction, by every path a delete takes (the admin,
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
  /** The id of the own design held under `key`, read as committed, or null. */
  readonly designUnder: (key: string) => Promise<string | null>;
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
  // A page, a template or any other of the plugin's own documents is not an
  // entry a template serves.
  if (setup.ownCollections().has(write.collection)) return;
  const design = await setup.designUnder(
    entryDesignKey(write.collection, write.id)
  );
  if (design === null) return;
  await setup.deleteInTransaction(write.transaction, setup.templates, design);
}

/** The where clause finding the own design held under `key`. */
export function designUnderWhere(key: string): Record<string, unknown> {
  return { [TEMPLATE_ENTRY_FIELD]: { equals: key } };
}
