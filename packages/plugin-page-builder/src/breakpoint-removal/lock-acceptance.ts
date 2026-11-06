/**
 * What a lock lets through while a breakpoint removal, or its undo, is open:
 * exactly the strip, or exactly the restore, of what is stored, and nothing
 * more.
 *
 * A removal strips every value under the removed breakpoints, locked blocks,
 * `contentOnly` slots and locked shared styles included, since a lock holds a
 * design an author chose and a value no stylesheet emits is no part of it. So
 * a write whose locked parts are the stored ones stripped (`strip`) is
 * accepted while the removal is open; anything beyond that strip is still
 * refused, and with no removal open nothing extra is accepted at all. An
 * undo puts back what the removal kept (`restore`), locked parts included,
 * and the same holds: exactly that restore, and nothing beyond it.
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

import type { ClassesFragment } from "./fragments";
import { restoreDocument, type ValueAddress } from "./restore";
import { stripDocument, type DocumentFragment, type Removal } from "./strip";

/**
 * The breakpoint work open now, as a lock judges a write against it:
 * - `strip`, a removal taking every value under its ids out;
 * - `restore`, an undo putting back what a removal kept, which differs per
 *   value: `fragmentsFor` answers, for one stored value, each stored form's
 *   kept fragments, newest first; and the shared styles' fragment with every
 *   id the removal took out, when it kept one.
 */
export type OpenWork =
  | { readonly kind: "strip"; readonly removal: Removal }
  | {
      readonly kind: "restore";
      readonly fragmentsFor: (
        target: ValueAddress
      ) => readonly (readonly DocumentFragment[])[];
      readonly classes?: {
        readonly fragment: ClassesFragment;
        readonly ids: ReadonlySet<string>;
      };
    };

/** Reads the open work: `null` when none is open; throws when unreadable. */
export type OpenRemovalReader = () => Promise<OpenWork | null>;

/**
 * The open work a write's locks may be measured against, or `null` when
 * nothing extra may be accepted: no reader, no entry write, a write inside a
 * transaction, no work open, or work that cannot be read.
 */
export async function openRemovalFor(
  read: OpenRemovalReader | undefined,
  write: Pick<PluginFieldWrite, "inTransaction"> | undefined
): Promise<OpenWork | null> {
  if (read === undefined || write === undefined || write.inTransaction) {
    return null;
  }
  try {
    return await read();
  } catch {
    return null;
  }
}

/** Where a field write's value is stored, as a lock names it. */
export function lockTargetOf(
  write: Pick<PluginFieldWrite, "kind" | "slug" | "id" | "locale">,
  field: string
): ValueAddress {
  return {
    kind: write.kind,
    slug: write.slug,
    ...(write.id === undefined ? {} : { id: write.id }),
    field,
    ...(write.locale === undefined ? {} : { locale: write.locale }),
  };
}

/**
 * The stored forms as the open work leaves them, for a lock to accept: one
 * per stored form it changes, and none where it changes nothing. A strip is
 * the same for every value; a restore puts back what this value's own forms
 * kept, each form's fragments tried in turn, so a write of either form is
 * accepted as exactly its own restore.
 */
export function acceptedForms(
  stored: readonly BlockDocument[],
  work: OpenWork,
  target: ValueAddress
): BlockDocument[] {
  if (work.kind === "strip") {
    return stored
      .map(form => stripDocument(form, work.removal))
      .filter((form, index) => form !== stored[index]);
  }
  const kept = work.fragmentsFor(target);
  return stored.flatMap(form =>
    kept
      .map(fragments => restoreDocument(form, fragments).value)
      .filter(restored => restored !== form)
  );
}
