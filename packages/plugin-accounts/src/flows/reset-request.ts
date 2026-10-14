import type { AccountRow } from "../storage/accounts";

import { MINUTE, type FlowDeps } from "./deps";
import { EMAIL_REQUESTS } from "./email-limits";
import { admitEmailRequest, type EmailRequestRefusal } from "./email-request";
import { pageLink } from "./links";
import { PURPOSES } from "./purposes";

export type ResetRequestResult = { status: "accepted" } | EmailRequestRefusal;

/**
 * Asks for a password reset. The answer is the same whether the address
 * has an active account, a deactivated one or none, and is counted before
 * any of its work. Only an active account is emailed a single-use reset
 * link, good for the site's reset minutes; a request carrying known-browser
 * tokens emails another account's address only as that address's own
 * limit allows.
 */
export async function requestPasswordReset(
  deps: FlowDeps,
  input: {
    address: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<ResetRequestResult> {
  const admitted = await admitEmailRequest(deps, EMAIL_REQUESTS.reset, input);
  if (admitted.status === "refused") return admitted;
  const { account } = admitted;
  if (account !== null && account.deactivatedAt === null && admitted.mayEmail)
    await sendResetLink(deps, account);

  return { status: "accepted" };
}

/**
 * Emails an account a single-use reset link, good for the site's reset
 * minutes. The caller has decided the account may have one.
 */
export async function sendResetLink(
  deps: Pick<FlowDeps, "core" | "settings" | "mail">,
  account: Pick<AccountRow, "id" | "address">
): Promise<void> {
  const { token } = await deps.core.secrets.mintToken({
    purpose: PURPOSES.reset,
    subject: account.id,
    expiresInMs: deps.settings.resetLinkMinutes * MINUTE,
  });
  await deps.mail.queue({
    kind: "reset-password",
    accountId: account.id,
    to: account.address,
    link: pageLink(deps.settings, "reset", token),
  });
}
