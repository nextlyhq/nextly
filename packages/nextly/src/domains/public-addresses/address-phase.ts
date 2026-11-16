/**
 * Core's part in keeping each public address to one page: inside every save,
 * work out what the saved document holds now and ask every participant
 * whether another page holds any of it.
 *
 * Registered as an in-transaction handler on every collection and Single
 * (`*`) only while some plugin takes part, so a site with none runs no handler
 * and does no address work. The question runs on the save's own transaction:
 * a refusal rolls the save back, and what participants record commits with it.
 *
 * @module domains/public-addresses/address-phase
 */
import { NextlyError } from "../../errors/nextly-error";
import type { HookRegistry } from "../../hooks/hook-registry";
import type { InTransactionRunner } from "../../hooks/types";

import {
  addressLanguages,
  heldIn,
  readEveryLanguage,
  typeOfWrite,
} from "./held-addresses";
import {
  addressHeldError,
  firstHolder,
  newSaveKey,
  hasParticipants,
  onParticipantsChange,
  recordEverywhere,
  type HeldAddressUpdate,
} from "./participants";
import { declaredFor } from "./public-address";

/**
 * Whether `type` can hold an address at all, read on the transaction: a type
 * that declares none (and no plugin supplies one for) never asks, so a write
 * to a plugin's own or a system collection costs one lookup and nothing more.
 */
async function hasAddress(
  write: Parameters<InTransactionRunner>[1],
  executor: unknown
): Promise<boolean> {
  const type = typeOfWrite(write.collection);
  try {
    // Asked in each language: a plugin may supply a Schema Builder type's
    // address for some languages only, and one is enough to hold.
    for (const language of addressLanguages()) {
      if (
        (await declaredFor(type, language, undefined, executor)) !== undefined
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    // A collection no configuration or registry names (a system table's)
    // is no page of the site. Any other failure fails the save: a type whose
    // address could not be read is never let through unchecked.
    if (NextlyError.isNotFound(error)) return false;
    throw error;
  }
}

/** The handler, one instance, so it is registered and removed by identity. */
const askOnSave: InTransactionRunner = async (tx, write) => {
  // A working draft of a published document changes nothing it holds: its
  // address moves when the draft is published, which is a write of its own.
  if (write.data?._isWorkingDraft === true) return;
  const executor = tx.getDrizzle();
  if (!(await hasAddress(write, executor))) return;

  const type = typeOfWrite(write.collection);
  const title = write.data?.title;
  const update: HeldAddressUpdate = {
    holder: {
      collection: write.collection,
      id: write.id,
      ...(typeof title === "string" && title !== "" ? { label: title } : {}),
    },
    holds: await heldIn(type, await readEveryLanguage(tx, write), tx),
  };
  // One question: every participant's `holderOf` calls and the `record`
  // after them share it, and the next save gets another.
  const saveKey = newSaveKey();
  const clash = await firstHolder(update, [update], tx, saveKey);
  if (clash !== null) throw addressHeldError(update, clash);
  await recordEverywhere([update], tx, saveKey);
};

/**
 * Where the handler is registered, and the one handler instance, kept on
 * `globalThis` like the participant list: a module evaluated again must remove
 * the very function an earlier copy registered, and must not listen twice.
 */
const phase = globalThis as unknown as {
  __nextly_addressPhase?: {
    handler: InTransactionRunner;
    bound?: HookRegistry;
    listening: boolean;
  };
};
phase.__nextly_addressPhase ??= { handler: askOnSave, listening: false };
const state = phase.__nextly_addressPhase;

/** Register the handler in `bound` while anyone takes part, else remove it. */
function sync(): void {
  const { bound, handler } = state;
  if (bound === undefined) return;
  // Removed first, so a registry cleared and booted into again, or one that
  // already holds it, ends with exactly one registration.
  bound.unregisterInTransaction("*", handler, "code");
  if (hasParticipants()) bound.registerInTransaction("*", handler, "code");
}

/**
 * Keep core's address question registered in `registry` (the one this boot
 * registers into) for as long as any plugin takes part. Called on every boot;
 * a registry from an earlier boot loses the handler.
 */
export function startAddressPhase(registry: HookRegistry): void {
  if (state.bound !== undefined && state.bound !== registry) {
    state.bound.unregisterInTransaction("*", state.handler, "code");
  }
  state.bound = registry;
  if (!state.listening) {
    state.listening = true;
    onParticipantsChange(sync);
  }
  sync();
}
