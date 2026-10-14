import {
  accountById,
  writeAtVersion,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";
import { cancelPendingAddressChange } from "../storage/pending-changes";
import {
  endAccountSessions,
  endSession,
  liveSession,
  touchSession,
} from "../storage/sessions";

import { sessionLimits, type FlowDeps } from "./deps";

/** The signed-in account a request's session names, as server code and access rules see it. */
export interface SignedInAccount {
  id: string;
  name: string;
  address: string;
  verified: boolean;
}

/** How many times sign-out everywhere re-reads an account another change moved first. */
const VERSION_RETRIES = 5;

/**
 * The account a request's session token names, or null when the session
 * has ended or its account is deactivated. Read on every request, so a
 * session ended anywhere is refused at once; its use moves its idle expiry
 * on.
 */
export async function sessionAccount(
  deps: Pick<FlowDeps, "db" | "core" | "settings" | "now">,
  input: { sessionToken: string }
): Promise<SignedInAccount | null> {
  const now = deps.now();
  const session = await liveSession(
    deps.db,
    deps.core.opaque.hash(input.sessionToken),
    now
  );
  if (session === null) return null;
  const account = await accountById(deps.db, session.accountId);
  if (account === null || account.deactivatedAt !== null) return null;
  await touchSession(deps.db, session, now, sessionLimits(deps.settings));

  return {
    id: account.id,
    name: account.name,
    address: account.address,
    verified: account.verifiedAt !== null,
  };
}

/** Signs this session out, ending it alone. */
export async function signOut(
  deps: Pick<FlowDeps, "db" | "core">,
  input: { sessionToken: string }
): Promise<void> {
  await endSession(deps.db, deps.core.opaque.hash(input.sessionToken));
}

/**
 * Signs the account out everywhere: every session ends, every link and code
 * issued for it is voided, and a pending address change is cancelled, in
 * one transaction that moves the account's security version, so a sign-in,
 * a verification or a reset already under way writes nothing. Known
 * browsers stay known. False when the session had already ended.
 */
export async function signOutEverywhere(
  deps: FlowDeps,
  input: { sessionToken: string }
): Promise<boolean> {
  const session = await liveSession(
    deps.db,
    deps.core.opaque.hash(input.sessionToken),
    deps.now()
  );
  if (session === null) return false;

  for (let attempt = 0; attempt < VERSION_RETRIES; attempt += 1) {
    const account = await accountById(deps.db, session.accountId);
    if (account === null) return false;
    if (await deps.db.transaction(tx => endEverything(deps, tx, account)))
      return true;
  }
  throw new Error(
    "The account kept changing while it was signed out everywhere."
  );
}

/**
 * Ends an account's sessions, voids its secrets and cancels its pending
 * address change, at the version read; false when another change moved it.
 */
async function endEverything(
  deps: FlowDeps,
  tx: AccountsDb,
  account: AccountRow
): Promise<boolean> {
  if (!(await writeAtVersion(tx, account, {}, { endsSessions: true })))
    return false;
  await endAccountSessions(tx, account.id);
  await deps.core.secrets.voidFor({ subject: account.id }, { tx });
  await cancelPendingAddressChange(tx, account.id);

  return true;
}
