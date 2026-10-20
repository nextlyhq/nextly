import bcrypt from "bcryptjs";

import { checkPasswordPolicyRules, type PasswordPolicyOptions } from "./policy";

/**
 * Password hashing/verification utilities for credentials authentication.
 * Uses bcryptjs to avoid native build steps and keep portability.
 */

const defaultSaltRounds = 12; // Reasonable default; can be tuned via env later

/**
 * A bcrypt hash as `hashPassword` writes it: the `$2a$`, `$2b$` or `$2y$`
 * prefix, a two-digit cost, and 53 characters of salt and digest.
 */
const PASSWORD_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Whether a stored or supplied value is a password hash. The one test of it:
 * a password is never stored, or compared, as anything else. Nothing decides
 * whether to hash a value by asking this; every raw password is hashed.
 */
export function isPasswordHash(value: unknown): value is string {
  return typeof value === "string" && PASSWORD_HASH.test(value);
}

export async function hashPassword(
  plain: string,
  saltRounds: number = defaultSaltRounds
): Promise<string> {
  if (!plain) {
    throw new Error("hashPassword: plain must be non-empty");
  }
  const salt = await bcrypt.genSalt(saltRounds);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  // A stored value that is not a hash is refused rather than compared: it
  // can only be a password stored as given, and admitting a login by it would
  // make that plain text a working credential.
  if (!plain || !isPasswordHash(hash)) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export * from "./policy";

export type PasswordStrengthResult =
  | { ok: true; errors?: undefined }
  | { ok: false; errors: string[] };

export function validatePasswordStrength(
  password: string,
  options?: PasswordPolicyOptions
): PasswordStrengthResult {
  const errors = checkPasswordPolicyRules(password, options);
  if (errors.length === 0) {
    return { ok: true };
  } else {
    return {
      ok: false,
      errors,
    };
  }
}
