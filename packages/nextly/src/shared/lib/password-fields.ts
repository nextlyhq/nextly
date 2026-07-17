/**
 * Password-field value handling for the entry write/read paths.
 *
 * `password`-type fields hold secrets, so they get the same treatment as
 * user credentials: bcrypt-hashed before storage and never serialized back
 * to clients. Verification against a stored hash goes through
 * `verifyPassword` from `auth/password`.
 *
 * Password fields can live at any depth — directly on a collection, or
 * nested inside a `group` or `repeater` container — so every helper here
 * descends into container values. A nested password must never be stored
 * in plaintext or returned in a response.
 *
 * @module shared/lib/password-fields
 */

import { hashPassword } from "../../auth/password";

/** The minimal field shape both FieldConfig and FieldDefinition satisfy. */
interface NamedField {
  name?: string;
  // `string`, not the strict field-type union: these helpers accept both
  // code-first FieldConfig[] and runtime FieldDefinition[], whose `type`
  // unions differ, so `string` is their only common supertype.
  type: string;
  /** Nested fields for `group` / `repeater` container types. */
  fields?: NamedField[];
}

/** A `group` value is one object; a `repeater` value is an array of rows. */
function containerRows(
  value: unknown,
  type: string
): Record<string, unknown>[] {
  if (type === "group") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? [value as Record<string, unknown>]
      : [];
  }
  if (type === "repeater") {
    return Array.isArray(value)
      ? value.filter(
          (row): row is Record<string, unknown> =>
            row !== null && typeof row === "object" && !Array.isArray(row)
        )
      : [];
  }
  return [];
}

/**
 * Hash every provided password-field value in `data` in place, descending
 * into `group` / `repeater` containers.
 *
 * Semantics per value:
 * - non-empty string → replaced with its bcrypt hash (always; pre-hashed
 *   detection heuristics are deliberately avoided)
 * - `null` → kept, clearing the stored value
 * - empty or whitespace-only string, or non-string → key removed; on update
 *   that means "keep the stored hash", on create it means "store nothing"
 *   (matches how entry validation treats whitespace-only as empty, so an
 *   optional password of spaces can't silently replace the stored hash)
 */
export async function hashPasswordFieldValues(
  data: Record<string, unknown>,
  fields: NamedField[]
): Promise<void> {
  for (const field of fields) {
    if (!field.name || !(field.name in data)) continue;

    if (field.fields && (field.type === "group" || field.type === "repeater")) {
      for (const row of containerRows(data[field.name], field.type)) {
        await hashPasswordFieldValues(row, field.fields);
      }
      continue;
    }

    if (field.type !== "password") continue;

    const value = data[field.name];
    if (value === null) continue;

    if (typeof value !== "string" || value.trim() === "") {
      delete data[field.name];
      continue;
    }

    data[field.name] = await hashPassword(value);
  }
}

/**
 * Remove password-field values from an entry about to be serialized to a
 * client, descending into containers. Stored hashes are write-only:
 * exposing them enables offline cracking, and the plaintext must never
 * round-trip through the admin.
 */
export function stripPasswordFieldValues(
  entry: Record<string, unknown>,
  fields: NamedField[]
): void {
  for (const field of fields) {
    if (!field.name || !(field.name in entry)) continue;

    if (field.fields && (field.type === "group" || field.type === "repeater")) {
      for (const row of containerRows(entry[field.name], field.type)) {
        stripPasswordFieldValues(row, field.fields);
      }
      continue;
    }

    if (field.type === "password") {
      delete entry[field.name];
    }
  }
}

/**
 * Whether any field in the set (at any depth) is a password field — lets
 * read paths skip the per-entry strip loop entirely for the common
 * no-password case without missing a nested password.
 */
export function hasPasswordField(fields: NamedField[]): boolean {
  return fields.some(
    field =>
      field.type === "password" ||
      (Boolean(field.fields) && hasPasswordField(field.fields!))
  );
}
