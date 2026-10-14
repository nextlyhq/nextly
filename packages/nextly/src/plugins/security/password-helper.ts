/**
 * The password helper core lends plugins as `ctx.security.passwords`.
 *
 * scrypt from `node:crypto` over the whole password, NFC-normalised, written
 * as a self-describing string that names its algorithm and setting, so a
 * later setting (or Argon2id, once every supported Node version has it) moves
 * a stored hash at the next sign-in through `needsRehash` rather than by a
 * migration.
 *
 * Deliberately separate from the staff path's hashing (bcrypt, in
 * `auth/password/`), which reads only the first 72 bytes, and from an app's
 * `passwordHasher`, whose contract has no "needs rehash" and no way to
 * recognise its own output.
 *
 * @module plugins/security/password-helper
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { NextlyError } from "../../errors/nextly-error";
import type { Logger } from "../../services/shared";
import type { BreachedPasswordsConfig } from "../../shared/types/config";

import { checkBreached } from "./breached-passwords";
import { COMMON_PASSWORDS } from "./common-passwords";

/**
 * @experimental Hashing, verifying and checking passwords for a plugin's own
 * people (`ctx.security.passwords`).
 */
export interface PasswordHelper {
  /**
   * Hashes the whole password, NFC-normalised, with a fresh salt. Throws
   * {@link PasswordTooLongError} past `ceiling`, and a validation error for a
   * password that is not well-formed Unicode (a lone surrogate). The result is
   * opaque ASCII of at most 255 characters.
   */
  hash(password: string): Promise<string>;
  /**
   * False on a mismatch, a malformed hash, or one the helper did not write (a
   * staff bcrypt hash among them); never throws for any. Verifies the helper's
   * own earlier settings. With null, spends a real verification's time
   * against a decoy and answers false.
   */
  verify(password: string, hash: string | null): Promise<boolean>;
  /**
   * True for any string that is not a hash at today's algorithm and setting,
   * a format the helper does not know included.
   */
  needsRehash(hash: string): boolean;
  /**
   * Checks a new password against the rules. Throws a validation error for
   * rules outside their bounds, or a password that is not well-formed Unicode.
   */
  check(password: string, rules?: PasswordRules): Promise<PasswordCheck>;
  /** The hard maximum, in code points after NFC: 256. */
  readonly ceiling: number;
}

/** @experimental The rules a new password is checked against. */
export interface PasswordRules {
  /** 8 to 64, default 8: code points after NFC. */
  minLength?: number;
  /** 64 to `ceiling`, default 128. */
  maxLength?: number;
  /** Default false: also ask the site's breached-password source. */
  breached?: boolean;
}

/** @experimental What a check of a new password found. */
export type PasswordCheck =
  | { ok: true; breachedCheck: "passed" | "skipped" | "unavailable" }
  | { ok: false; reason: "too-short" | "too-long" | "common" | "breached" };

/** The hard maximum length, in code points. */
const CEILING = 256;

/** The rules' bounds and defaults, in code points. */
const MIN_LENGTH = { lowest: 8, highest: 64, default: 8 } as const;
const MAX_LENGTH = { lowest: 64, highest: CEILING, default: 128 } as const;

/** A scrypt setting: N = 2^ln, block size r, parallelism p. */
interface ScryptSetting {
  readonly ln: number;
  readonly r: number;
  readonly p: number;
}

/**
 * The setting every new hash uses: OWASP's Password Storage Cheat Sheet lists
 * N = 2^15, r = 8, p = 3 as equal in cost to its N = 2^17, r = 8, p = 1, with
 * a quarter of the memory: 32 MiB a hash, inside the 64 MiB bound so that
 * concurrent sign-ins on a small serverless instance do not exhaust it.
 */
const CURRENT: ScryptSetting = { ln: 15, r: 8, p: 3 };

/**
 * Every setting a stored hash may name and still be verified: OWASP's scrypt
 * settings that stay within 64 MiB. Anything else is refused unread, so a
 * stored string can never make the helper allocate or spin without bound.
 */
