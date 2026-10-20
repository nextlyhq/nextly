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
/** The highest minimum an app may configure (NIST SP 800-63B-4: raise 8 to 15). */
export const MAX_MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH_CHARS = 128;
export const DEFAULT_DIGESTER_REACH_BYTES = 72;

let activeMinPasswordLength = DEFAULT_MIN_PASSWORD_LENGTH;

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

export function resetPasswordPolicy(): void {
  activeMinPasswordLength = DEFAULT_MIN_PASSWORD_LENGTH;
}

/**
 * The reach-relevant part of a digester's contract — everything
 * `checkDigesterReach` reads. A full `PasswordHasher` satisfies it, and so
 * does a bare descriptor naming only what the check needs.
 */
export type DigesterReach = Pick<PasswordHasher, "reach" | "validate" | "name">;

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
 * Throws NextlyError.invalidInput naming the digester if the contract is
 * missing, or if a numeric reach is not a positive whole number of bytes —
 * `NaN`/`Infinity` would silently disable the truncation check (comparisons
 * against them are always false) and a negative reach would refuse every
 * password, so neither may reach a check.
 */
export function assertPasswordHasherContract(hasher: unknown): void {
  if (!hasher || typeof hasher !== "object") return;
  const h = hasher as Record<string, unknown>;
  const digesterName =
    (typeof h.name === "string" && h.name) ||
    (h.constructor && h.constructor.name !== "Object"
      ? h.constructor.name
      : "PasswordHasher");

  if (
    typeof h.reach === "number" &&
    !(Number.isSafeInteger(h.reach) && h.reach > 0)
  ) {
    throw NextlyError.invalidInput({
      message: `Password digester "${digesterName}" declares reach ${String(h.reach)}: it must be a positive whole number of bytes or "unbounded".`,
      logContext: { digester: digesterName, reach: String(h.reach) },
    });
  }

  const hasReach = h.reach === "unbounded" || typeof h.reach === "number";
  const hasValidate = typeof h.validate === "function";

  if (!hasReach && !hasValidate) {
    throw NextlyError.invalidInput({
      message: `Password digester "${digesterName}" must declare its reach contract (specify 'reach' or 'validate').`,
      logContext: { digester: digesterName },
    });
  }
}

/**
 * The refusal a validator's ANSWER states — `false`, a message, or a
 * `{ ok: false }` verdict — or null when it accepts. An empty message is
 * still a refusal: it falls back to the generic one, never to acceptance.
 */
function validatorResultRefusal(result: unknown): string | null {
  if (result === false) {
    return "Password exceeds the digester's reach.";
  }
  if (typeof result === "string") {
    return result || "Password exceeds the digester's reach.";
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    !(result as { ok: boolean }).ok
  ) {
    return (
      (result as { message?: string }).message ||
      "Password exceeds the digester's reach."
    );
  }
  return null;
}

/**
 * What a named digester's custom validator says about the password, if it
 * has one. A thrown validator is a fault, not a policy answer: its message
 * may carry internal detail, so it stays off the wire and the generic
 * refusal stands in for it.
 */
function namedValidatorRefusal(
  password: string,
  digester: DigesterReach
): string | null {
  if (typeof digester.validate !== "function") {
    return null;
  }
  try {
    return validatorResultRefusal(digester.validate(password));
  } catch {
    return "Password exceeds the digester's reach.";
  }
}

/**
 * What a named digester's declared byte reach says about the password, once
 * its validator (if any) has accepted. "Unbounded" reads any length whole —
 * the 128 character resource cap applies on its own.
 */
function namedReachRefusal(
  password: string,
  digester: DigesterReach
): string | null {
  if (digester.reach === "unbounded") {
    return null;
  }
  if (typeof digester.reach === "number") {
    const bytes = Buffer.byteLength(password, "utf8");
    if (bytes > digester.reach) {
      return `Password exceeds the ${digester.reach}-byte limit of the password digester.`;
    }
  }
  return null;
}

/**
 * The refusal a password earns from a NAMED digester's contract, or null
 * when the digester reads it whole.
 */
function digesterContractRefusal(
  password: string,
  digester: DigesterReach
): string | null {
  // The named digester: must adhere to its reach contract.
  assertPasswordHasherContract(digester);
  return (
    namedValidatorRefusal(password, digester) ??
    namedReachRefusal(password, digester)
  );
}

/**
 * Validates the reach of a password against the digester that will hash it.
 * Returns an error message string if the password exceeds the reach, or null
 * if valid. With no digester named, the default bcrypt reach applies — the
 * answer for every core flow, which all hash with bcrypt; a flow that hashes
 * with an app-configured digester passes that digester here itself.
 */
export function checkDigesterReach(
  password: string,
  digester?: DigesterReach
): string | null {
  if (digester) {
    return digesterContractRefusal(password, digester);
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
  hasher?: DigesterReach;
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
