import { writeAtVersion, type AccountRow } from "../storage/accounts";
import { rememberBrowser } from "../storage/known-browsers";
import { startSession } from "../storage/sessions";

import { sessionLimits, type FlowDeps } from "./deps";
import {
  attemptForAddress,
  attemptSucceeded,
  WRONG,
  type AttemptRefusal,
  type CarriedToken,
} from "./password-attempt";
import type { StartedSession } from "./verify";

export interface SignInInput {
  address: string;
  password: string;
  /** The client's key (core's `clientKey`), or null when its network address cannot be read. */
  client: string | null;
  /** The known-browser tokens the browser's cookie holds. */
  knownTokens?: readonly string[];
}

export type SignInResult =
  /** Signed in: the session's token, and the token that marks this browser known to the account. */
  | { status: "signed-in"; session: StartedSession; knownBrowserToken: string }
  | AttemptRefusal
  /** Said only once the password is proven. */
  | { status: "refused"; reason: "deactivated" | "unverified" };

/** Ends the sign-in's transaction with "try again", rolling it back. */
class VersionMoved extends Error {}

/**
 * Signs an account in: the password attempt is counted and checked as
 * `attemptPassword` says, so no answer shows whose a known browser is. A
 * deactivated or, where required, unverified account is told so only once
 * its password is proven, and past its failures in a row only a known
 * browser signs in. A sign-in ends the address's waits and is given back
 * to the client.
 */
export async function signIn(
  deps: FlowDeps,
  input: SignInInput
): Promise<SignInResult> {
  const proven = await attemptForAddress(deps, input);
  if (proven.status !== "proven") return proven;
  const { account, attempt } = proven;
  const refusal = accountRefusal(deps, account, attempt.known);
  if (refusal !== null) return refusal;

  const result = await completeSignIn(deps, {
    account,
    password: input.password,
    own: attempt.own,
    now: deps.now(),
  });
  if (result.status === "signed-in") await attemptSucceeded(deps, attempt);

  return result;
}

/**
 * Why an account whose password is proven still does not sign in: past the
 * configured failures in a row from a browser it does not know (answered
 * as a wrong password), deactivated, or, where required, unverified.
 */
function accountRefusal(
  deps: FlowDeps,
  account: AccountRow,
  known: boolean
): SignInResult | null {
  if (account.resetRequiredAt !== null && !known) return WRONG;
  if (account.deactivatedAt !== null)
    return { status: "refused", reason: "deactivated" };
  if (deps.settings.verificationRequired && account.verifiedAt === null) {
    return { status: "refused", reason: "unverified" };
  }

  return null;
}

/**
 * Starts the session, in one transaction that writes only at the account's
 * security version: the sign-in recorded, its failures in a row started
 * again, a hash at an older setting replaced, and the browser marked known
 * with its count started again.
 */
async function completeSignIn(
  deps: FlowDeps,
  input: {
    account: AccountRow;
    password: string;
    own: CarriedToken | undefined;
    now: Date;
  }
): Promise<SignInResult> {
  const { core, settings } = deps;
  const { account, now } = input;
  const session = core.opaque.create();
  const browser =
    input.own === undefined
      ? core.opaque.create()
      : { secret: input.own.token, hash: input.own.row.tokenHash };
  const rehashed =
    account.passwordHash !== null &&
    core.passwords.needsRehash(account.passwordHash)
      ? await core.passwords.hash(input.password)
      : null;

  let started;
  try {
    started = await deps.db.transaction(async tx => {
      const written = await writeAtVersion(tx, account, {
        lastSignedInAt: now,
        failuresInARow: 0,
        ...(rehashed === null ? {} : { passwordHash: rehashed }),
      });
      if (!written) throw new VersionMoved();
      const row = await startSession(
        tx,
        { accountId: account.id, tokenHash: session.hash, now },
        sessionLimits(settings)
      );
      await rememberBrowser(
        tx,
        { accountId: account.id, tokenHash: browser.hash, now },
        settings.knownBrowsers.perAccount
      );
      return row;
    });
  } catch (error) {
    if (error instanceof VersionMoved)
      return { status: "refused", reason: "try-again" };
    throw error;
  }

  return {
    status: "signed-in",
    session: { token: session.secret, expiresAt: started.absoluteExpiresAt },
    knownBrowserToken: browser.secret,
  };
}
