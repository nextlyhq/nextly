/**
 * Which redirect a request for an address meets: one question, asked by the
 * Proxy for every request and by the redirect rules before a redirect is
 * saved, so a loop is refused by the very matching the Proxy would follow.
 *
 * It reads the address record by the claim keys of the address itself and
 * of every range above it, one indexed read: an address a page holds,
 * exactly or in one of its ranges, is served; otherwise an exact redirect
 * answers before a pattern, and the pattern with the longest fixed part
 * before a shorter one.
 *
 * @module redirects/meeting
 */
import type {
  KeptAddress,
  ParticipantTransaction,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { keysHolding } from "../address-record/rows";
import { onFlowTransaction, rowsAt } from "../address-record/store";

import { pickRedirect, type HeldRow } from "./addresses";
import { redirectsSlug } from "./collection";

type Transaction = ParticipantTransaction["transaction"];

/**
 * The id of the redirect a request for `address` meets, or null where a page
 * serves it or nothing answers. Read on `transaction` where one is given, and
 * leaving out the redirect `skip` (one being edited).
 */
export async function redirectMeeting(
  ctx: PluginContext,
  address: KeptAddress,
  transaction?: Transaction,
  skip?: string
): Promise<string | null> {
  const { locale, path } = address;
  const keys = keysHolding(locale, path);
  // On the transaction the flow is in, which `transaction` stands for, where
  // one is given: what the save has written so far is read too.
  const stored =
    transaction === undefined
      ? await rowsAt(ctx, keys)
      : await onFlowTransaction(ctx, db => rowsAt(ctx, keys, db));
  const redirects = redirectsSlug(ctx);
  const rows: HeldRow[] = stored.flatMap(row => {
    if (row.address === null || row.holder === null) return [];
    if (row.holder.collection === redirects && row.holder.id === skip) {
      return [];
    }
    return [
      {
        path: row.address.path,
        range: row.address.range === true,
        redirect: row.holder.collection === redirects ? row.holder.id : null,
      },
    ];
  });
  return pickRedirect(path, rows);
}
