/**
 * The one digester every account password goes through.
 *
 * An app may set its own `passwordHasher` (`auth.passwordHasher`, or passed to
 * `getNextly`); without one, core hashes with bcrypt. Every path that hashes an
 * account password (create, an administrator's set, a person's change, a
 * reset, an invite, the first password) and every path that verifies one (core
 * sign-in, `authenticate`, the current-password check) takes its digester from
 * `passwordDigester`, so which scheme a password is stored in never depends on
 * which path wrote it.
 *
 * With an app's hasher, a stored value is offered to the hasher first,
 * whatever it looks like, so a hasher whose own output is bcrypt-shaped (a
 * peppered bcrypt) keeps verifying it. A value the hasher does not verify may
 * be core's bcrypt from before the hasher was configured: one core verifies
 * is reported for re-hashing, and the sign-in that proved it stores it again
 * with the hasher.
 *
 * @module auth/password/digester
 */

import type { PasswordHasher } from "./policy";

import { hashPassword, isPasswordHash, verifyPassword } from "./index";

/** What a password check found. */
export type PasswordVerdict =
  | { ok: false }
  /** `rehash`: core's bcrypt verified it, and the app hashes with its own hasher. */
  | { ok: true; rehash: boolean };

/** Hashes and verifies account passwords with the app's scheme. */
export interface PasswordDigester {
  /** The app's hasher, or `undefined` where core's bcrypt is the scheme. */
  readonly hasher: PasswordHasher | undefined;
  /** Hash a raw password for storage. */
  hash(password: string): Promise<string>;
  /**
   * Whether a stored value can be a password hash of this app: core's bcrypt,
   * or, where the app has a hasher, one the hasher recognises (any non-empty
   * value where it declares no `isHash`). A value that is neither can only be
   * a password stored as given, and is never compared.
   */
  isHash(stored: unknown): stored is string;
  /**
   * Check a password against a stored value. Every refusal costs the same
   * comparisons as any other (a decoy's, where there is nothing to compare), so
   * the time a refusal takes does not say what is stored.
   */
  verify(password: string, stored: unknown): Promise<PasswordVerdict>;
  /**
   * Spend the time a refused check takes and admit nothing: what a sign-in
   * does for an unknown address, so the answer's timing does not say whether
   * the address is registered.
   */
  decoy(password: string): Promise<void>;
}

/**
 * Core's bcrypt decoy: a cost-12 hash of nothing anyone knows, compared when
 * there is no stored hash to compare. It must not be rotated: another cost
 * would change how long the decoy comparison takes.
 */
const BCRYPT_DECOY =
  "$2b$12$ML1pr5W9k0ODLs2GFo9gruB/VcQfuby0nAeFo959eFXl0u1ZUmbb6";

/**
 * Each app hasher's decoy, made once by hashing a value nobody knows, so its
 * decoy comparison costs what its real ones do.
 */
const decoys = new WeakMap<PasswordHasher, Promise<string>>();

function decoyOf(hasher: PasswordHasher): Promise<string> {
  let made = decoys.get(hasher);
  if (!made) {
    made = hasher.hash(`decoy-${crypto.randomUUID()}`);
    // A failed one is not kept, so the next refusal asks again.
    made.catch(() => decoys.delete(hasher));
    decoys.set(hasher, made);
  }
  return made;
}

/** The hasher's answer; one that throws, on a value not its own, is no. */
async function hasherVerifies(
  hasher: PasswordHasher,
  password: string,
  stored: string
): Promise<boolean> {
  try {
    return await hasher.verify(password, stored);
  } catch {
    return false;
  }
}

/** The digester for an app's `passwordHasher`, or core's bcrypt without one. */
export function passwordDigester(
  hasher: PasswordHasher | undefined
): PasswordDigester {
  const isHash = (stored: unknown): stored is string => {
    if (typeof stored !== "string" || stored.length === 0) return false;
    if (isPasswordHash(stored)) return true;
    if (!hasher) return false;
    return hasher.isHash ? hasher.isHash(stored) : true;
  };
  const coreCompare = (password: string, stored: string) =>
    verifyPassword(password || "-", stored);
  /** One comparison of each scheme in use, admitting nothing. */
  const decoy = async (password: string): Promise<void> => {
    if (hasher) {
      await hasherVerifies(
        hasher,
        password,
        await decoyOf(hasher).catch(() => "")
      );
    }
    await coreCompare(password, BCRYPT_DECOY);
  };
  return {
    hasher,
    isHash,
    decoy,
    hash: password => (hasher ? hasher.hash(password) : hashPassword(password)),
    async verify(password, stored) {
      if (!isHash(stored) || !password) {
        await decoy(password);
        return { ok: false };
      }
      if (!hasher) {
        return (await coreCompare(password, stored))
          ? { ok: true, rehash: false }
          : { ok: false };
      }
      if (await hasherVerifies(hasher, password, stored)) {
        return { ok: true, rehash: false };
      }
      // Not the hasher's: core's bcrypt from before it, or a wrong password.
      // A value that is not bcrypt is compared with the decoy instead, so the
      // refusal costs what any other does.
      const bcrypt = isPasswordHash(stored);
      const coreOk = await coreCompare(
        password,
        bcrypt ? stored : BCRYPT_DECOY
      );
      return bcrypt && coreOk ? { ok: true, rehash: true } : { ok: false };
    },
  };
}
