import {
  accountById,
  writeAtVersion,
  type AccountChange,
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
import { sessionHolder } from "./holder";

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
  const holder = await sessionHolder(deps, input.sessionToken);
  if (holder === null) return null;
  const { session, account } = holder;
  await touchSession(
    deps.db,
    session,
    deps.now(),
    sessionLimits(deps.settings)
  );

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
 * browsers stay known. The session asking is checked again inside each
 * try, so a try after a password change or a reset ended it does nothing.
 * False when the session had already ended.
 */
export async function signOutEverywhere(
  deps: FlowDeps,
  input: { sessionToken: string }
): Promise<boolean> {
  const tokenHash = deps.core.opaque.hash(input.sessionToken);
  const session = await liveSession(deps.db, tokenHash, deps.now());
  if (session === null) return false;

  for (let attempt = 0; attempt < VERSION_RETRIES; attempt += 1) {
    const account = await accountById(deps.db, session.accountId);
    if (account === null) return false;
    const outcome = await deps.db.transaction(async tx => {
      if ((await liveSession(tx, tokenHash, deps.now())) === null)
        return "ended";
      return (await endEverything(deps, tx, account)) ? "done" : "moved";
    });
    if (outcome !== "moved") return outcome === "done";
  }
  throw new Error(
    "The account kept changing while it was signed out everywhere."
  );
}

/**
 * Ends an account's sessions, voids its secrets and cancels its pending
 * address change, at the version read, writing `change` with them; false
 * when another change moved the version. Signing out everywhere and a
 * deactivation both end this much.
 */
export async function endEverything(
  deps: Pick<FlowDeps, "core">,
  tx: AccountsDb,
  account: AccountRow,
  change: AccountChange = {}
): Promise<boolean> {
  if (!(await writeAtVersion(tx, account, change, { endsSessions: true })))
    return false;
  await endAccountSessions(tx, account.id);
  await deps.core.secrets.voidFor({ subject: account.id }, { tx });
  await cancelPendingAddressChange(tx, account.id);

  return true;
}
