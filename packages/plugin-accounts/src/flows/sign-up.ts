import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PasswordCheck } from "../core/ports";
import {
  accountByAddress,
  createAccount,
  type AccountRow,
} from "../storage/accounts";

import { HOUR, MINUTE, type FlowDeps } from "./deps";
import { pageLink } from "./links";
import { PURPOSES } from "./purposes";

/** Why a sign-up was refused, said to the visitor. */
export type SignUpRefusal =
  | "invalid-name"
  | "invalid-address"
  | Extract<PasswordCheck, { ok: false }>["reason"];

/**
 * The answer to a sign-up. A free address and a taken one both answer
 * `accepted`, with a sign-up browser token to set as its cookie, so the
 * answer never shows whether an address has an account.
 */
export type SignUpResult =
  | { status: "accepted"; browserToken: string; browserTokenExpiresAt: Date }
  | { status: "refused"; reason: SignUpRefusal };

export interface SignUpInput {
  name: string;
  address: string;
  password: string;
  /** The sign-up browser token this browser already holds, if any. */
  browserToken?: string;
}

const NAME = z.string().trim().min(1).max(255);
const ADDRESS = z.string().trim().pipe(z.email().max(320));

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

  const { core, settings } = deps;
  const check = await core.passwords.check(input.password, {
    minLength: settings.passwordMinLength,
    breached: settings.breachedPasswordCheck,
  });
  if (!check.ok) return { status: "refused", reason: check.reason };
  if (check.breachedCheck === "unavailable") {
    deps.logger.warn(
      "[accounts] a new password went unchecked: the breached-password source did not answer"
    );
  }
  // Hashed on both paths, so a taken address costs what a free one does.
  const passwordHash = await core.passwords.hash(input.password);

  try {
    return await createAndMint(deps, {
      name: name.data,
      address: address.data,
      passwordHash,
    });
  } catch (error) {
    if (!(error instanceof AddressTaken)) throw error;
  }

  return answerTaken(deps, address.data, input.browserToken);
}

async function createAndMint(
  deps: FlowDeps,
  input: { name: string; address: string; passwordHash: string }
): Promise<SignUpResult> {
  const { core, settings } = deps;
  const linkMs = settings.verification.linkHours * HOUR;
  const minted = await deps.db.transaction(async tx => {
    const created = await createAccount(tx, deps.dialect, input);
    // A refusal aborts the transaction on PostgreSQL, so it is rolled back
    // here and the taken answer is made outside it.
    if (created.status === "taken") throw new AddressTaken();
    const subject = created.account.id;
    const link = await core.secrets.mintToken(
      { purpose: PURPOSES.verifyLink, subject, expiresInMs: linkMs },
      { tx }
    );
    const code = await core.secrets.mintCode(
      {
        purpose: PURPOSES.verifyCode,
        subject,
        expiresInMs: settings.verification.codeMinutes * MINUTE,
        digits: codeDigits(settings.verification.codeDigits),
        maxWrongTries: settings.verification.codeTries,
      },
      { tx }
    );
    const notMe = await core.secrets.mintToken(
      { purpose: PURPOSES.notMe, subject, expiresInMs: linkMs },
      { tx }
    );
    const browser = await core.secrets.mintToken(
      { purpose: PURPOSES.signUpBrowser, subject, expiresInMs: linkMs },
      { tx }
    );
    return { account: created.account, link, code, notMe, browser };
  });

  await deps.mail.queue({
    kind: "verify-address",
    accountId: minted.account.id,
    to: minted.account.address,
    name: minted.account.name,
    link: pageLink(settings, "verify", minted.link.token),
    code: minted.code.code,
    notMeLink: pageLink(settings, "notMe", minted.notMe.token),
  });

  return accepted(minted.browser);
}

/**
 * The taken address's answer: the same sign-up browser token as a free
 * address gets, bound to no account, and an email to the address. A browser
 * whose token is already bound to the address's pending account (a retry, or
 * a double submit) keeps that binding, so it stays the browser that signed up.
 */
async function answerTaken(
  deps: FlowDeps,
  address: string,
  browserToken: string | undefined
): Promise<SignUpResult> {
  const { core, settings } = deps;
  const existing = await accountByAddress(deps.db, address);
  const kept = await keptBinding(deps, existing, browserToken);
  const browser =
    kept ??
    (await core.secrets.mintToken({
      purpose: PURPOSES.signUpBrowser,
      // Never an account's id, so the token signs nothing in.
      subject: `unbound-${randomUUID()}`,
      expiresInMs: settings.verification.linkHours * HOUR,
    }));

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

/**
 * The settings bound the digits to 6 to 8, which core's helper takes as a
 * literal; anything else is a setting that skipped its bounds, refused here.
 */
function codeDigits(digits: number): 6 | 7 | 8 {
  if (digits === 6 || digits === 7 || digits === 8) return digits;
  throw new RangeError(`A code of ${digits} digits is outside 6 to 8.`);
}
