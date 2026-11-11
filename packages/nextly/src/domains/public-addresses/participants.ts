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
import { getActiveHookRegistry } from "../../hooks/hook-registry";
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

/**
 * The list and its listeners, kept on `globalThis` so a module evaluated more
 * than once (Next.js and Turbopack can) still shares one list: a participant
 * added through one copy must be asked by the handler another copy keeps.
 */
const shared = globalThis as unknown as {
  __nextly_addressParticipants?: {
    participants: { runner: ParticipantRunner; owner: HookOwner }[];
    listeners: Set<(count: number) => void>;
  };
};
shared.__nextly_addressParticipants ??= {
  participants: [],
  listeners: new Set(),
};
const { participants, listeners } = shared.__nextly_addressParticipants;

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

/**
 * Forget every participant, as the plugins that added them are torn down with
 * the services: a stale one would be asked on the next boot's saves.
 */
export function clearParticipants(): void {
  if (participants.length === 0) return;
  participants.length = 0;
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

/**
 * The participants to ask now: every one but those whose plugin a config
 * reload switched off. The hook registry suspends that plugin's owner rather
 * than tearing it down, so its registration stays and resumes when it is
 * switched back on.
 */
function active(): ParticipantRunner[] {
  const suspended = new Set(getActiveHookRegistry().getSuspendedOwners());
  return participants
    .filter(entry => !suspended.has(entry.owner))
    .map(entry => entry.runner);
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
  const asked = active();
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
  const told = active();
  for (const runner of told) await runner.record(batch, tx);
}

/**
 * The refusal of `update`, whose `clash.address` another page holds: the
 * address and its language for the editor to act on, and both documents in
 * the log, since the editor may not be allowed to read the other.
 */
export function addressHeldError(
  update: HeldAddressUpdate,
  clash: { address: HeldAddress; heldBy: AddressHolder }
): NextlyError {
  const { address, heldBy } = clash;
  return NextlyError.duplicate({
    // Only the address and its language: the saver may not be allowed to
    // read the page holding it, so who holds it goes to the log alone.
    message: `${address.path} (${address.locale}) is already the address of another page. Choose another address for this entry.`,
    logContext: {
      reason: "public-address-held",
      address,
      holder: update.holder,
      heldBy,
    },
  });
}
