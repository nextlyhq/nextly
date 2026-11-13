/**
 * The redirects a deploy's move still owes: each address a page let go of in
 * the catch-up, noted beside the address record on the very transaction that
 * let it go, until the redirect from it has been made once every claim
 * stands. A start that stops between the two finds them at the next start,
 * so no old address is forgotten before its redirect exists.
 *
 * @module address-record/pending-moves
 */
import { createHash } from "node:crypto";

import type {
  AddressHolder,
  HeldAddress,
  ParticipantTransaction,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import {
  forgetNotes,
  notePending,
  onFlowTransaction,
  pendingNotes,
} from "./store";

type Transaction = ParticipantTransaction["transaction"];

/** A redirect a page's move still owes. */
export interface PendingMove {
  key: string;
  holder: AddressHolder;
  address: HeldAddress;
}

/** The claim key of the row keeping `address`, let go of by `holder`. */
function pendingKey(holder: AddressHolder, address: HeldAddress): string {
  const range = address.range === true ? "range" : "address";
  return createHash("sha256")
    .update(
      `pending:${holder.collection}:${holder.id}|${range}:${address.locale}|${address.path}`,
      "utf8"
    )
    .digest("hex");
}

/**
 * Keep `released`, let go of by `holder`, on the transaction that let it go:
 * the one the calling flow is in, which `_transaction` stands for.
 */
export async function keepPending(
  ctx: PluginContext,
  _transaction: Transaction,
  holder: AddressHolder,
  released: readonly HeldAddress[]
): Promise<void> {
  if (released.length === 0) return;
  await onFlowTransaction(ctx, db =>
    notePending(
      ctx,
      db,
      released.map(address => ({
        key: pendingKey(holder, address),
        value: JSON.stringify({
          holder: { collection: holder.collection, id: holder.id },
          address,
        }),
      }))
    )
  );
}

/** A stored note read back as the move it keeps, or nothing where it is not one. */
function pendingOf(key: string, value: string | null): PendingMove | undefined {
  try {
    const parsed = JSON.parse(value ?? "") as {
      holder?: { collection?: unknown; id?: unknown };
      address?: Partial<HeldAddress> | null;
    };
    const { holder, address } = parsed;
    if (
      typeof holder?.collection !== "string" ||
      typeof holder.id !== "string" ||
      typeof address?.locale !== "string" ||
      typeof address.path !== "string"
    ) {
      return undefined;
    }
    return {
      key,
      holder: { collection: holder.collection, id: holder.id },
      address: {
        locale: address.locale,
        path: address.path,
        ...(address.range === true ? { range: true } : {}),
      },
    };
  } catch {
    return undefined;
  }
}

/** Every move still owed a redirect. */
export async function pendingMoves(ctx: PluginContext): Promise<PendingMove[]> {
  return (await pendingNotes(ctx)).flatMap(
    note => pendingOf(note.key, note.value) ?? []
  );
}

/** Forget the moves `keys` keep, once their redirects are made. */
export async function forgetPending(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<void> {
  await forgetNotes(ctx, keys);
}
