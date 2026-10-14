import { LIMIT_RULES } from "../core/limit-rules";
import type { AdmittedReservation, LimitEntry } from "../core/ports";
import {
  accountByAddress,
  claimResetRequiredEmail,
  normaliseAddress,
  recordFailedPassword,
  writeAtVersion,
  type AccountRow,
} from "../storage/accounts";
import {
  cappedUntil,
  chargeKnownBrowser,
  knownBrowserById,
  recordFailedCheck,
  rememberBrowser,
  type KnownBrowserRow,
} from "../storage/known-browsers";
import { startSession } from "../storage/sessions";

import { MINUTE, sessionLimits, type FlowDeps } from "./deps";
import { ADDRESS } from "./input";
import { validTokens } from "./known-tokens";
import { pageLink } from "./links";
import { PURPOSES } from "./purposes";
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
  /** The address or the password is wrong, or a refusal that must look like it. */
  | { status: "refused"; reason: "wrong-credentials" }
  | { status: "refused"; reason: "wait"; retryAfterMs: number }
  /** Said only once the password is proven. */
  | { status: "refused"; reason: "deactivated" | "unverified" }
  | { status: "refused"; reason: "try-again" };

const WRONG: SignInResult = { status: "refused", reason: "wrong-credentials" };

interface CarriedToken {
  token: string;
  row: KnownBrowserRow;
  /** Whether this attempt took one of the token's slots under its cap. */
  underCap: boolean;
}

/** Ends the sign-in's transaction with "try again", rolling it back. */
class VersionMoved extends Error {}

/**
 * Signs an account in. Every known-browser token the attempt carries is
 * charged before it starts, whatever address it names. The attempt then
 * takes its place in the address's count and the client's, before any
 * password check, so a burst on any number of instances starts no more
 * checks than the waits allow: the address is counted only when neither it
 * nor the client is waiting as the attempt starts, and the client always.
 * The account's own token, under its cap, skips both waits.
 *
 * A wait refusing an attempt that carries a valid token is answered as a
 * wrong password, in a check's time but computing nothing, so no answer
 * shows whose a token is. The password is checked through core, against a
 * decoy for an address with no account. A deactivated or, where required,
 * unverified account is told so only once its password is proven.
 */
export async function signIn(
  deps: FlowDeps,
  input: SignInInput
): Promise<SignInResult> {
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) {
    await deps.pacer.waitAsLongAsACheck();
    return WRONG;
  }
  const now = deps.now();
  const addressKey = normaliseAddress(address.data);
  const account = await accountByAddress(deps.db, address.data);

  const carried = await chargeCarriedTokens(deps, input.knownTokens ?? [], now);
  const own =
    account === null
      ? undefined
      : carried.find(token => token.row.accountId === account.id);
  const known = own?.underCap === true;

  const reservation = await reserveAttempt(deps, {
    addressKey,
    client: input.client,
    known,
  });
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };
  if (reservation.status === "refused") {
    return refuseWaiting(deps, carried.length > 0, reservation.retryAfterMs);
  }
  const ownWait = await cappedTokenWait(deps, own, now);
  if (ownWait !== null) return refuseWaiting(deps, true, ownWait);

  if (
    account === null ||
    !(await passwordProven(deps, {
      account,
      own,
      password: input.password,
      now,
    }))
  ) {
    if (account === null) await deps.pacer.verify(input.password, null);
    return WRONG;
  }
  const refusal = accountRefusal(deps, account, known);
  if (refusal !== null) return refusal;

  return completeSignIn(deps, {
    account,
    password: input.password,
    own,
    addressKey,
    reservation: reservation.reservation,
    now,
  });
}

/**
 * The attempt's place in the address's count and the client's, before any
 * password check. The address is counted only when neither it nor the
 * client is waiting as the attempt starts, and the client always; the
 * account's own token, under its cap, enforces neither.
 */
