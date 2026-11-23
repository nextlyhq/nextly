import {
  holdAtVersion,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";

import { MINUTE, type FlowDeps } from "./deps";
import { EMAIL_REQUESTS } from "./email-limits";
import { admitEmailRequest, type EmailRequestRefusal } from "./email-request";
import { PURPOSES } from "./purposes";
import { secretFields, type MintedSecret } from "./secret-fields";

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
  if (account !== null && account.deactivatedAt === null && admitted.mayEmail) {
    const minted = await deps.db.transaction(tx =>
      mintResetLink(deps, tx, account)
    );
    if (minted !== null) await queueResetLink(deps, account, minted);
  }

  return { status: "accepted" };
}

/**
 * Mints an account a single-use reset link, good for the site's reset
 * minutes, while the account is held at the version read: a deactivation,
 * or any change that ends sessions, voids every link when it commits, so
 * one that committed since is seen and nothing is minted (null), and a
 * link minted first is voided by it. The caller has decided the account,
 * as read, may have one.
 */
export async function mintResetLink(
  deps: Pick<FlowDeps, "core" | "settings">,
  tx: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">
): Promise<MintedSecret | null> {
  if (!(await holdAtVersion(tx, account))) return null;
  const { token, ref } = await deps.core.secrets.mintToken(
    {
      purpose: PURPOSES.reset,
      subject: account.id,
      expiresInMs: deps.settings.resetLinkMinutes * MINUTE,
    },
    { tx }
  );

  return { token, ref };
}

/** Emails an account the reset link minted for it. */
export async function queueResetLink(
  deps: Pick<FlowDeps, "settings" | "mail">,
  account: Pick<AccountRow, "id" | "address">,
  minted: MintedSecret
): Promise<void> {
  await deps.mail.queue({
    kind: "reset-password",
    accountId: account.id,
    to: account.address,
    ...secretFields(deps.settings, "reset-password", { link: minted }),
  });
}
