import { createHash, randomBytes } from "node:crypto";

import { PasswordTooLongError } from "@nextlyhq/plugin-sdk";

import type {
  PasswordCheck,
  PasswordHelper,
  PasswordRules,
} from "../core/ports";

import { FakeCoreMisuse, roundTrip } from "./fake-transactions";

const CEILING = 256;

/** A few of the passwords every common-password list carries. */
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwertyuiop",
  "iloveyou",
]);

/**
 * Core's password helper, fast: a salted SHA-256 rather than a slow hash,
 * with core's bounds, normalisation and answers. A test reads
 * `decoyVerifications` to see an unknown address spend a verification.
 */
export class FakePasswordHelper implements PasswordHelper {
  readonly ceiling: typeof CEILING = CEILING;
  /** The scheme new hashes carry. Change it and every older hash needs a rehash. */
  scheme = "fake1";
  /** The passwords the site's breached-password source knows. */
  readonly breached: Set<string> = new Set<string>();
  /** False: the breached-password source does not answer. */
  breachedSourceUp = true;
  /** How many times `verify` spent its time against the decoy. */
  decoyVerifications = 0;

  async hash(password: string): Promise<string> {
    await roundTrip();
    const normalised = password.normalize("NFC");
    if (codePoints(normalised) > CEILING) {
      // Core's own error, so a caller's handling is tried against it.
      throw new PasswordTooLongError();
    }
    const salt = randomBytes(8).toString("hex");

    return `${this.scheme}$${salt}$${digest(salt, normalised)}`;
  }

  async verify(password: string, hash: string | null): Promise<boolean> {
    await roundTrip();
    if (hash === null) {
      this.decoyVerifications += 1;
      return false;
    }
    const [scheme, salt, expected, ...rest] = hash.split("$");
    const normalised = password.normalize("NFC");
    const matches =
      scheme?.startsWith("fake") === true &&
      salt !== undefined &&
      expected !== undefined &&
      rest.length === 0 &&
      codePoints(normalised) <= CEILING &&
      digest(salt, normalised) === expected;

    return matches;
  }

  needsRehash(hash: string): boolean {
    return !hash.startsWith(`${this.scheme}$`);
  }

  async check(
    password: string,
    rules: PasswordRules = {}
  ): Promise<PasswordCheck> {
    await roundTrip();
    const { minLength, maxLength } = lengthBounds(rules);
    const normalised = password.normalize("NFC");
    const length = codePoints(normalised);
    if (length < minLength) return { ok: false, reason: "too-short" };
    if (length > maxLength) return { ok: false, reason: "too-long" };
    if (COMMON.has(normalised.toLowerCase())) {
      return { ok: false, reason: "common" };
    }

    return rules.breached === true
      ? this.#breachedCheck(normalised)
      : { ok: true, breachedCheck: "skipped" };
  }

  /** The site's breached-password source's answer for a password that passed the rest. */
  #breachedCheck(normalised: string): PasswordCheck {
    if (!this.breachedSourceUp)
      return { ok: true, breachedCheck: "unavailable" };

    return this.breached.has(normalised)
      ? { ok: false, reason: "breached" }
      : { ok: true, breachedCheck: "passed" };
  }
}

/** The rules' lengths with core's defaults, refused outside core's bounds. */
function lengthBounds(rules: PasswordRules): {
  minLength: number;
  maxLength: number;
} {
  const minLength = rules.minLength ?? 8;
  const maxLength = rules.maxLength ?? 128;
  const inBounds =
    minLength >= 8 &&
    minLength <= 64 &&
    maxLength >= 64 &&
    maxLength <= CEILING;
  if (!inBounds) {
    throw new FakeCoreMisuse(
      `password rules out of bounds: ${minLength} to ${maxLength}`
    );
  }

  return { minLength, maxLength };
}

function codePoints(text: string): number {
  return [...text].length;
}

function digest(salt: string, password: string): string {
  return createHash("sha256").update(`${salt}\u0000${password}`).digest("hex");
}
