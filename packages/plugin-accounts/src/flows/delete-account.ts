import { deleteAccount, writeAtVersion } from "../storage/accounts";

import { accountDeleted, reportAccountDeleted } from "./account-deleted";
import type { FlowDeps } from "./deps";
import { provenHolder } from "./holder";
import { queueNotice } from "./mail";
import { attemptSucceeded, type AttemptRefusal } from "./password-attempt";

export type DeleteAccountResult =
  | { status: "deleted" }
  | { status: "signed-out" }
  | { status: "refused"; reason: "try-again" }
  | AttemptRefusal;

/** Ends the deletion's transaction with "try again", rolling it back. */
class VersionMoved extends Error {}

/**
 * The holder deletes their account. The current password is asked for and
 * counted as a sign-in attempt is. Then, in one transaction that writes
 * only at the account's security version, so no sign-in, verification or
 * reset under way outlives it: every link and code is voided and the
 * account is deleted, its sessions, known browsers and pending change with
 * it. Afterwards other plugins are told, so they remove or anonymise what
 * they hold for it, and the address is emailed.
 */
export async function deleteOwnAccount(
  deps: FlowDeps,
  input: {
    sessionToken: string;
    currentPassword: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<DeleteAccountResult> {
  const proven = await provenHolder(deps, {
    ...input,
    password: input.currentPassword,
  });
  if (proven.status !== "proven") return proven;
  const { account, attempt } = proven;

  try {
    await deps.db.transaction(async tx => {
      if (!(await writeAtVersion(tx, account, {}, { endsSessions: true })))
        throw new VersionMoved();
      await deps.core.secrets.voidFor({ subject: account.id }, { tx });
      await deleteAccount(tx, account.id);
      await reportAccountDeleted(deps, tx, account.id);
    });
  } catch (error) {
    if (error instanceof VersionMoved)
      return { status: "refused", reason: "try-again" };
    throw error;
  }

  await attemptSucceeded(deps, attempt);
  accountDeleted(deps, account.id);
  await queueNotice(deps, {
    kind: "account-deleted",
    accountId: account.id,
    to: account.address,
  });

  return { status: "deleted" };
}
