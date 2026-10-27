/**
 * Validation Utilities
 *
 * Centralized validation functions for common data validation needs.
 * Use these utilities to maintain consistency across the application.
 */

import { z } from "zod";

// The shared 3,000-password corpus, imported from its source file: it is
// plain data with no server imports, so it bundles safely into the client.
// The `nextly` package entry stays out of the bundle; only this list crosses.
import { COMMON_PASSWORDS } from "../../../nextly/src/plugins/security/common-passwords";

/**
 * UUID v4 Regular Expression
 *
 * Matches UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where x is any hexadecimal digit and y is one of 8, 9, A, or B
 *
 * @see https://www.ietf.org/rfc/rfc4122.txt
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID v4
 *
 * @param id - The string to validate
 * @returns true if the string is a valid UUID, false otherwise
 *
 * @example
 * ```ts
 * isValidUUID('550e8400-e29b-41d4-a716-446655440000'); // true
 * isValidUUID('invalid-uuid'); // false
 * isValidUUID(''); // false
 * ```
 */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validates and returns a UUID if valid, otherwise returns null
 *
 * Useful for route parameter validation where you want to
 * extract and validate in one step.
 *
 * @param id - The string to validate
 * @returns The UUID if valid, null otherwise
 *
 * @example
 * ```ts
 * const userId = validateUUID(route.params.id); // string | null
 * if (!userId) {
 *   return <ErrorPage>Invalid user ID</ErrorPage>;
 * }
 * ```
 */
export function validateUUID(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmedId = id.trim();
  return isValidUUID(trimmedId) ? trimmedId : null;
}

/**
 * Creates a slug validation schema
 * @returns A Zod schema for slug validation
 */
export const createSlugSchema = (): z.ZodString => {
  return z
    .string()
    .regex(
      /^[a-z0-9_]+(?:[-_][a-z0-9_]+)*$/,
      "Must be a valid slug (lowercase letters, numbers, underscores, and hyphens)"
    );
};

// =======================
// Password validation
// =======================

/** The server's default policy constants (auth/password/policy.ts). */
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const DIGESTER_REACH_BYTES = 72;

// Pre-computed lowercased, NFC-normalized set, as the server keeps one.
const commonPasswords = new Set(
  COMMON_PASSWORDS.map(p => p.normalize("NFC").toLowerCase())
);

/** Counts Unicode code points (characters), not UTF-16 code units. */
function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) {
    count++;
  }
  return count;
}

/**
 * Client-side mirror of the server's PasswordSchema in
 * packages/nextly/src/schemas/_zod/validation.ts, used by every admin form
 * that sets a password. The server is authoritative; mirroring lets the user
 * see failures before submit, and src/types/userform-password.test.ts holds
 * the two to the same verdicts — same rules, same messages, same order:
 * 1. At least 8 characters (code points, after NFC normalization)
 * 2. At most 128 characters (resource safety)
 * 3. Not on the 3,000 common passwords list (NFC-normalized, case-insensitive)
 * 4. Within the default digester's 72-byte reach (UTF-8)
 * No character class is required — a class-less passphrase passes.
 */
export const passwordSchema: z.ZodString = z
  .string()
  .superRefine((value, ctx) => {
    const addIssue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });

    if (value.length === 0) {
      addIssue("Password is required");
      return;
    }

    const normalized = value.normalize("NFC");
    const charCount = countCodePoints(normalized);

    if (charCount < MIN_LENGTH) {
      addIssue(`Password must be at least ${MIN_LENGTH} characters`);
    }

    if (charCount > MAX_LENGTH) {
      addIssue(`Password must be at most ${MAX_LENGTH} characters`);
    }

    if (commonPasswords.has(normalized.toLowerCase())) {
      addIssue("This password is too common.");
    }

    // UTF-8 byte length, browser-safe: the server reads the password raw, so
    // the mirror measures it raw too, not the NFC-normalized form.
    if (new TextEncoder().encode(value).length > DIGESTER_REACH_BYTES) {
      addIssue(
        `Password exceeds the ${DIGESTER_REACH_BYTES}-byte limit of the password digester.`
      );
    }
  });

export type PasswordStrength = {
  score: number;
  label: "" | "Weak" | "Medium" | "Strong";
  color: string;
};

/**
 * Computes a 0–6 strength score and label/color tokens for the password
 * meter. Visual indicator only — never use this to gate submission;
 * `passwordSchema` is the authoritative client-side check.
 */
export function calculatePasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "", color: "bg-primary/5" };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: "Weak", color: "bg-destructive" };
  if (score <= 4) return { score, label: "Medium", color: "bg-warning" };
  return { score, label: "Strong", color: "bg-success" };
}
