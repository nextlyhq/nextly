import { writeAtVersion } from "../storage/accounts";
import { forgetBrowsers } from "../storage/known-browsers";
import { cancelPendingAddressChange } from "../storage/pending-changes";
import { endAccountSessions } from "../storage/sessions";

import type { FlowDeps } from "./deps";
import { provenHolder } from "./holder";
import { queueNotice } from "./mail";
import {
  accountPasswordRefusal,
  passwordReplaced,
  type AccountPasswordRefusal,
} from "./new-password";
import { attemptSucceeded, type AttemptRefusal } from "./password-attempt";

export type ChangePasswordResult =
  | { status: "changed" }
  /** The session has ended: the holder signs in again. */
  | { status: "signed-out" }
  | AttemptRefusal
  | AccountPasswordRefusal;

/** Ends the change's transaction with "try again", rolling it back. */
class VersionMoved extends Error {}

/**
 * The holder changes their password. The current one is asked for and
 * counted as a sign-in attempt is, a wrong one as a failed sign-in and a
 * right one as a successful sign-in, whatever becomes of the new one. The
 * new one meets the site's rules, its breached-password lookup counted
 * against the account. Then, in one transaction that writes only at
 * the account's security version: the password is set, every session but
 * this one ends, every link and code is voided, a pending address change is
 * cancelled, and every browser known to the account is forgotten but this
 * one. The account is emailed afterwards.
 */
export async function changePassword(
  deps: FlowDeps,
  input: {
    sessionToken: string;
    currentPassword: string;
    newPassword: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<ChangePasswordResult> {
  const proven = await provenHolder(deps, {
    ...input,
    password: input.currentPassword,
  });
  if (proven.status !== "proven") return proven;
  const { account, session, attempt, now } = proven;
  // The current password is proven, so the attempt is settled as a
  // successful sign-in is, whatever becomes of the new one: a mistyped new
  // password must not count toward the address's or the browser's waits.
  await attemptSucceeded(deps, attempt);

  const refusal = await accountPasswordRefusal(
    deps,
    account.id,
    input.newPassword
  );
  if (refusal !== null) return refusal;
  const passwordHash = await deps.core.passwords.hash(input.newPassword);

  try {
    await deps.db.transaction(async tx => {
      const written = await writeAtVersion(
        tx,
        account,
        passwordReplaced(passwordHash, now),
        { endsSessions: true }
      );
      if (!written) throw new VersionMoved();
      await endAccountSessions(tx, account.id, { except: session.tokenHash });
      await deps.core.secrets.voidFor({ subject: account.id }, { tx });
      await cancelPendingAddressChange(tx, account.id);
      await forgetBrowsers(tx, account.id, {
        except: attempt.own?.row.tokenHash,
      });
    });
  } catch (error) {
    if (error instanceof VersionMoved)
      return { status: "refused", reason: "try-again" };
    throw error;
  }

  await queueNotice(deps, {
    kind: "password-changed",
    accountId: account.id,
    to: account.address,
  });

  return { status: "changed" };
}
