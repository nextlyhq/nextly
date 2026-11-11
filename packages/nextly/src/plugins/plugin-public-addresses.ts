/**
 * `ctx.publicAddresses`: how a plugin that keeps a record of who holds each
 * public address takes part in keeping every address to one page.
 *
 * A participant answers, from its own record, who holds an address, and is
 * told what each document holds after a save. Core asks every participant
 * inside each save and refuses one whose address another page holds; a
 * plugin that moves addresses itself asks the same way with `move`. Core keeps
 * no record and decides no clash.
 *
 * @module plugins/plugin-public-addresses
 * @experimental
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  addressFingerprint,
  heldPage,
} from "../domains/public-addresses/held-listing";
import {
  addParticipant,
  firstHolder,
  recordEverywhere,
  removeParticipant,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantRunner,
} from "../domains/public-addresses/participants";
import type { PublicAddressType } from "../domains/public-addresses/public-address";
import type { HookOwner } from "../hooks/types";

import type { PluginTransaction } from "./database/plugin-database";
import {
  transactionOf,
  type PluginCollectionTransaction,
} from "./service-opts";

/**
 * @experimental A plugin's record of who holds each public address, as core
 * asks it. Both functions run on the caller's transaction: `db` is the
 * plugin's database bound to it, so what `record` writes commits or rolls back
 * with the save.
 */
export interface PublicAddressParticipant {
  /**
   * Who holds `address` in this record, other than `asker`, as if every
   * update in `batch` were applied, or null. An exact address is held where
   * it or a range above it is; a range where anything at or below it is.
   */
  holderOf(
    address: HeldAddress,
    asker: AddressHolder,
    batch: readonly HeldAddressUpdate[],
    tx: { db: PluginTransaction }
  ): Promise<AddressHolder | null>;
  /**
   * Replace what each holder in `batch` holds with its `holds`, keeping the
   * ones this plugin is responsible for. Release before claiming, so a swap
   * commits under a unique key.
   */
  record(
    batch: readonly HeldAddressUpdate[],
    tx: { db: PluginTransaction }
  ): Promise<void>;
}

/** @experimental A refused update from {@link PluginPublicAddresses.move}. */
export interface RefusedAddressUpdate {
  update: HeldAddressUpdate;
  address: HeldAddress;
  heldBy: AddressHolder;
}

/** @experimental `ctx.publicAddresses`. */
export interface PluginPublicAddresses {
  /** Take part: be asked on every save, and told what each document holds. */
  participate(participant: PublicAddressParticipant): void;
  /** Stop taking part. */
  withdraw(participant: PublicAddressParticipant): void;
  /**
   * Make `updates` together, on `transaction` (from
   * `ctx.services.collections.withTransaction`): every participant is asked
   * about each, the whole batch in view, and told the ones nobody refused.
   * Refusals come back rather than throwing, for the caller to act on.
   */
  move(
    updates: readonly HeldAddressUpdate[],
    transaction: PluginCollectionTransaction
  ): Promise<{ refused: RefusedAddressUpdate[] }>;
  /**
   * One page of a type's documents, oldest first, each with every address it
   * holds now; `next` is the cursor of the following page.
   *
   * Waits for the boot to finish, so call it from work `init` or `onReady`
   * starts without awaiting: awaited inside them, which the boot waits for,
   * it would never finish. `fingerprint` is the same.
   */
  held(args: {
    type: PublicAddressType;
    after?: string;
    limit?: number;
  }): Promise<{ items: HeldAddressUpdate[]; next?: string }>;
  /** Changes when any address template or the language list does. */
  fingerprint(): Promise<string>;
}

/** What the plugin context hands this surface. */
export interface PublicAddressesDeps {
  bindTo: <T>(
    tx: TransactionContext,
    work: (db: PluginTransaction) => Promise<T>
  ) => Promise<T>;
  owner: HookOwner;
  /** Called with the undo of each `participate`, so teardown withdraws it. */
  onTeardown: (undo: () => void) => void;
}

/** Build `ctx.publicAddresses` for one plugin. */
export function pluginPublicAddresses(
  deps: PublicAddressesDeps
): PluginPublicAddresses {
  // One runner per participant, so `withdraw` removes by identity.
  const runners = new WeakMap<PublicAddressParticipant, ParticipantRunner>();
  const runnerOf = (participant: PublicAddressParticipant) => {
    const known = runners.get(participant);
    if (known) return known;
    const runner: ParticipantRunner = {
      holderOf: (address, asker, batch, tx) =>
        deps.bindTo(tx, db =>
          participant.holderOf(address, asker, batch, { db })
        ),
      record: (batch, tx) =>
        deps.bindTo(tx, db => participant.record(batch, { db })),
    };
    runners.set(participant, runner);
    return runner;
  };

  return {
    participate(participant) {
      const runner = runnerOf(participant);
      addParticipant(runner, deps.owner);
      deps.onTeardown(() => removeParticipant(runner));
    },
    withdraw(participant) {
      removeParticipant(runnerOf(participant));
    },
    async move(updates, transaction) {
      const { tx, scope } = transactionOf(transaction);
      // Refused once the transaction has ended, and held open until the whole
      // move settles, as every method taking this token is: a participant's
      // writes must never run after the caller's transaction is gone.
      scope.assertOpen();
      return scope.track(settleMoves(updates, tx));
    },
    held: args => heldPage(args),
    fingerprint: () => addressFingerprint(),
  };
}

/**
 * Ask every participant about each of `updates`, the whole batch in view, and
 * record the ones nobody refused, returning the refused.
 */
async function settleMoves(
  updates: readonly HeldAddressUpdate[],
  tx: TransactionContext
): Promise<{ refused: RefusedAddressUpdate[] }> {
  const refused: RefusedAddressUpdate[] = [];
  let standing = [...updates];
  // Asked again until nothing more is refused: an update judged against a
  // batch in which another lets an address go must not stand once that
  // other is refused and keeps it.
  for (;;) {
    const refusedNow: RefusedAddressUpdate[] = [];
    for (const update of standing) {
      const clash = await firstHolder(update, standing, tx);
      if (clash !== null) refusedNow.push({ update, ...clash });
    }
    if (refusedNow.length === 0) break;
    refused.push(...refusedNow);
    standing = standing.filter(
      update => !refusedNow.some(r => r.update === update)
    );
  }
  if (standing.length > 0) await recordEverywhere(standing, tx);
  return { refused };
}
