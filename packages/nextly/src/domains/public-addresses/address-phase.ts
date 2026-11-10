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
import type { HookRegistry } from "../../hooks/hook-registry";
import type { InTransactionRunner } from "../../hooks/types";

import { heldIn, readEveryLanguage, typeOfWrite } from "./held-addresses";
import {
  addressHeldError,
  firstHolder,
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
    return (
      (await declaredFor(type, undefined, undefined, executor)) !== undefined
    );
  } catch {
    // A collection no configuration or registry names (a system table's)
    // is no page of the site.
    return false;
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
  const clash = await firstHolder(update, [update], tx);
  if (clash !== null) throw addressHeldError(update, clash);
  await recordEverywhere([update], tx);
};

/** The registry the handler is in now, if any. */
let bound: HookRegistry | undefined;
let listening = false;

/** Register the handler in `bound` while anyone takes part, else remove it. */
function sync(): void {
  if (bound === undefined) return;
  // Removed first, so a registry cleared and booted into again, or one that
  // already holds it, ends with exactly one registration.
  bound.unregisterInTransaction("*", askOnSave, "code");
  if (hasParticipants()) bound.registerInTransaction("*", askOnSave, "code");
}

/**
 * Keep core's address question registered in `registry` (the one this boot
 * registers into) for as long as any plugin takes part. Called on every boot;
 * a registry from an earlier boot loses the handler.
 */
export function startAddressPhase(registry: HookRegistry): void {
  if (bound !== undefined && bound !== registry) {
    bound.unregisterInTransaction("*", askOnSave, "code");
  }
  bound = registry;
  if (!listening) {
    listening = true;
    onParticipantsChange(sync);
  }
  sync();
}
