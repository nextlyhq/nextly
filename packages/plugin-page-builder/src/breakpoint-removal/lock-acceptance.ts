/**
 * What a lock lets through while a breakpoint removal is open: exactly the
 * strip of what is stored, and nothing more.
 *
 * A removal strips every value under the removed breakpoints, locked blocks,
 * `contentOnly` slots and locked shared styles included, since a lock holds a
 * design an author chose and a value no stylesheet emits is no part of it. So
 * a write whose locked parts are the stored ones stripped (`strip`) is
 * accepted while the removal is open; anything beyond that strip is still
 * refused, and with no removal open nothing extra is accepted at all.
 *
 * The open removal is read from the plugin's own table, which is reached on
 * the pool rather than on the write's connection. A write inside a transaction
 * is therefore never accepted this way: the read could wait behind the
 * transaction it is part of. Where the removal cannot be read, nothing is
 * accepted either; the lock refuses as it always did.
 *
 * @module breakpoint-removal/lock-acceptance
 * @experimental
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import { stripDocument, type Removal } from "./strip";

/** Reads the open removal: `null` when none is open; throws when unreadable. */
export type OpenRemovalReader = () => Promise<Removal | null>;

/**
 * The open removal a write's locks may be measured against, or `null` when
 * nothing extra may be accepted: no reader, no entry write, a write inside a
 * transaction, no removal open, or one that cannot be read.
 */
export async function openRemovalFor(
  read: OpenRemovalReader | undefined,
  write: Pick<PluginFieldWrite, "inTransaction"> | undefined
): Promise<Removal | null> {
  if (read === undefined || write === undefined || write.inTransaction) {
    return null;
  }
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * The stored forms as the open removal strips them, for a lock to accept: one
 * per stored form the strip changes, and none where it changes nothing.
 */
export function strippedForms(
  stored: readonly BlockDocument[],
  removal: Removal
): BlockDocument[] {
  return stored
    .map(form => stripDocument(form, removal))
    .filter((form, index) => form !== stored[index]);
}
