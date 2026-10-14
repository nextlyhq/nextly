import { LIMIT_RULES } from "../core/limit-rules";
import {
  accountByAddress,
  writeAtVersion,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";
import { startSession, type SessionRow } from "../storage/sessions";

import { sessionLimits, type FlowDeps } from "./deps";
import { linkedAccount } from "./linked-account";
import { PURPOSES } from "./purposes";

/** The secrets a verification spends or voids: every one tied to verifying this address. */
const VERIFICATION_PURPOSES = [
  PURPOSES.verifyLink,
  PURPOSES.verifyCode,
  PURPOSES.notMe,
  PURPOSES.signUpBrowser,
];

/** A session to set as the visitor's cookie, which lasts until `expiresAt`. */
export interface StartedSession {
  token: string;
  expiresAt: Date;
}

export type VerifyResult =
  /** Verified; a session started, except for a deactivated account. */
  | { status: "verified"; session: StartedSession | null }
  /** Not the browser that signed up: the visitor signs in there, and nothing was spent. */
  | { status: "sign-in-needed" }
  | { status: "refused"; reason: "invalid" | "expired" | "spent" | "try-again" }
  | { status: "refused"; reason: "wrong-code"; triesLeft: number }
  | { status: "refused"; reason: "too-many-tries"; retryAfterMs: number };

/** Ends the verification's transaction with this answer, rolling it back. */
class Refusal extends Error {
  constructor(readonly reason: "spent" | "try-again") {
    super(reason);
  }
}

/**
 * Verifies an address by the link from its email. In the browser that
 * signed up, the link is spent with the verification, in one transaction:
 * the address is marked verified by "link", every other verification secret
 * is voided, and a session starts. In any other browser, nothing is spent
 * and the visitor is asked to sign in there.
 */
export async function verifyByLink(
  deps: FlowDeps,
  input: { token: string; browserToken?: string }
): Promise<VerifyResult> {
  const { core } = deps;
  const linked = await linkedAccount(deps, PURPOSES.verifyLink, input.token);
  if (linked.status === "refused") return linked;
  const { account } = linked;
  if (!(await signedUpHere(deps, account, input.browserToken)))
    return { status: "sign-in-needed" };

  return completeVerification(deps, account, "link", async tx => {
    const spent = await core.secrets.consumeToken(
      { purpose: PURPOSES.verifyLink, token: input.token },
      { tx }
    );
    return spent.ok;
  });
}

/**
 * Verifies an address by the code typed from its email, in the browser that
 * signed up. Each try is first reserved against the address's tries in 24
 * hours, across every code sent to it; the code is spent on its own, outside
 * any transaction, so no rollback gives a wrong try back; a right code gives
 * the try back. In any other browser, nothing is tried.
 */
export async function verifyByCode(
  deps: FlowDeps,
  input: { address: string; code: string; browserToken?: string }
): Promise<VerifyResult> {
  const { core } = deps;
  const account = await accountByAddress(deps.db, input.address);
  if (
    account === null ||
    !(await signedUpHere(deps, account, input.browserToken))
  ) {
    return { status: "sign-in-needed" };
  }

  const reservation = await core.limits.reserve([
    { rule: LIMIT_RULES.codeTries, key: account.addressNormalised },
  ]);
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };
  if (reservation.status === "refused") {
    return {
      status: "refused",
      reason: "too-many-tries",
      retryAfterMs: reservation.retryAfterMs,
    };
  }

  const spent = await core.secrets.consumeCode({
    purpose: PURPOSES.verifyCode,
    subject: account.id,
    code: input.code,
  });
  if (!spent.ok) {
    return spent.reason === "wrong"
      ? { status: "refused", reason: "wrong-code", triesLeft: spent.triesLeft }
      : {
          status: "refused",
          reason: spent.reason === "none" ? "invalid" : spent.reason,
        };
  }
  // A right code's try is given back, whatever the verification does next.
  await core.limits.release(reservation.reservation);

  return completeVerification(deps, account, "code");
}

/** Whether this browser's sign-up token ties it to the account. */
async function signedUpHere(
  deps: FlowDeps,
  account: AccountRow,
  browserToken: string | undefined
): Promise<boolean> {
  if (browserToken === undefined) return false;
  const bound = await deps.core.secrets.peekToken({
    purpose: PURPOSES.signUpBrowser,
    token: browserToken,
  });

  return bound.ok && bound.subject === account.id;
}

/**
 * Marks the address verified, voids every other verification secret, and
 * starts a session unless the account is deactivated, in one transaction
 * that writes only while the account's security version is the one read: a
 * reset, a sign-out everywhere or a deactivation that committed since is
 * seen, and nothing is written. `spend` spends the secret inside it.
 */
async function completeVerification(
  deps: FlowDeps,
  account: AccountRow,
  by: "link" | "code",
  spend?: (tx: AccountsDb) => Promise<boolean>
): Promise<VerifyResult> {
  const { core } = deps;
  const now = deps.now();
  const session = account.deactivatedAt === null ? core.opaque.create() : null;
  let started: SessionRow | null;
  try {
    started = await deps.db.transaction(async tx => {
      if (spend !== undefined && !(await spend(tx))) throw new Refusal("spent");
      const written = await writeAtVersion(tx, account, {
        verifiedAt: account.verifiedAt ?? now,
        verifiedBy: account.verifiedBy ?? by,
      });
      if (!written) throw new Refusal("try-again");
      await core.secrets.voidFor(
        { subject: account.id, purposes: VERIFICATION_PURPOSES },
        { tx }
      );

      return session === null
        ? null
        : startSession(
            tx,
            { accountId: account.id, tokenHash: session.hash, now },
            sessionLimits(deps.settings)
          );
    });
  } catch (error) {
    if (error instanceof Refusal)
      return { status: "refused", reason: error.reason };
    throw error;
  }

  return {
    status: "verified",
    session:
      session === null || started === null
        ? null
        : { token: session.secret, expiresAt: started.absoluteExpiresAt },
  };
}
