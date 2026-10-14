import { LIMIT_RULES } from "../core/limit-rules";
import { writeAtVersion, type AccountRow } from "../storage/accounts";
import { forgetBrowsers, rememberBrowser } from "../storage/known-browsers";
import { cancelPendingAddressChange } from "../storage/pending-changes";
import { endAccountSessions } from "../storage/sessions";

import type { FlowDeps } from "./deps";
import { validTokens } from "./known-tokens";
import { linkedAccount } from "./linked-account";
import { queueNotice } from "./mail";
import {
  accountPasswordRefusal,
  passwordReplaced,
  type AccountPasswordRefusal,
} from "./new-password";
import { PURPOSES } from "./purposes";

export type ResetResult =
  /** The password is set; nobody is signed in. The token marks the browser that reset it known. */
  | { status: "reset"; knownBrowserToken: string }
  | {
      status: "refused";
      reason: "invalid" | "expired" | "spent" | "deactivated" | "try-again";
    }
  | AccountPasswordRefusal;

/** Ends the reset's transaction with this answer, rolling it back. */
class Refusal extends Error {
  constructor(readonly reason: "invalid" | "expired" | "spent" | "try-again") {
    super(reason);
  }
}

/**
 * Completes a reset from its link. On an account still active, it spends
 * the link and sets the new password, in one transaction that writes only
 * at the account's security version: every session ends, every other link
 * and code is voided, a pending address change is cancelled, the
 * reset-required state and the failures in a row start again, the address
 * is marked verified if it was not, and every browser known to the account
 * is forgotten but the one completing the reset, which is marked known.
 * Then the address's sign-in waits end, and the account is told its
 * password changed. Nobody is signed in: the holder signs in with the new
 * password. Of two uses of one link, even at once, one succeeds.
 */
export async function completePasswordReset(
  deps: FlowDeps,
  input: { token: string; password: string; knownTokens?: readonly string[] }
): Promise<ResetResult> {
  const { core } = deps;
  const linked = await linkedAccount(deps, PURPOSES.reset, input.token);
  if (linked.status === "refused") return linked;
  const { account } = linked;
  if (account.deactivatedAt !== null)
    return { status: "refused", reason: "deactivated" };

  const refusal = await accountPasswordRefusal(
    deps,
    account.id,
    input.password
  );
  if (refusal !== null) return refusal;
  const passwordHash = await core.passwords.hash(input.password);

  const now = deps.now();
  const known = (await validTokens(deps, input.knownTokens ?? [], now)).find(
    token => token.row.accountId === account.id
  );
  const browser =
    known === undefined
      ? core.opaque.create()
      : { secret: known.token, hash: known.row.tokenHash };

  try {
    await deps.db.transaction(async tx => {
      const spent = await core.secrets.consumeToken(
        { purpose: PURPOSES.reset, token: input.token },
        { tx }
      );
      if (!spent.ok) throw new Refusal(spent.reason);
      const written = await writeAtVersion(
        tx,
        account,
        {
          ...passwordReplaced(passwordHash, now),
          ...verifiedByReset(account, now),
        },
        { endsSessions: true }
      );
      if (!written) throw new Refusal("try-again");
      await endAccountSessions(tx, account.id);
      await core.secrets.voidFor({ subject: account.id }, { tx });
      await cancelPendingAddressChange(tx, account.id);
      await forgetBrowsers(tx, account.id, { except: browser.hash });
      await rememberBrowser(
        tx,
        { accountId: account.id, tokenHash: browser.hash, now },
        deps.settings.knownBrowsers.perAccount
      );
    });
  } catch (error) {
    if (error instanceof Refusal)
      return { status: "refused", reason: error.reason };
    throw error;
  }

  await core.limits.reset({
    rule: LIMIT_RULES.signInAddress,
    key: account.addressNormalised,
  });
  await queueNotice(deps, {
    kind: "password-changed",
    accountId: account.id,
    to: account.address,
  });

  return { status: "reset", knownBrowserToken: browser.secret };
}

/** A reset proves the address, for an account whose address was never verified. */
function verifiedByReset(
  account: AccountRow,
  now: Date
): Partial<Pick<AccountRow, "verifiedAt" | "verifiedBy">> {
  return account.verifiedAt === null
    ? { verifiedAt: now, verifiedBy: "reset" }
    : {};
}
