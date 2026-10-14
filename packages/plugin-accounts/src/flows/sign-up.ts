import { randomUUID } from "node:crypto";

import {
  accountByAddress,
  createAccount,
  deleteUnverifiedAccount,
  normaliseAddress,
  type AccountRow,
} from "../storage/accounts";

import { HOUR, type FlowDeps } from "./deps";
import {
  EMAIL_REQUESTS,
  reserveEmailRequest,
  type EmailRequestVerdict,
} from "./email-limits";
import { ADDRESS, NAME } from "./input";
import { pageLink } from "./links";
import {
  breachedPasswordRefusal,
  localPasswordRefusal,
  type NewPasswordRefusal,
} from "./new-password";
import { PURPOSES } from "./purposes";
import {
  mintVerification,
  mintWhileUnverified,
  queueVerification,
} from "./verification-email";

/** Why a sign-up was refused, said to the visitor. */
export type SignUpRefusal =
  | "invalid-name"
  | "invalid-address"
  | NewPasswordRefusal;

/**
 * The answer to a sign-up. A free address and a taken one both answer
 * `accepted`, with a sign-up browser token to set as its cookie, so the
 * answer never shows whether an address has an account.
 */
export type SignUpResult =
  | { status: "accepted"; browserToken: string; browserTokenExpiresAt: Date }
  | { status: "refused"; reason: SignUpRefusal }
  | Extract<EmailRequestVerdict, { status: "refused" }>;

export interface SignUpInput {
  name: string;
  address: string;
  password: string;
  /** The sign-up browser token this browser already holds, if any. */
  browserToken?: string;
  /** The client's key (core's `clientKey`), or null when its network address cannot be read. */
  client: string | null;
}

/** Thrown inside the sign-up's transaction to roll it back when the address is taken. */
class AddressTaken extends Error {}

/**
 * Signs a visitor up. With a free address, it creates the account unverified
 * and queues the verification email (a link, a code to type, and a link to
 * remove the account), in one transaction with the account. With a taken
 * one, it queues a "someone tried to sign up" email to the address instead.
 * Either way it hashes the password and answers alike, with a sign-up
 * browser token, and starts no session: one starts at verification, in the
 * browser that signed up, or at a sign-in.
 */
export async function signUp(
  deps: FlowDeps,
  input: SignUpInput
): Promise<SignUpResult> {
  const name = NAME.safeParse(input.name);
  if (!name.success) return { status: "refused", reason: "invalid-name" };
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) return { status: "refused", reason: "invalid-address" };

  const local = await localPasswordRefusal(deps, input.password);
  if (local !== null) return { status: "refused", reason: local };
  // Counted before the breached-password lookup and the hash, the work a
  // flood of sign-ups would make the site do.
  const verdict = await reserveEmailRequest(deps, {
    kind: EMAIL_REQUESTS.signUp,
    addressKey: normaliseAddress(address.data),
    client: input.client,
  });
  if (verdict.status === "refused") return verdict;
  const breached = await breachedPasswordRefusal(deps, input.password);
  if (breached !== null) return { status: "refused", reason: breached };

  // Hashed on both paths, so a taken address costs what a free one does.
  const passwordHash = await deps.core.passwords.hash(input.password);

  try {
    return await createAndMint(deps, {
      name: name.data,
      address: address.data,
      passwordHash,
      createdAt: deps.now(),
    });
  } catch (error) {
    if (!(error instanceof AddressTaken)) throw error;
  }

  return answerTaken(deps, address.data, input.browserToken);
}

async function createAndMint(
  deps: FlowDeps,
  input: {
    name: string;
    address: string;
    passwordHash: string;
    createdAt: Date;
  }
): Promise<SignUpResult> {
  const minted = await deps.db.transaction(async tx => {
    const created = await createAccount(tx, deps.dialect, input);
    // A refusal aborts the transaction on PostgreSQL, so it is rolled back
    // here and the taken answer is made outside it.
    if (created.status === "taken") throw new AddressTaken();
    const verification = await mintVerification(deps, tx, created.account.id);
    const browser = await deps.core.secrets.mintToken(
      {
        purpose: PURPOSES.signUpBrowser,
        subject: created.account.id,
        expiresInMs: deps.settings.verification.linkHours * HOUR,
      },
      { tx }
    );
    return { account: created.account, verification, browser };
  });
  try {
    await queueVerification(deps, minted.account, minted.verification);
  } catch (error) {
    await undoSignUp(deps, minted.account.id);
    throw error;
  }

  return accepted(minted.browser);
}

/**
 * Undoes a sign-up whose verification email could not be queued: its
 * secrets voided and the account deleted while still unverified, so the
 * visitor's retry starts again as a first sign-up, with a browser that is
 * bound to it, rather than as a sign-up for a taken address.
 */
async function undoSignUp(deps: FlowDeps, accountId: string): Promise<void> {
  await deps.db.transaction(async tx => {
    await deps.core.secrets.voidFor({ subject: accountId }, { tx });
    await deleteUnverifiedAccount(tx, accountId);
  });
}

/**
 * The taken address's answer: the same sign-up browser token as a free
 * address gets, and an email to the address. Usually the token is bound to
 * no account and the email says someone tried to sign up. A browser whose
 * token is already bound to the address's pending account (a retry, or a
 * double submit) keeps that binding, so it stays the browser that signed
 * up, and the address gets a fresh verification email instead, whose code
 * voids the earlier one: the commonest reason to sign up twice is that the
 * first email never came.
 */
async function answerTaken(
  deps: FlowDeps,
  address: string,
  browserToken: string | undefined
): Promise<SignUpResult> {
  const { core, settings } = deps;
  const existing = await accountByAddress(deps.db, address);
  const kept = await keptBinding(deps, existing, browserToken);
  if (existing !== null && kept !== null) {
    const verification = await mintWhileUnverified(deps, existing);
    if (verification !== null)
      await queueVerification(deps, existing, verification);
    return accepted(kept);
  }

  const browser = await core.secrets.mintToken({
    purpose: PURPOSES.signUpBrowser,
    // Never an account's id, so the token signs nothing in.
    subject: `unbound-${randomUUID()}`,
    expiresInMs: settings.verification.linkHours * HOUR,
  });
  if (existing !== null) {
    await deps.mail.queue({
      kind: "sign-up-taken",
      accountId: existing.id,
      to: existing.address,
      deactivated: existing.deactivatedAt !== null,
      signInLink: pageLink(settings, "signIn"),
      resetLink: pageLink(settings, "reset"),
    });
  }

  return accepted(browser);
}

async function keptBinding(
  deps: FlowDeps,
  existing: AccountRow | null,
  browserToken: string | undefined
): Promise<{ token: string; expiresAt: Date } | null> {
  if (
    browserToken === undefined ||
    existing === null ||
    existing.verifiedAt !== null
  )
    return null;
  const bound = await deps.core.secrets.peekToken({
    purpose: PURPOSES.signUpBrowser,
    token: browserToken,
  });

  return bound.ok && bound.subject === existing.id
    ? { token: browserToken, expiresAt: bound.expiresAt }
    : null;
}

function accepted(browser: { token: string; expiresAt: Date }): SignUpResult {
  return {
    status: "accepted",
    browserToken: browser.token,
    browserTokenExpiresAt: browser.expiresAt,
  };
}
