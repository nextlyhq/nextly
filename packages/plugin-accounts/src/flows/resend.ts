import { LIMIT_RULES } from "../core/limit-rules";
import { accountByAddress, normaliseAddress } from "../storage/accounts";

import type { FlowDeps } from "./deps";
import { reserveEmailRequest, type EmailRequestVerdict } from "./email-limits";
import { ADDRESS } from "./input";
import { mintVerification, queueVerification } from "./verification-email";

export type ResendResult =
  | { status: "accepted" }
  | { status: "refused"; reason: "invalid-address" }
  | Extract<EmailRequestVerdict, { status: "refused" }>;

/**
 * Sends the verification email again: a fresh link, a fresh code that
 * voids the earlier one, and a fresh "this wasn't me" link, to an address
 * whose account is still unverified. The answer is the same whether the
 * address has no account, an unverified one or a verified one, and every
 * request is counted against the address's resends and the client's email
 * requests before any of its work, whatever account the address has.
 */
export async function resendVerification(
  deps: FlowDeps,
  input: { address: string; client: string | null }
): Promise<ResendResult> {
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) return { status: "refused", reason: "invalid-address" };

  const verdict = await reserveEmailRequest(deps, {
    rule: LIMIT_RULES.resendAddress,
    addressKey: normaliseAddress(address.data),
    client: input.client,
  });
  if (verdict.status === "refused") return verdict;

  const account = await accountByAddress(deps.db, address.data);
  if (account !== null && account.verifiedAt === null) {
    const verification = await deps.db.transaction(tx =>
      mintVerification(deps, tx, account.id)
    );
    await queueVerification(deps, account, verification);
  }

  return { status: "accepted" };
}
