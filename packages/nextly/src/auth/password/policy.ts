/**
 * Staff password policy and digester reach contract.
 *
 * Implements requirement R-5 of the staff-only access spec:
 * - Length: at least 8 characters (code points) by default, which can be raised to 15.
 * - Upper bound: at most 128 characters (resource safety).
 * - Common passwords: checks against the 3,000 common passwords list (NFC-normalized, case-insensitive).
 * - No character class requirements (lowercase, uppercase, digit, symbol are NOT required).
 * - Digester reach: default bcrypt digester has a 72-byte limit (UTF-8 byte length). Passwords past reach are refused.
 * - Custom digesters must declare their reach contract (reach or validate) or the system refuses to start.
 */

import type { PasswordHasher } from "../../domains/users/services/user-service";
import { NextlyError } from "../../errors/nextly-error";
import { COMMON_PASSWORDS } from "../../plugins/security/common-passwords";

export const DEFAULT_MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH_CHARS = 128;
export const DEFAULT_DIGESTER_REACH_BYTES = 72;

let activeMinPasswordLength = DEFAULT_MIN_PASSWORD_LENGTH;
let activePasswordHasher: PasswordHasher | undefined;

// Pre-compute lowercased, NFC-normalized common password set for fast O(1) lookup.
const commonPasswordsSet = new Set<string>(
  COMMON_PASSWORDS.map(p => p.normalize("NFC").toLowerCase())
);

export function getMinPasswordLength(): number {
  return activeMinPasswordLength;
}

export function setMinPasswordLength(length: number): void {
  activeMinPasswordLength = length;
}

export function getActivePasswordHasher(): PasswordHasher | undefined {
  return activePasswordHasher;
}

export function setActivePasswordHasher(hasher?: PasswordHasher): void {
  activePasswordHasher = hasher;
}

export function resetPasswordPolicy(): void {
  activeMinPasswordLength = DEFAULT_MIN_PASSWORD_LENGTH;
  activePasswordHasher = undefined;
}

/**
 * Counts Unicode code points (characters) rather than UTF-16 code units.
 */
export function countCodePoints(str: string): number {
  let count = 0;
  for (const _ of str) {
    count++;
  }
  return count;
}

/**
 * Checks whether a password matches the 3,000 common passwords list (case-insensitively, NFC-normalized).
 */
export function isCommonPassword(password: string): boolean {
  return commonPasswordsSet.has(password.normalize("NFC").toLowerCase());
}

/**
 * Asserts that a custom PasswordHasher declares its reach contract.
 * Throws NextlyError.invalidInput naming the digester if missing.
 */
export function assertPasswordHasherContract(hasher: unknown): void {
  if (!hasher || typeof hasher !== "object") return;
  const h = hasher as Record<string, unknown>;
  const hasReach = h.reach === "unbounded" || typeof h.reach === "number";
  const hasValidate = typeof h.validate === "function";

  if (!hasReach && !hasValidate) {
    const digesterName =
      (typeof h.name === "string" && h.name) ||
      (h.constructor && h.constructor.name !== "Object"
        ? h.constructor.name
        : "PasswordHasher");
    throw NextlyError.invalidInput({
      message: `Password digester "${digesterName}" must declare its reach contract (specify 'reach' or 'validate').`,
      logContext: { digester: digesterName },
    });
  }
}

/**
 * Validates the reach of a password against the digester.
 * Returns an error message string if the password exceeds the reach, or null if valid.
 */
export function checkDigesterReach(
  password: string,
  hasher?: PasswordHasher
): string | null {
  const effectiveHasher = hasher ?? activePasswordHasher;

  if (effectiveHasher) {
    // Custom digester: must adhere to its reach contract
    assertPasswordHasherContract(effectiveHasher);

    if (typeof effectiveHasher.validate === "function") {
      try {
        const result = effectiveHasher.validate(password);
        if (result === false) {
          return "Password exceeds the digester's reach.";
        }
        if (typeof result === "string") {
          return result;
        }
        if (
          typeof result === "object" &&
          result !== null &&
          "ok" in result &&
          !result.ok
        ) {
          return (
            (result as { message?: string }).message ??
            "Password exceeds the digester's reach."
          );
        }
      } catch (err) {
        return (
          (err instanceof Error ? err.message : String(err)) ||
          "Password exceeds the digester's reach."
        );
      }
    }

    if (effectiveHasher.reach === "unbounded") {
      // Unbounded: no byte length limit (the 128 character resource cap applies)
      return null;
    }

    if (typeof effectiveHasher.reach === "number") {
      const bytes = Buffer.byteLength(password, "utf8");
      if (bytes > effectiveHasher.reach) {
        return `Password exceeds the ${effectiveHasher.reach}-byte limit of the password digester.`;
      }
      return null;
    }

    return null;
  }

  // Default bcrypt digester: 72 bytes
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes > DEFAULT_DIGESTER_REACH_BYTES) {
    return `Password exceeds the ${DEFAULT_DIGESTER_REACH_BYTES}-byte limit of the password digester.`;
  }
  return null;
}

export interface PasswordPolicyOptions {
  minLength?: number;
  hasher?: PasswordHasher;
}

export type { PasswordHasher };

/**
 * Checks all password policy rules against a password:
 * 1. Character count >= minLength (counts code points after NFC, so 4 emojis fail)
 * 2. Character count <= 128 (resource safety)
 * 3. Not in common passwords list (NFC normalized, case insensitive)
 * 4. Within digester reach (72 bytes for bcrypt, or custom reach)
 *
 * Does NOT require character classes (lowercase, uppercase, number, symbol).
 */
export function checkPasswordPolicyRules(
  password: string,
  options?: PasswordPolicyOptions
): string[] {
  const errors: string[] = [];

  if (typeof password !== "string" || password.length === 0) {
    errors.push("Password is required");
    return errors;
  }

  const minLength = options?.minLength ?? getMinPasswordLength();
  const normalised = password.normalize("NFC");
  const charCount = countCodePoints(normalised);

  if (charCount < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  }

  if (charCount > MAX_PASSWORD_LENGTH_CHARS) {
    errors.push(
      `Password must be at most ${MAX_PASSWORD_LENGTH_CHARS} characters`
    );
  }

  if (isCommonPassword(normalised)) {
    errors.push("This password is too common.");
  }

  const reachError = checkDigesterReach(password, options?.hasher);
  if (reachError) {
    errors.push(reachError);
  }

  return errors;
}
