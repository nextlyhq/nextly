/**
 * The plugins that keep a record of who holds each public address, and the
 * one question they share: is this address held by another page?
 *
 * Core keeps no such record and decides no clash itself. Each participant
 * answers from its own record, and every participant is asked, so a page one
 * plugin records (a Page Builder page) and an entry another records (the SEO
 * plugin's) are never given one address. Every participant is then told what
 * each document holds now, and keeps the part it is responsible for.
 *
 * @module domains/public-addresses/participants
 * @experimental
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";
import type { HookOwner } from "../../hooks/types";

/**
 * @experimental A public address in one language. A `range` is the path and
 * every path below it, as a paginated list's later pages are held.
 */
export interface HeldAddress {
  locale: string;
  path: string;
  range?: boolean;
}

/**
 * @experimental What holds an address: a document, by its collection's slug
 * (`single:<slug>` for a Single) and id, or anything else a participant holds
 * one for, under a `collection` of its own choosing. `label` names it in a
 * refusal.
 */
export interface AddressHolder {
  collection: string;
  id: string;
  label?: string;
}

/**
 * @experimental Everything `holder` holds now, replacing what it held before.
 * An update holding nothing lets every address go.
 */
export interface HeldAddressUpdate {
  holder: AddressHolder;
  holds: readonly HeldAddress[];
}

/** A participant as core runs it: on the adapter's transaction. */
export interface ParticipantRunner {
  /**
   * Who holds `address` in this participant's record, other than `asker`, as
   * if every update in `batch` were applied, or null.
   */
  holderOf(
    address: HeldAddress,
    asker: AddressHolder,
    batch: readonly HeldAddressUpdate[],
    tx: TransactionContext
  ): Promise<AddressHolder | null>;
  /** Replace what each holder in `batch` holds, releases before claims. */
  record(
    batch: readonly HeldAddressUpdate[],
    tx: TransactionContext
  ): Promise<void>;
}

const participants: { runner: ParticipantRunner; owner: HookOwner }[] = [];
const listeners = new Set<(count: number) => void>();

function changed(): void {
  for (const listener of listeners) listener(participants.length);
}

/** Add a participant, owned by `owner` (the plugin it belongs to). */
export function addParticipant(
  runner: ParticipantRunner,
  owner: HookOwner
): void {
  if (participants.some(entry => entry.runner === runner)) return;
  participants.push({ runner, owner });
  changed();
}

/** Remove a participant, by the runner {@link addParticipant} was given. */
export function removeParticipant(runner: ParticipantRunner): void {
  const at = participants.findIndex(entry => entry.runner === runner);
  if (at === -1) return;
  participants.splice(at, 1);
  changed();
}

/** Whether any plugin takes part, so a site with none does no address work. */
export function hasParticipants(): boolean {
  return participants.length > 0;
}

/**
 * Call `listener` with the number of participants each time it changes, until
 * the returned function is called.
 */
export function onParticipantsChange(
  listener: (count: number) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameHolder(a: AddressHolder, b: AddressHolder): boolean {
  return a.collection === b.collection && a.id === b.id;
}

/**
 * The first address `update` takes that a participant says another holds,
 * with that holder, or null where every participant lets it have them all.
 * Every participant is asked about every address, in order; one that throws
 * fails the question, since a record that cannot be read cannot clear one.
 */
export async function firstHolder(
  update: HeldAddressUpdate,
  batch: readonly HeldAddressUpdate[],
  tx: TransactionContext
): Promise<{ address: HeldAddress; heldBy: AddressHolder } | null> {
  // Taken once, so a participant added meanwhile is asked on the next write.
  const asked = participants.map(entry => entry.runner);
  let clash: { address: HeldAddress; heldBy: AddressHolder } | null = null;
  for (const runner of asked) {
    for (const address of update.holds) {
      const heldBy = await runner.holderOf(address, update.holder, batch, tx);
      if (
        clash === null &&
        heldBy !== null &&
        !sameHolder(heldBy, update.holder)
      ) {
        clash = { address, heldBy };
      }
    }
  }
  return clash;
}

/** Tell every participant what each holder in `batch` holds now. */
export async function recordEverywhere(
  batch: readonly HeldAddressUpdate[],
  tx: TransactionContext
): Promise<void> {
  const told = participants.map(entry => entry.runner);
  for (const runner of told) await runner.record(batch, tx);
}

/** How a refusal names a holder: its label, or its id. */
function named(holder: AddressHolder): string {
  return holder.label !== undefined && holder.label !== ""
    ? `"${holder.label}"`
    : `the entry ${holder.id}`;
}

/**
 * The refusal of `update`, whose `clash.address` another page holds: the
 * address, its language and both documents, for the editor to act on.
 */
export function addressHeldError(
  update: HeldAddressUpdate,
  clash: { address: HeldAddress; heldBy: AddressHolder }
): NextlyError {
  const { address, heldBy } = clash;
  return NextlyError.duplicate({
    message: `${address.path} (${address.locale}) is already the address of ${named(heldBy)} in ${heldBy.collection}. Choose another address for this entry.`,
    logContext: {
      reason: "public-address-held",
      address,
      holder: update.holder,
      heldBy,
    },
  });
}
