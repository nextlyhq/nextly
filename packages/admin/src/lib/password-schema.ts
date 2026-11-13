/**
 * The client-side password rule, and the common-password list it reads.
 *
 * Kept apart from the rest of the validation helpers because the list is the
 * heaviest thing here (3,000 strings, about 15 KB gzipped) and only forms that
 * set a password want it: it arrives in a chunk of its own, asked for as this
 * module loads, and before it has arrived the form checks everything but the
 * list. The server applies the same list on every write, so a common password
 * submitted in that moment is still refused, with the same message.
 *
 * @module lib/password-schema
 */

import { z } from "zod";

import { currentPasswordRule } from "./password-rule";
import { retryableModule } from "./retryable-module";

/** The server's fixed limit (auth/password/policy.ts); the rest it publishes. */
const MAX_LENGTH = 128;

/**
 * Pre-computed lowercased, NFC-normalized set, as the server keeps one. The
 * shared corpus is imported from its source file: it is plain data with no
 * server imports, so it bundles safely into the client, and the `nextly`
 * package entry stays out of the bundle.
 */
const commonPasswords = retryableModule(() =>
  import("../../../nextly/src/plugins/security/common-passwords").then(
    ({ COMMON_PASSWORDS }) =>
      new Set(COMMON_PASSWORDS.map(p => p.normalize("NFC").toLowerCase()))
  )
);
commonPasswords.preload();

/** Counts Unicode code points (characters), not UTF-16 code units. */
function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) {
    count++;
  }
  return count;
}

/**
 * Whether the list holds this password. Asks for the list again when it has
 * not arrived, so one failed fetch does not leave the rule off for the session.
 */
function isCommonPassword(lowerCased: string): boolean {
  const list = commonPasswords.loaded();
  if (list === null) {
    commonPasswords.preload();
    return false;
  }
  return list.has(lowerCased);
}

/**
 * Client-side mirror of the server's PasswordSchema in
 * packages/nextly/src/schemas/_zod/validation.ts, used by every admin form
 * that sets a password. The server is authoritative; mirroring lets the user
 * see failures before submit, and src/types/userform-password.test.ts holds
 * the two to the same verdicts — same rules, same messages, same order:
 * 1. At least the published minimum (8 by default; code points, after NFC)
 * 2. At most 128 characters (resource safety)
 * 3. Not on the 3,000 common passwords list (NFC-normalized, case-insensitive)
 * 4. Within the published byte limit of the hasher (72 for bcrypt; UTF-8)
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

    // The minimum and the byte limit the server published, read as the
    // password is checked, so a form drawn before the answer arrived still
    // judges by it.
    const { minLength, maxBytes } = currentPasswordRule();
    const normalized = value.normalize("NFC");
    const charCount = countCodePoints(normalized);

    if (charCount < minLength) {
      addIssue(`Password must be at least ${minLength} characters`);
    }

    if (charCount > MAX_LENGTH) {
      addIssue(`Password must be at most ${MAX_LENGTH} characters`);
    }

    if (isCommonPassword(normalized.toLowerCase())) {
      addIssue("This password is too common.");
    }

    // UTF-8 byte length, browser-safe: the server reads the password raw, so
    // the mirror measures it raw too, not the NFC-normalized form. No limit
    // where the app's hasher reads a password whole.
    if (
      maxBytes !== null &&
      new TextEncoder().encode(value).length > maxBytes
    ) {
      addIssue(
        `Password exceeds the ${maxBytes}-byte limit of the password digester.`
      );
    }
  });
