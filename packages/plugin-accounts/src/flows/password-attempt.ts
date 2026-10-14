import { LIMIT_RULES } from "../core/limit-rules";
import type { AdmittedReservation, LimitEntry } from "../core/ports";
import {
  accountByAddress,
  claimResetRequiredEmail,
  normaliseAddress,
  recordFailedPassword,
  type AccountRow,
} from "../storage/accounts";
import {
  cappedUntil,
  chargeKnownBrowser,
  knownBrowserById,
  recordFailedCheck,
  startCountAgain,
  type KnownBrowserRow,
} from "../storage/known-browsers";

import type { FlowDeps } from "./deps";
import { ADDRESS } from "./input";
import { validTokens } from "./known-tokens";
import { pageLink } from "./links";
import { mintResetLink } from "./reset-request";

/** A known-browser token an attempt carries, charged with the attempt. */
export interface CarriedToken {
  token: string;
  row: KnownBrowserRow;
  /** Whether this attempt took one of the token's slots under its cap. */
  underCap: boolean;
}

/** Why an attempt at a password was refused, as every caller answers it. */
export type AttemptRefusal =
  /** The address or the password is wrong, or a refusal that must look like it. */
  | { status: "refused"; reason: "wrong-credentials" }
  | { status: "refused"; reason: "wait"; retryAfterMs: number }
  | { status: "refused"; reason: "try-again" };

export const WRONG: AttemptRefusal = {
  status: "refused",
  reason: "wrong-credentials",
};

export type PasswordAttempt =
  | {
      status: "proven";
      /** The account's own token among those the attempt carries, if any. */
      own: CarriedToken | undefined;
      /** Whether that token, under its cap, made the browser known to the account. */
      known: boolean;
      reservation: AdmittedReservation;
      addressKey: string;
    }
  | { status: "refused"; refusal: AttemptRefusal };

/**
 * An attempt at an account's password, counted as a sign-in is wherever a
 * password is asked for: signing in, and a holder's change or deletion.
 * Every known-browser token the attempt carries is charged before it
 * starts, whatever address it names. The attempt then takes its place in
 * the address's count and the client's, before any check: the address only
 * when neither it nor the client is waiting as it starts, the client
 * always; the account's own token, under its cap, enforces neither. A wait
 * refusing an attempt that carries a valid token is answered as a wrong
 * password, in a check's time but computing nothing. The password is
 * checked through core, against a decoy for an address with no account,
 * and a wrong one counts toward the account's failures in a row.
 */
export async function attemptPassword(
  deps: FlowDeps,
  input: {
    account: AccountRow | null;
    addressKey: string;
    password: string;
    client: string | null;
    knownTokens: readonly string[];
    now: Date;
  }
): Promise<PasswordAttempt> {
  const { account, now } = input;
  const carried = await chargeCarriedTokens(deps, input.knownTokens, now);
  const own =
    account === null
      ? undefined
      : carried.find(token => token.row.accountId === account.id);
  const known = own?.underCap === true;

  const reservation = await reserveAttempt(deps, {
    addressKey: input.addressKey,
    client: input.client,
    known,
  });
  if (reservation.status === "unavailable")
    return refused({ status: "refused", reason: "try-again" });
  if (reservation.status === "refused") {
    return refused(
      await refuseWaiting(deps, carried.length > 0, reservation.retryAfterMs)
    );
  }
  const ownWait = await cappedTokenWait(deps, own, now);
  if (ownWait !== null)
    return refused(await refuseWaiting(deps, true, ownWait));

  if (account === null) {
    await deps.pacer.verify(input.password, null);
    return refused(WRONG);
  }
  if (
    !(await passwordProven(deps, {
      account,
      own,
      password: input.password,
      now,
    }))
  )
    return refused(WRONG);

  return {
    status: "proven",
    own,
    known,
    reservation: reservation.reservation,
    addressKey: input.addressKey,
  };
}

/**
 * An attempt at the password of whatever account an address a visitor
 * typed names: an address that is not one is answered as a wrong password
 * in a check's time, and one with no account is checked against the decoy.
 * Proven, it answers the account.
 */
export async function attemptForAddress(
  deps: FlowDeps,
  input: {
    address: string;
    password: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<
  | {
      status: "proven";
      account: AccountRow;
      attempt: Extract<PasswordAttempt, { status: "proven" }>;
    }
  | AttemptRefusal
> {
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) {
    await deps.pacer.waitAsLongAsACheck();
    return WRONG;
  }
  const account = await accountByAddress(deps.db, address.data);
  const attempt = await attemptPassword(deps, {
    account,
    addressKey: normaliseAddress(address.data),
    password: input.password,
    client: input.client,
    knownTokens: input.knownTokens ?? [],
    now: deps.now(),
  });
  if (attempt.status === "refused") return attempt.refusal;
  // A proven password means the account exists.
  if (account === null) return WRONG;

  return { status: "proven", account, attempt };
}

/**
 * After an attempt whose password was proven succeeds: the address's waits
 * end, the client is given the attempt back, and the account's own token,
 * if the attempt carried it, starts its count again.
 */
export async function attemptSucceeded(
  deps: FlowDeps,
  attempt: Extract<PasswordAttempt, { status: "proven" }>
): Promise<void> {
  if (attempt.own !== undefined)
    await startCountAgain(deps.db, attempt.own.row.id);
  await deps.core.limits.reset({
    rule: LIMIT_RULES.signInAddress,
    key: attempt.addressKey,
  });
  await deps.core.limits.release(attempt.reservation, {
    rules: [LIMIT_RULES.signInClient],
  });
}

function refused(refusal: AttemptRefusal): PasswordAttempt {
  return { status: "refused", refusal };
}

/** The valid known browsers the cookie names, each charged with this attempt before it starts. */
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

/** The time left on the account's own token's wait once it is past its cap; null otherwise. */
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
 * A wait's refusal: as a wrong password, in a check's time, for an attempt
 * that carries a valid token; with the time to wait for any other.
 */
async function refuseWaiting(
  deps: FlowDeps,
  carriesToken: boolean,
  retryAfterMs: number
): Promise<AttemptRefusal> {
  if (!carriesToken) return { status: "refused", reason: "wait", retryAfterMs };
  await deps.pacer.waitAsLongAsACheck();
  return WRONG;
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
    account,
    now,
    deps.settings.failuresBeforeReset
  );
  if (own !== undefined) await recordFailedCheck(deps.db, own.row.id, now);
  if (counted?.resetRequired === true)
    await emailResetRequired(deps, account, now);

  return false;
}

/** Emails the holder of an account that needs a reset a reset link, at most once a day, never a deactivated one. */
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
  const token = await deps.db.transaction(tx =>
    mintResetLink(deps, tx, account)
  );
  if (token === null) return;
  await deps.mail.queue({
    kind: "reset-required",
    accountId: account.id,
    to: account.address,
    link: pageLink(deps.settings, "reset", token),
  });
}
