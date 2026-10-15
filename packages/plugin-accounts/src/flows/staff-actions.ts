import type { StaffAction, StaffRefusal } from "../admin-contract";
import {
  accountById,
  deleteAccount,
  holdWhileUnverified,
  writeAtVersion,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";
import { endAccountSessions } from "../storage/sessions";

import { accountDeleted, reportAccountDeleted } from "./account-deleted";
import type { FlowDeps } from "./deps";
import { queueNotice } from "./mail";
import { mintResetLink, queueResetLink } from "./reset-request";
import { endEverything } from "./sessions";
import {
  mintVerification,
  queueVerification,
  type MintedVerification,
} from "./verification-email";

export type StaffActionResult =
  | { status: "done"; account: AccountRow }
  | { status: "missing" }
  | { status: "refused"; reason: StaffRefusal };

/** How many times an action re-reads an account another change moved first. */
const VERSION_RETRIES = 5;

/** Runs one staff action on an account. */
export function runStaffAction(
  deps: FlowDeps,
  action: StaffAction,
  accountId: string
): Promise<StaffActionResult> {
  return ACTIONS[action](deps, accountId);
}

const ACTIONS: Record<
  StaffAction,
  (deps: FlowDeps, accountId: string) => Promise<StaffActionResult>
> = {
  deactivate: deactivateAccount,
  reactivate: reactivateAccount,
  "end-sessions": endSessionsByStaff,
  "resend-verification": resendVerificationByStaff,
  "send-reset": sendResetByStaff,
  delete: deleteAccountByStaff,
};

/**
 * Deactivates the account: in one transaction at the account's security
 * version, which moves on, it is marked deactivated, every session ends,
 * every link and code is voided and a pending address change is cancelled,
 * so nothing under way outlives it. Known browsers stay known, for a
 * reactivation. Other plugins hear of it once it commits.
 */
async function deactivateAccount(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  const result = await atVersion(
    deps,
    accountId,
    account =>
      account.deactivatedAt !== null ? "already-deactivated" : undefined,
    (tx, account) =>
      endEverything(deps, tx, account, { deactivatedAt: deps.now() })
  );
  if (result.status === "done")
    deps.events.emit("nextlyhq-plugin-accounts.account.deactivated", {
      accountId,
    });

  return result;
}

/**
 * Reactivates a deactivated account. It has no session, link or code to
 * end, since deactivating ended them all, so the version stays where it is;
 * the holder signs in again, or asks for a reset. Written only while the
 * account is still deactivated, so of two reactivations at once one
 * applies, and the other reads the account again and finds it active.
 */
async function reactivateAccount(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  const result = await atVersion(
    deps,
    accountId,
    account => (account.deactivatedAt === null ? "already-active" : undefined),
    (tx, account) =>
      writeAtVersion(
        tx,
        account,
        { deactivatedAt: null },
        { only: "deactivated" }
      )
  );
  if (result.status === "done")
    deps.events.emit("nextlyhq-plugin-accounts.account.reactivated", {
      accountId,
    });

  return result;
}

/**
 * Ends every session of the account, moving its security version so a
 * sign-in, a verification, a reset or an address confirmation under way
 * writes nothing. Unlike every other change that ends sessions it voids no
 * link or code and keeps a pending address change: what was refused for the
 * moved version can be tried again with the same link.
 */
function endSessionsByStaff(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  return atVersion(
    deps,
    accountId,
    () => undefined,
    async (tx, account) => {
      if (!(await writeAtVersion(tx, account, {}, { endsSessions: true })))
        return false;
      await endAccountSessions(tx, account.id);
      return true;
    }
  );
}

/**
 * Sends the verification email again to an unverified, active account: a
 * fresh link, a fresh code that voids the earlier one, and a fresh "this
 * wasn't me" link, minted while the account is held unverified at the
 * version read, so a verification or a deactivation that commits first is
 * seen and refused. It moves nothing else, so a reset link already sent
 * still works.
 */
async function resendVerificationByStaff(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  let minted: MintedVerification | undefined;
  const result = await atVersion(
    deps,
    accountId,
    account => {
      if (account.verifiedAt !== null) return "already-verified";
      if (account.deactivatedAt !== null) return "deactivated";
      return undefined;
    },
    async (tx, account) => {
      if (!(await holdWhileUnverified(tx, account))) return false;
      minted = await mintVerification(deps, tx, account.id);
      return true;
    }
  );
  if (result.status !== "done" || minted === undefined) return result;
  await queueVerification(deps, result.account, minted);

  return result;
}

/**
 * Sends an active account a single-use reset link, good for the site's
 * reset minutes, as the holder's own request would. A deactivated account
 * gets none.
 */
async function sendResetByStaff(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  let token: string | null = null;
  const result = await atVersion(
    deps,
    accountId,
    account => (account.deactivatedAt !== null ? "deactivated" : undefined),
    async (tx, account) => {
      token = await mintResetLink(deps, tx, account);
      return token !== null;
    }
  );
  if (result.status !== "done" || token === null) return result;
  await queueResetLink(deps, result.account, token);

  return result;
}

/**
 * Deletes the account as its holder's own deletion does, without the
 * password: in one transaction at its security version every link and code
 * is voided and the account goes, its sessions, known browsers and pending
 * change with it. Other plugins are told, and the address is emailed.
 */
async function deleteAccountByStaff(
  deps: FlowDeps,
  accountId: string
): Promise<StaffActionResult> {
  const result = await atVersion(
    deps,
    accountId,
    () => undefined,
    async (tx, account) => {
      if (!(await writeAtVersion(tx, account, {}, { endsSessions: true })))
        return false;
      await deps.core.secrets.voidFor({ subject: account.id }, { tx });
      if (!(await deleteAccount(tx, account.id))) return false;
      await reportAccountDeleted(deps, tx, account.id);
      return true;
    }
  );
  if (result.status !== "done") return result;
  accountDeleted(deps, accountId);
  await queueNotice(deps, {
    kind: "account-deleted",
    accountId,
    to: result.account.address,
  });

  return result;
}

/**
 * Reads the account, refuses what does not apply to it, and runs `write`
 * in one transaction at the version read; when `write` answers false,
 * another change moved the version first and the account is read again.
 */
async function atVersion(
  deps: FlowDeps,
  accountId: string,
  refuse: (account: AccountRow) => StaffRefusal | undefined,
  write: (tx: AccountsDb, account: AccountRow) => Promise<boolean>
): Promise<StaffActionResult> {
  for (let attempt = 0; attempt < VERSION_RETRIES; attempt += 1) {
    const account = await accountById(deps.db, accountId);
    if (account === null) return { status: "missing" };
    const reason = refuse(account);
    if (reason !== undefined) return { status: "refused", reason };
    if (await deps.db.transaction(tx => write(tx, account)))
      return { status: "done", account };
  }
  throw new Error("The account kept changing while staff acted on it.");
}
