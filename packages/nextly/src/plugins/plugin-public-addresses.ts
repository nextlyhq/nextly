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
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import { toDbError } from "../database/errors";
import { whenServicesRegistered } from "../di/service-access";
import type { HeldDocument } from "../domains/public-addresses/held-listing";
import {
  addParticipant,
  firstHolder,
  newSaveKey,
  recordEverywhere,
  removeParticipant,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantRunner,
} from "../domains/public-addresses/participants";
import {
  siteTypes,
  type PublicAddressType,
} from "../domains/public-addresses/public-address";
import { NextlyError } from "../errors/nextly-error";
import type { HookOwner } from "../hooks/types";

import type { PluginTransaction } from "./database/plugin-database";
import {
  transactionOf,
  withWriteTransactionToken,
  type PluginCollectionTransaction,
} from "./service-opts";

/**
 * @experimental What a participant is handed to reach the save's transaction:
 * `db`, the plugin's tables bound to it, and `transaction`, the token
 * `ctx.services.collections`' in-transaction methods take, so a record kept
 * in the plugin's own collection is written with the save. Both refuse once
 * the call has settled.
 */
export interface ParticipantTransaction {
  db: PluginTransaction;
  transaction: PluginCollectionTransaction;
  /**
   * @experimental The same object for every call core makes about one
   * question: each `holderOf` of one save, or of one `move`, and the
   * `record` that follows. The next save or `move` gets a new one, even on
   * the same transaction. It reaches nothing itself; a participant keeps by
   * it what it has already done for the question, such as a lock row it has
   * taken.
   *
   * Narrower than `InTransactionContext.transactionKey`, which is one object
   * for the whole transaction. A transaction can roll back to a savepoint
   * between two saves (one entry of a batch refused), and PostgreSQL then
   * lets go of the row locks taken after the savepoint while MySQL keeps
   * them, so what was done for an earlier save may not stand for the next.
   * Within one question core opens no savepoint between the calls, so what a
   * participant did earlier in it still stands; a participant that rolls
   * back a savepoint of its own must forget what it did inside it.
   */
  saveKey: object;
}

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
    tx: ParticipantTransaction
  ): Promise<AddressHolder | null>;
  /**
   * Replace what each holder in `batch` holds with its `holds`, keeping the
   * ones this plugin is responsible for. Release before claiming, so a swap
   * commits under a unique key.
   */
  record(
    batch: readonly HeldAddressUpdate[],
    tx: ParticipantTransaction
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
   * One page of a type's documents, in id order, each with every address it
   * holds now and when it was made; `next` is the cursor of the following
   * page. Paged by id, so documents deleted or made meanwhile never move one
   * not yet read behind the cursor.
   *
   * Waits for the boot to finish, so call it from work `init` or `onReady`
   * starts without awaiting: awaited inside them, which the boot waits for,
   * it would never finish. `fingerprint` is the same.
   */
  held(args: {
    type: PublicAddressType;
    after?: string;
    limit?: number;
  }): Promise<{ items: HeldDocument[]; next?: string }>;
  /**
   * Changes when any address template, the language list or the fallback
   * settings do.
   */
  fingerprint(): Promise<string>;
  /**
   * The site's own content types, declared in code or made in the Schema
   * Builder, never a plugin's own or the system's: what a catch-up walks
   * with `held`. Waits for the boot to finish, as `held` does.
   */
  types(): Promise<PublicAddressType[]>;
  /**
   * The language an address is held in where a read names none: the site's
   * default language as it is now, one chosen in Settings included, or
   * `"en"` on a site with no languages.
   */
  defaultLanguage(): Promise<string>;
  /**
   * The languages an address is held in: the site's languages as they are
   * now, a list set in Settings included, its default first; or, on a site
   * with no languages, the one it serves (its default, `"en"` where none
   * is named).
   */
  languages(): Promise<string[]>;
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
  /** The database's dialect, read when a participant's statement fails. */
  dialect: () => SupportedDialect;
}

/**
 * Run `work` with this plugin's handles on the save's transaction `tx`.
 *
 * A participant writing through `db` meets the database's own failures, and
 * two saves of one address at once can deadlock on a row both make. Such a
 * failure is reported as core reports its own: a deadlock or a serialization
 * failure asks the editor to try again (`CONFLICT`) rather than surfacing as
 * an internal error. Anything else is passed on as thrown.
 */
async function withParticipantTransaction<T>(
  deps: PublicAddressesDeps,
  tx: TransactionContext,
  saveKey: object,
  work: (handles: ParticipantTransaction) => Promise<T>
): Promise<T> {
  try {
    return await deps.bindTo(tx, db =>
      withWriteTransactionToken(
        tx,
        transaction => work({ db, transaction, saveKey }),
        "ctx.publicAddresses"
      )
    );
  } catch (error) {
    if (NextlyError.is(error)) throw error;
    const failure = toDbError(deps.dialect(), error);
    if (
      failure.kind === "deadlock" ||
      failure.kind === "serialization-failure"
    ) {
      throw NextlyError.fromDatabaseError(failure);
    }
    throw error;
  }
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
      holderOf: (address, asker, batch, tx, saveKey) =>
        withParticipantTransaction(deps, tx, saveKey, handles =>
          participant.holderOf(address, asker, batch, handles)
        ),
      record: (batch, tx, saveKey) =>
        withParticipantTransaction(deps, tx, saveKey, handles =>
          participant.record(batch, handles)
        ),
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
      return scope.track(
        settleMoves(updates, tx).catch((error: unknown) => {
          // A participant may have recorded before another failed: the
          // transaction must roll back for it even if the caller catches
          // this, or the records would disagree about who holds an address.
          scope.fail(error);
          throw error;
        })
      );
    },
    held: async args => (await heldListing()).heldPage(args),
    fingerprint: async () => (await heldListing()).addressFingerprint(),
    types: async () => {
      await whenServicesRegistered();
      return (await siteTypes()).map(({ type }) => type);
    },
    defaultLanguage: async () =>
      (await heldAddresses()).defaultAddressLanguage(),
    languages: async () => {
      const held = await heldAddresses();
      const first = held.defaultAddressLanguage();
      const all = held.addressLanguages();
      return [first, ...all.filter(code => code !== first)];
    },
  };
}

/**
 * The listing of every document's held addresses, loaded when a participant
 * first reads it rather than imported at the top: this module is part of
 * every plugin's context, which most of the package imports, and the listing
 * reaches the boot entry, which loads nearly all of it.
 */
function heldListing() {
  return import("../domains/public-addresses/held-listing");
}

/** The addresses each document holds, loaded when first asked, as above. */
function heldAddresses() {
  return import("../domains/public-addresses/held-addresses");
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
  // One question, however many rounds the refusals take: no round opens a
  // savepoint, so what a participant did in an earlier one still stands.
  const saveKey = newSaveKey();
  let standing = [...updates];
  // Asked again until nothing more is refused: an update judged against a
  // batch in which another lets an address go must not stand once that
  // other is refused and keeps it.
  for (;;) {
    const refusedNow: RefusedAddressUpdate[] = [];
    for (const update of standing) {
      const clash = await firstHolder(update, standing, tx, saveKey);
      if (clash !== null) refusedNow.push({ update, ...clash });
    }
    if (refusedNow.length === 0) break;
    refused.push(...refusedNow);
    standing = standing.filter(
      update => !refusedNow.some(r => r.update === update)
    );
  }
  if (standing.length > 0) await recordEverywhere(standing, tx, saveKey);
  return { refused };
}
