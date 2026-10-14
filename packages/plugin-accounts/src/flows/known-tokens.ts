import {
  liveKnownBrowsers,
  type KnownBrowserRow,
} from "../storage/known-browsers";

import type { FlowDeps } from "./deps";

/**
 * The most known-browser tokens one cookie holds, the newest last: the
 * cookie keeps that many, and a request's tokens past them, the oldest
 * first, are ignored.
 */
export const TOKENS_PER_COOKIE = 10;

/** A known-browser token a request carries, with the row it names. */
export interface ValidToken {
  token: string;
  row: KnownBrowserRow;
}

/**
 * The known-browser tokens a request carries that name a browser still
 * known, each with its row; any other is ignored, as if never sent.
 */
export async function validTokens(
  deps: Pick<FlowDeps, "db" | "core" | "settings">,
  tokens: readonly string[],
  now: Date
): Promise<ValidToken[]> {
  const byHash = new Map(
    tokens
      .slice(-TOKENS_PER_COOKIE)
      .map(token => [deps.core.opaque.hash(token), token])
  );
  const rows = await liveKnownBrowsers(
    deps.db,
    [...byHash.keys()],
    now,
    deps.settings.knownBrowsers.days
  );

  return rows.map(row => ({ token: byHash.get(row.tokenHash) ?? "", row }));
}

/**
 * Whether an admitted email request may write to an account: always when it
 * carries the account's own token, as that account's own rules allow;
 * otherwise only while the address's own limit had room.
 */
export function mayEmailAccount(
  accountId: string,
  tokens: readonly ValidToken[],
  verdict: { addressHadRoom: boolean }
): boolean {
  return (
    tokens.some(token => token.row.accountId === accountId) ||
    verdict.addressHadRoom
  );
}
