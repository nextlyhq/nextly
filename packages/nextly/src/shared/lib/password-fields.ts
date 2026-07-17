/**
 * Password-field value handling for the entry write/read paths.
 *
 * `password`-type fields hold secrets, so they get the same treatment as
 * user credentials: bcrypt-hashed before storage and never serialized back
 * to clients. Verification against a stored hash goes through
 * `verifyPassword` from `auth/password`.
 *
 * @module shared/lib/password-fields
 */

import { hashPassword } from "../../auth/password";

/** The minimal field shape both FieldConfig and FieldDefinition satisfy. */
interface NamedField {
  name?: string;
  type: string;
}

/**
 * Hash every provided password-field value in `data` in place.
 *
 * Semantics per value:
 * - non-empty string → replaced with its bcrypt hash (always; pre-hashed
 *   detection heuristics are deliberately avoided)
 * - `null` → kept, clearing the stored value
 * - empty string or non-string → key removed; on update that means "keep
 *   the stored hash", on create it means "store nothing" (required-ness is
 *   the validator's concern, not this transform's)
 */
export async function hashPasswordFieldValues(
  data: Record<string, unknown>,
  fields: NamedField[]
): Promise<void> {
  for (const field of fields) {
    if (field.type !== "password" || !field.name || !(field.name in data)) {
      continue;
    }

    const value = data[field.name];
    if (value === null) continue;

    if (typeof value !== "string" || value === "") {
      delete data[field.name];
      continue;
    }

    data[field.name] = await hashPassword(value);
  }
}

/**
 * Remove password-field values from an entry about to be serialized to a
 * client. Stored hashes are write-only: exposing them enables offline
 * cracking, and the plaintext must never round-trip through the admin.
 */
export function stripPasswordFieldValues(
  entry: Record<string, unknown>,
  fields: NamedField[]
): void {
  for (const field of fields) {
    if (field.type === "password" && field.name && field.name in entry) {
      delete entry[field.name];
    }
  }
}

/**
 * Whether any field in the set is a password field — lets read paths skip
 * the per-entry strip loop entirely for the common no-password case.
 */
export function hasPasswordField(fields: NamedField[]): boolean {
  return fields.some(field => field.type === "password");
}
