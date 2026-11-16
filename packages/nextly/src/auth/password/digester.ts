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
 * With an app's hasher, a value the hasher claims (by its `isHash`, or any
 * bcrypt value where the hasher writes bcrypt itself, a peppered bcrypt) is
 * the hasher's alone to verify, and its refusal stands. Any other bcrypt value
 * is core's from before the hasher was configured: one core verifies is
 * reported for re-hashing, and the sign-in that proved it stores it again with
 * the hasher. A hasher that writes bcrypt and declares no `isHash` claims
 * every bcrypt value, so core's older ones then verify only through it.
 *
 * @module auth/password/digester
 */

import { checkDigesterReach, type PasswordHasher } from "./policy";

import { hashPassword, isPasswordHash, verifyPassword } from "./index";

/** What a password check found. */
export type PasswordVerdict =
  | { ok: false }
  /**
   * `rehash`: core's bcrypt verified it, read the whole of it, the app hashes
   * with its own hasher, and that hasher takes the whole password.
   */
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
    made = hasher.hash(decoyPassword(hasher));
    // A failed one is not kept, so the next refusal asks again.
    made.catch(() => decoys.delete(hasher));
    decoys.set(hasher, made);
  }
  return made;
}

/**
 * A password nobody knows that the hasher accepts: within its reach and
 * passing its own `validate`, longest first. A hasher that refused the decoy
 * would leave nothing to compare a missing account against, and that refusal
 * would then answer faster than a wrong password.
 */
function decoyPassword(hasher: PasswordHasher): string {
  const random = crypto.randomUUID().replaceAll("-", "");
  for (const length of [24, 16, 12, 8, 4]) {
    const candidate = `Dc0!${random}`.slice(0, length);
    if (checkDigesterReach(candidate, hasher) === null) return candidate;
  }
  return random.slice(0, 4);
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
      // A bcrypt value is the hasher's own only where the hasher says so or
      // writes bcrypt itself (a peppered bcrypt, learned from its decoy).
      // Otherwise it is core's, from before the hasher: the hasher could turn
      // it away faster than it checks a password, so it is compared with the
      // hasher's decoy instead, and every refusal costs one real comparison of
      // each scheme, whatever is stored.
      const bcrypt = isPasswordHash(stored);
      const ownDecoy = await decoyOf(hasher).catch(() => "");
      const coreEra =
        bcrypt && !(hasher.isHash?.(stored) ?? isPasswordHash(ownDecoy));
      if (!coreEra && (await hasherVerifies(hasher, password, stored))) {
        return { ok: true, rehash: false };
      }
      if (coreEra) await hasherVerifies(hasher, password, ownDecoy);
      // A value the hasher claims is the hasher's alone to answer: its refusal
      // stands, and core's bcrypt weighs only its decoy, so a peppered
      // hasher's value never admits the peppered input itself.
      const coreOk = await coreCompare(
        password,
        coreEra ? stored : BCRYPT_DECOY
      );
      if (!coreEra || !coreOk) return { ok: false };
      // Proven by core's bcrypt. Stored again with the hasher only when
      // bcrypt read the whole of it (past its 72 bytes, a suffix was never
      // compared, so storing it would replace the password with the attempt)
      // and the hasher takes the whole of it (its reach, or its own
      // validate). Anything else is kept as bcrypt, which goes on verifying it.
      return {
        ok: true,
        rehash:
          checkDigesterReach(password) === null &&
          checkDigesterReach(password, hasher) === null,
      };
    },
  };
}