const VERIFIABLE: readonly ScryptSetting[] = [
  // Named rather than restated, so moving CURRENT can never leave the helper
  // writing hashes it would then refuse to read.
  CURRENT,
  { ln: 16, r: 8, p: 2 },
  { ln: 14, r: 8, p: 5 },
  { ln: 13, r: 8, p: 10 },
];

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * `$scrypt$ln=<ln>,r=<r>,p=<p>$<salt>$<key>`, salt and key in unpadded
 * base64: the PHC string format's shape, so the algorithm and setting are read
 * from the hash itself.
 */
const FORMAT =
  /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{22,86})\$([A-Za-z0-9+/]{43,86})$/;

/** The longest string `hash` may return: a plugin sizes its column by it. */
const MAX_HASH_LENGTH = 255;

/**
 * @experimental Thrown by `hash` for a password longer than the helper's
 * ceiling. The password is never cut to fit.
 */
export class PasswordTooLongError extends NextlyError {
  /** The ceiling the password went past, in code points. */
  readonly ceiling = CEILING;

  constructor() {
    super({
      code: "VALIDATION_ERROR",
      publicMessage: `The password is too long: at most ${CEILING} characters.`,
      logMessage: "A password past the helper's ceiling was refused",
      logContext: { ceiling: CEILING },
    });
    // NextlyError's constructor names every instance "NextlyError"; this one
    // keeps its own name so a plugin can tell it apart in a log.
    this.name = "PasswordTooLongError";
  }
}

/** What the helper is built from. */
export interface PasswordHelperOptions {
  /** The site's breached-password source; unset means `"pwned-passwords"`. */
  breachedPasswords?: BreachedPasswordsConfig;
  /** Where a malformed stored hash is reported, without the hash itself. */
  logger: Pick<Logger, "warn">;
  /** The `fetch` a range service is called with; injectable for tests. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

/** Build the helper a plugin receives as `ctx.security.passwords`. */
export function createPasswordHelper(
  options: PasswordHelperOptions
): PasswordHelper {
  return {
    ceiling: CEILING,

    async hash(password) {
      assertWellFormed(password);
      const normalised = password.normalize("NFC");
      if (codePoints(normalised) > CEILING) throw new PasswordTooLongError();
      const salt = randomBytes(SALT_BYTES);
      const key = await derive(normalised, salt, CURRENT, KEY_BYTES);
      const encoded = encode(CURRENT, salt, key);
      // Holds by construction at every setting the helper writes; asserted so
      // a later setting cannot quietly outgrow a column sized by the bound.
      if (encoded.length > MAX_HASH_LENGTH) {
        throw NextlyError.internal({
          logContext: {
            reason: "password-hash-too-long",
            length: encoded.length,
          },
        });
      }
      return encoded;
    },

    async verify(password, hash) {
      const normalised = password.normalize("NFC");
      const parsed = hash === null ? null : parse(hash);
      if (hash !== null && parsed === null) {
        options.logger.warn(
          "A stored password hash is in no format the plugin password helper writes; it was answered as a mismatch.",
          { length: hash.length }
        );
      }
      // An unknown person, a hash the helper cannot read, a password past the
      // ceiling and one that is not well-formed Unicode all cost what a real
      // verification costs, so how long the answer takes says nothing about
      // which of them it was.
      if (
        parsed === null ||
        codePoints(normalised) > CEILING ||
        !isWellFormed(password)
      ) {
        await spendDecoy(normalised);
        return false;
      }
      const key = await derive(
        normalised,
        parsed.salt,
        parsed.setting,
        parsed.key.length
      );
      return timingSafeEqual(key, parsed.key);
    },

    needsRehash(hash) {
      const parsed = parse(hash);
      return (
        parsed === null ||
        !sameSetting(parsed.setting, CURRENT) ||
        parsed.salt.length !== SALT_BYTES ||
        parsed.key.length !== KEY_BYTES
      );
    },

    async check(password, rules = {}) {
      assertWellFormed(password);
      const minLength = bounded(
        "minLength",
        rules.minLength ?? MIN_LENGTH.default,
        MIN_LENGTH
      );
      const maxLength = bounded(
        "maxLength",
        rules.maxLength ?? MAX_LENGTH.default,
        MAX_LENGTH
      );
      const normalised = password.normalize("NFC");
      const length = codePoints(normalised);
      if (length < minLength) return { ok: false, reason: "too-short" };
      if (length > maxLength) return { ok: false, reason: "too-long" };
      if (commonPasswords().has(normalised.toLowerCase())) {
        return { ok: false, reason: "common" };
      }
      if (!rules.breached) return { ok: true, breachedCheck: "skipped" };
      const answer = await checkBreached(
        normalised,
        options.breachedPasswords,
        options.fetch
      );
      if (answer === "breached") return { ok: false, reason: "breached" };
      return {
        ok: true,
        breachedCheck: answer === "unavailable" ? "unavailable" : "passed",
      };
    },
  };
}

/** A UTF-16 unit of a surrogate pair standing alone, in either order. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether the string is well-formed Unicode. One holding a lone surrogate,
 * which JSON can carry as an escape, would be encoded to UTF-8 with every such
 * unit replaced by the same character, so two different passwords would hash
 * alike. The helper refuses them rather than let them collapse.
 */
function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}

