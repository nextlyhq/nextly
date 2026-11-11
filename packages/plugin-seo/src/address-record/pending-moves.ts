/**
 * The redirects a deploy's move still owes: each address a page let go of in
 * the catch-up, kept in the address record on the very transaction that let
 * it go, until the redirect from it has been made once every claim stands.
 * A start that stops between the two finds them at the next start, so no old
 * address is forgotten before its redirect exists.
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

import { recordSlug } from "./rows";

type Transaction = ParticipantTransaction["transaction"];

/** A redirect a page's move still owes. */
export interface PendingMove {
  key: string;
  holder: AddressHolder;
  address: HeldAddress;
}

const PAGE = 200;

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

/** Keep `released`, let go of by `holder`, on the transaction that let it go. */
export async function keepPending(
  ctx: PluginContext,
  transaction: Transaction,
  holder: AddressHolder,
  released: readonly HeldAddress[]
): Promise<void> {
  const slug = recordSlug(ctx);
  for (const address of released) {
    const key = pendingKey(holder, address);
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      transaction,
      slug,
      {
        where: { claimKey: { equals: key } },
        pagination: { limit: 1, page: 1 },
        depth: 0,
      },
      { lock: "update" }
    );
    if ((data as unknown[]).length > 0) continue;
    await ctx.services.collections.createEntryInTransaction(transaction, slug, {
      claimKey: key,
      kind: "pending",
      locale: address.locale,
      path: JSON.stringify(address),
      holderCollection: holder.collection,
      holderId: holder.id,
    });
  }
}

/** A stored row read back as the move it keeps, or nothing where it is not one. */
function pendingOf(entry: unknown): PendingMove | undefined {
  const row = entry as Record<string, unknown>;
  if (
    typeof row.holderCollection !== "string" ||
    typeof row.holderId !== "string"
  ) {
    return undefined;
  }
  try {
    const address = JSON.parse(String(row.path)) as HeldAddress;
    if (
      typeof address.locale !== "string" ||
      typeof address.path !== "string"
    ) {
      return undefined;
    }
    return {
      key: String(row.claimKey),
      holder: { collection: row.holderCollection, id: row.holderId },
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
  const found: PendingMove[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      recordSlug(ctx),
      {
        where: { kind: { equals: "pending" } },
        pagination: { limit: PAGE, page },
        sort: { field: "claimKey", direction: "asc" },
        depth: 0,
      }
    );
    for (const entry of data as unknown[]) {
      const move = pendingOf(entry);
      if (move !== undefined) found.push(move);
    }
    if ((data as unknown[]).length < PAGE) return found;
  }
}

/** Forget the moves `keys` keep, once their redirects are made. */
export async function forgetPending(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) return;
  const slug = recordSlug(ctx);
  const { data } = await ctx.services.ownCollections.listEntries(slug, {
    where: { claimKey: { in: [...keys] } },
    pagination: { limit: keys.length, page: 1 },
    depth: 0,
  });
  for (const row of data as Record<string, unknown>[]) {
    await ctx.services.collections.deleteEntry(slug, String(row.id));
  }
}
