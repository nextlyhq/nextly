/**
 * Version pins for plugins, on the plugin's own transaction.
 *
 * Core's pins take a core `TransactionContext`. A plugin holds no such thing:
 * `ctx.db.transaction` hands it a handle to its own tables, and
 * `ctx.services.collections.withTransaction` an opaque token. Each holder here
 * takes either, resolves it to the transaction behind it, and runs core's pin
 * on that, so a plugin pins in the same transaction as the change it records:
 * the pin commits or rolls back with the plugin's own writes, under the same
 * document lock and refusals as core's pins.
 *
 * A plugin's holders are named in its own namespace (`<plugin slug>.<name>`),
 * so two plugins naming a holder alike hold apart, and none can reach a holder
 * of core's. The plugin knows its holders by their short names.
 *
 * @module plugins/plugin-version-pins
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  registerNamespacedVersionPinHolder,
  versionPins,
  type VersionPinHolderDefinition,
} from "../domains/versions/version-pins";
import type { VersionRef } from "../domains/versions/versions-repository";
import { NextlyError } from "../errors";

import type { PluginTransaction } from "./database/plugin-database";
import { linkedTransaction } from "./database/plugin-transaction-link";
import { pluginAdminSlug } from "./plugin-slug";
import {
  transactionOf,
  type PluginCollectionTransaction,
} from "./service-opts";

/**
 * @experimental The transaction a pin runs on: the handle `ctx.db.transaction`
 * passes its callback, or the token `ctx.services.collections.withTransaction`
 * hands its work.
 */
export type PluginPinTransaction =
  | PluginTransaction
  | PluginCollectionTransaction;

/** @experimental Where a pin runs: always a transaction of the plugin's. */
export interface PluginPinOptions {
  tx: PluginPinTransaction;
}

/** @experimental One of a holder's slots, and the version it points at. */
export interface PluginVersionPin {
  slot: string;
  versionNo: number;
}

/**
 * @experimental A holder a plugin registered, pinning on the plugin's own
 * transaction.
 */
export interface PluginVersionPinHolder {
  /** The name the plugin registered it under. */
  readonly name: string;
  /**
   * Point a slot at a version of the document, creating the slot or moving
   * it, as core's pins do: it waits for a save holding the document, and
   * refuses a document that is gone or a version it does not have.
   */
  pin(
    ref: VersionRef,
    args: { slot: string; versionNo: number },
    opts: PluginPinOptions
  ): Promise<void>;
  /** Free one slot. Freeing a slot that does not exist is not an error. */
  release(
    ref: VersionRef,
    args: { slot: string },
    opts: PluginPinOptions
  ): Promise<void>;
  /** Free every slot this holder has on the document. */
  releaseAll(ref: VersionRef, opts: PluginPinOptions): Promise<void>;
  /** This holder's slots on the document. */
  list(ref: VersionRef, opts: PluginPinOptions): Promise<PluginVersionPin[]>;
}

/** @experimental `ctx.services.versions.pins`. */
export interface PluginVersionPins {
  /**
   * Register a holder in this plugin's namespace and get it. Refuses a name
   * that is not kebab-case or is too long with the plugin's. The same name
   * and label again returns the same holder, as a reload registers again.
   */
  registerHolder(
    definition: VersionPinHolderDefinition
  ): PluginVersionPinHolder;
}

/**
 * Run `work` on the core transaction behind a plugin's handle or token: under
 * its scope, so it counts as in flight, a failure rolls the plugin's
 * transaction back, and a transaction that has finished refuses it.
 */
async function onPluginTransaction<R>(
  tx: unknown,
  operation: string,
  work: (core: TransactionContext) => Promise<R>
): Promise<R> {
  const link = resolvesTo(() => linkedTransaction(tx, operation));
  if (link) return link.run(work);
  const record = resolvesTo(() => transactionOf(tx));
  if (!record) {
    throw NextlyError.validation({
      errors: [
        {
          path: "tx",
          code: "INVALID_TRANSACTION",
          message:
            "`tx` must be the handle `ctx.db.transaction` passes its callback, or the transaction `ctx.services.collections.withTransaction` hands its work.",
        },
      ],
      logContext: { operation },
    });
  }
  record.scope.assertOpen();
  return record.scope.track(work(record.tx));
}

/** What `lookup` resolves to, or nothing where it refuses the value. */
function resolvesTo<T>(lookup: () => T): T | undefined {
  try {
    return lookup();
  } catch {
    return undefined;
  }
}

/**
 * The pins a plugin's context offers. Its holders are named in the plugin's
 * namespace; a context that belongs to no plugin registers none.
 */
export function pluginVersionPins(
  pluginName: string | undefined
): PluginVersionPins {
  return Object.freeze({
    registerHolder(
      definition: VersionPinHolderDefinition
    ): PluginVersionPinHolder {
      if (!pluginName) {
        throw NextlyError.invalidInput({
          message:
            "Only a plugin's own context registers version pin holders; core features use registerVersionPinHolder.",
          logContext: { name: definition.name },
        });
      }
      const { handle, recorded } = registerNamespacedVersionPinHolder(
        pluginAdminSlug(pluginName),
        definition
      );
      return Object.freeze({
        name: definition.name,
        pin: (ref, args, opts) =>
          onPluginTransaction(opts?.tx, "versions.pins.pin", tx =>
            handle.pin(tx, { ref, ...args })
          ),
        release: (ref, args, opts) =>
          onPluginTransaction(opts?.tx, "versions.pins.release", tx =>
            handle.release(tx, { ref, ...args })
          ),
        releaseAll: (ref, opts) =>
          onPluginTransaction(opts?.tx, "versions.pins.releaseAll", tx =>
            handle.releaseAll(tx, ref)
          ),
        list: (ref, opts) =>
          onPluginTransaction(opts?.tx, "versions.pins.list", async tx =>
            (await versionPins.list(tx, ref))
              .filter(pin => pin.holder === recorded)
              .map(({ slot, versionNo }) => ({ slot, versionNo }))
          ),
      } satisfies PluginVersionPinHolder);
    },
  });
}