/** A validation error for a password that is not well-formed Unicode. */
function assertWellFormed(password: string): void {
  if (isWellFormed(password)) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "password",
        code: "INVALID_UNICODE",
        message: "The password is not well-formed Unicode.",
      },
    ],
  });
}

/**
 * A length in code points, as NIST SP 800-63B-4 counts one: an astral
 * character is one, not the two UTF-16 units `length` counts.
 */
function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** `value` when it is a whole number inside `bound`; otherwise a validation error naming it. */
function bounded(
  name: "minLength" | "maxLength",
  value: number,
  bound: { readonly lowest: number; readonly highest: number }
): number {
  if (
    Number.isInteger(value) &&
    value >= bound.lowest &&
    value <= bound.highest
  ) {
    return value;
  }
  throw NextlyError.validation({
    errors: [
      {
        path: name,
        code: "OUT_OF_RANGE",
        message: `${name} must be a whole number from ${bound.lowest} to ${bound.highest}.`,
      },
    ],
    logContext: { rule: name, lowest: bound.lowest, highest: bound.highest },
  });
}

/** scrypt over the password's UTF-8 bytes, with room for the setting's memory. */
function derive(
  password: string,
  salt: Buffer,
  setting: ScryptSetting,
  length: number
): Promise<Buffer> {
  const N = 2 ** setting.ln;
  // scrypt needs 128 * N * r bytes; Node refuses past `maxmem` (32 MiB by
  // default), so the allowance is the setting's own plus a little headroom.
  const maxmem = 128 * N * setting.r + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(password, "utf8"),
      salt,
      length,
      { N, r: setting.r, p: setting.p, maxmem },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

function encode(setting: ScryptSetting, salt: Buffer, key: Buffer): string {
  return `$scrypt$ln=${setting.ln},r=${setting.r},p=${setting.p}$${unpadded(salt)}$${unpadded(key)}`;
}

function unpadded(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}

/**
 * A stored hash's setting, salt and key, or null for anything the helper did
 * not write or would not verify: another format (a bcrypt hash among them), a
 * setting outside {@link VERIFIABLE}, or a salt or key of the wrong size.
 */
function parse(
  hash: string
): { setting: ScryptSetting; salt: Buffer; key: Buffer } | null {
  const match = FORMAT.exec(hash);
  if (!match) return null;
  const setting = {
    ln: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
  };
  if (!VERIFIABLE.some(known => sameSetting(known, setting))) return null;
  const salt = Buffer.from(match[4] ?? "", "base64");
  const key = Buffer.from(match[5] ?? "", "base64");
  if (salt.length < SALT_BYTES || key.length < KEY_BYTES) return null;
  return { setting, salt, key };
}

function sameSetting(a: ScryptSetting, b: ScryptSetting): boolean {
  return a.ln === b.ln && a.r === b.r && a.p === b.p;
}

/**
 * Spend a real verification's time and answer nothing: the same derivation at
 * the current setting, compared against random bytes it can never equal. No
 * stored decoy is needed, so the first such call costs what every later one
 * does.
 */
async function spendDecoy(password: string): Promise<void> {
  const derived = await derive(
    password,
    randomBytes(SALT_BYTES),
    CURRENT,
    KEY_BYTES
  );
  timingSafeEqual(derived, randomBytes(KEY_BYTES));
}

/** The shipped list as a set, built the first time a check needs it. */
let commonSet: ReadonlySet<string> | undefined;

function commonPasswords(): ReadonlySet<string> {
  commonSet ??= new Set(COMMON_PASSWORDS);
  return commonSet;
}
