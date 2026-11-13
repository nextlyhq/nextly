/**
 * The one digester every account password goes through.
 *
 * An app may pass its own `passwordHasher` to `getNextly`; without one, core
 * hashes with bcrypt. Every path that hashes an account password (create, an
 * administrator's set, a person's change, a reset, an invite, the first
 * password) and every path that verifies one (core sign-in, `authenticate`,
 * the current-password check) takes its digester from `passwordDigester`, so
 * which scheme a password is stored in never depends on which path wrote it.
 *
 * A configured hasher still verifies the bcrypt values core wrote before it
 * was configured, and reports them for re-hashing: the sign-in that proves the
 * password stores it again with the configured hasher.
 *
 * @module auth/password/digester
 */

import type { PasswordHasher } from "./policy";

import { hashPassword, isPasswordHash, verifyPassword } from "./index";

/** What a password check found. */
export type PasswordVerdict =
  | { ok: false }
  /** `rehash`: the stored value is core's bcrypt and the app hashes otherwise. */
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
   * Check a password against a stored value. A value that is not a hash is
   * refused after a comparison against a decoy of the same scheme, so the
   * refusal takes as long as a wrong password does.
   */
  verify(password: string, stored: unknown): Promise<PasswordVerdict>;
  /**
   * Spend the time one comparison takes and admit nothing: what a sign-in
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
 * What each app hasher writes, learned once by hashing a value nobody knows:
 * the decoy its comparisons run against, and whether its output is bcrypt (a
 * hasher that writes bcrypt itself has nothing to re-hash).
 */
const probes = new WeakMap<
  PasswordHasher,
  Promise<{ decoy: string; writesBcrypt: boolean }>
>();

function probe(
  hasher: PasswordHasher
): Promise<{ decoy: string; writesBcrypt: boolean }> {
  let found = probes.get(hasher);
  if (!found) {
    found = hasher
      .hash(`decoy-${crypto.randomUUID()}`)
      .then(decoy => ({ decoy, writesBcrypt: isPasswordHash(decoy) }));
    // A failed probe is not kept, so the next sign-in asks again.
    found.catch(() => probes.delete(hasher));
    probes.set(hasher, found);
  }
  return found;
}

/** Whether `stored` is core's bcrypt that the app's hasher does not claim. */
function coreBcrypt(
  hasher: PasswordHasher | undefined,
  stored: string
): boolean {
  return isPasswordHash(stored) && !(hasher?.isHash?.(stored) ?? false);
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
  const decoy = async (password: string): Promise<void> => {
    if (!hasher) {
      await verifyPassword(password || "-", BCRYPT_DECOY);
      return;
    }
    try {
      await hasher.verify(password, (await probe(hasher)).decoy);
    } catch {
      // The decoy only spends time; its answer and failures are not used.
    }
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
      if (!hasher || coreBcrypt(hasher, stored)) {
        if (!(await verifyPassword(password, stored))) return { ok: false };
        return {
          ok: true,
          rehash: hasher !== undefined && !(await probe(hasher)).writesBcrypt,
        };
      }
      return (await hasher.verify(password, stored))
        ? { ok: true, rehash: false }
        : { ok: false };
    },
  };
}