function reserveAttempt(
  deps: FlowDeps,
  input: { addressKey: string; client: string | null; known: boolean }
): ReturnType<FlowDeps["core"]["limits"]["reserve"]> {
  const entries: LimitEntry[] = [
    {
      rule: LIMIT_RULES.signInAddress,
      key: input.addressKey,
      count: "unanimous",
      enforce: !input.known,
    },
  ];
  if (input.client !== null) {
    entries.push({
      rule: LIMIT_RULES.signInClient,
      key: input.client,
      count: "always",
      enforce: !input.known,
    });
  }

  return deps.core.limits.reserve(entries);
}

/**
 * The time left on the account's own token's wait, once that token is past
 * its cap: null when it is under its cap, absent, or its wait has run.
 */
async function cappedTokenWait(
  deps: FlowDeps,
  own: CarriedToken | undefined,
  now: Date
): Promise<number | null> {
  if (own === undefined || own.underCap) return null;
  const row = await knownBrowserById(deps.db, own.row.id);
  const until = row === null ? null : cappedUntil(row);

  return until !== null && now < until ? until.getTime() - now.getTime() : null;
}

/**
 * Checks the account's password through core. A wrong one counts toward
 * the account's failures in a row and, through the account's own token,
 * toward that token's last failed check.
 */
async function passwordProven(
  deps: FlowDeps,
  input: {
    account: AccountRow;
    own: CarriedToken | undefined;
    password: string;
    now: Date;
  }
): Promise<boolean> {
  const { account, own, now } = input;
  if (await deps.pacer.verify(input.password, account.passwordHash))
    return true;
  const counted = await recordFailedPassword(
    deps.db,
    account.id,
    now,
    deps.settings.failuresBeforeReset
  );
  if (own !== undefined) await recordFailedCheck(deps.db, own.row.id, now);
  if (counted?.resetRequired === true)
    await emailResetRequired(deps, account, now);

  return false;
}

/**
 * Emails the holder of an account that needs a reset a reset link, at most
 * once a day and never for a deactivated account.
 */
async function emailResetRequired(
  deps: FlowDeps,
  account: AccountRow,
  now: Date
): Promise<void> {
  if (
    account.deactivatedAt !== null ||
    !(await claimResetRequiredEmail(deps.db, account.id, now))
  )
    return;
  const { token } = await deps.core.secrets.mintToken({
    purpose: PURPOSES.reset,
    subject: account.id,
    expiresInMs: deps.settings.resetLinkMinutes * MINUTE,
  });
  await deps.mail.queue({
    kind: "reset-required",
    accountId: account.id,
    to: account.address,
    link: pageLink(deps.settings, "reset", token),
  });
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
 * The valid known browsers the cookie names, each charged with this
 * attempt before it starts.
 */
async function chargeCarriedTokens(
  deps: FlowDeps,
  tokens: readonly string[],
  now: Date
): Promise<CarriedToken[]> {
  const valid = await validTokens(deps, tokens, now);

  return Promise.all(
    valid.map(async ({ token, row }) => ({
      token,
      row,
      underCap: await chargeKnownBrowser(deps.db, row.id, now),
    }))
  );
}

/**
 * A wait's refusal: as a wrong password, in a check's time, for an attempt
 * that carries a valid token; with the time to wait for any other.
 */
async function refuseWaiting(
  deps: FlowDeps,
  carriesToken: boolean,
  retryAfterMs: number
): Promise<SignInResult> {
  if (!carriesToken) return { status: "refused", reason: "wait", retryAfterMs };
  await deps.pacer.waitAsLongAsACheck();
  return WRONG;
}

/**
 * Starts the session, in one transaction that writes only at the account's
 * security version: the sign-in recorded, its failures in a row started
 * again, a hash at an older setting replaced, and the browser marked known
 * with its count started again. Then the address's waits end and the
 * client's count is given this attempt back.
 */
async function completeSignIn(
  deps: FlowDeps,
  input: {
    account: AccountRow;
    password: string;
    own: CarriedToken | undefined;
    addressKey: string;
    reservation: AdmittedReservation;
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

  await core.limits.reset({
    rule: LIMIT_RULES.signInAddress,
    key: input.addressKey,
  });
  await core.limits.release(input.reservation, {
    rules: [LIMIT_RULES.signInClient],
  });

  return {
    status: "signed-in",
    session: { token: session.secret, expiresAt: started.absoluteExpiresAt },
    knownBrowserToken: browser.secret,
  };
}
