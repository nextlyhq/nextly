import {
  accountByAddress,
  normaliseAddress,
  type AccountRow,
} from "../storage/accounts";

import type { FlowDeps } from "./deps";
import {
  reserveEmailRequest,
  type EMAIL_REQUESTS,
  type EmailRequestVerdict,
} from "./email-limits";
import { ADDRESS } from "./input";
import { mayEmailAccount, validTokens } from "./known-tokens";

/** An email request that named an address, refused before any of its work. */
export type EmailRequestRefusal =
  | { status: "refused"; reason: "invalid-address" }
  | Extract<EmailRequestVerdict, { status: "refused" }>;

/**
 * The start every request that may email an address's account shares: the
 * address read, the request counted against the client, the address and
 * every valid known-browser token it carries, and then the address's
 * account, if any, with whether the request may write to it. Answers the
 * refusal instead when the request is refused.
 */
export async function admitEmailRequest(
  deps: FlowDeps,
  kind: (typeof EMAIL_REQUESTS)[keyof typeof EMAIL_REQUESTS],
  input: {
    address: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<
  | { status: "admitted"; account: AccountRow | null; mayEmail: boolean }
  | EmailRequestRefusal
> {
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) return { status: "refused", reason: "invalid-address" };

  const tokens = await validTokens(deps, input.knownTokens ?? [], deps.now());
  const verdict = await reserveEmailRequest(deps, {
    kind,
    addressKey: normaliseAddress(address.data),
    client: input.client,
    tokenHashes: tokens.map(token => token.row.tokenHash),
  });
  if (verdict.status === "refused") return verdict;

  const account = await accountByAddress(deps.db, address.data);

  return {
    status: "admitted",
    account,
    mayEmail: account !== null && mayEmailAccount(account.id, tokens, verdict),
  };
}
