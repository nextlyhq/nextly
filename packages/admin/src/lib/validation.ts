/**
 * Validation Utilities
 *
 * Centralized validation functions for common data validation needs.
 * Use these utilities to maintain consistency across the application.
 */

import { z } from "zod";

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
export const createSlugSchema = () => {
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

/**
 * Client-side mirror of the server's PasswordSchema in
 * @nextly/schemas/validation. Keep these rules in sync — the server is
 * authoritative, but mirroring lets the user see failures before submit.
 *
 * One regex per rule means each unmet requirement surfaces as its own
 * FormMessage instead of a single combined error.
 */
export const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  );

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
  if (!password) return { score: 0, label: "", color: "bg-muted" };

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
