import type { FlowDeps } from "./deps";
import { EMAIL_REQUESTS } from "./email-limits";
import { admitEmailRequest, type EmailRequestRefusal } from "./email-request";
import { mintWhileUnverified, queueVerification } from "./verification-email";

export type ResendResult = { status: "accepted" } | EmailRequestRefusal;

/**
 * Sends the verification email again: a fresh link, a fresh code that
 * voids the earlier one, and a fresh "this wasn't me" link, to an address
 * whose account is still unverified, minted while it is held unverified,
 * so a verification that commits first is seen and nothing is sent. The
 * answer is the same whether the
 * address has no account, an unverified one or a verified one, and every
 * request is counted against the address's resends and the client's email
 * requests before any of its work, whatever account the address has.
 */
export async function resendVerification(
  deps: FlowDeps,
  input: {
    address: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<ResendResult> {
  const admitted = await admitEmailRequest(deps, EMAIL_REQUESTS.resend, input);
  if (admitted.status === "refused") return admitted;
  const { account } = admitted;
  if (account !== null && account.verifiedAt === null && admitted.mayEmail) {
    const verification = await mintWhileUnverified(deps, account);
    if (verification !== null)
      await queueVerification(deps, account, verification);
  }

  return { status: "accepted" };
}
