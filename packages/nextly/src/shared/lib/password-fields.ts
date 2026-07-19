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
 * Resolve a container field value to its descendable rows. On SQLite a
 * `group` / `repeater` is stored as a JSON string, so the raw value must be
 * parsed before its nested passwords are reachable. `serialize()` writes the
 * (mutated) container back in the original shape — a string when the input
 * was a string, so the column type is preserved. Returns null when a string
 * value is not valid JSON (nothing to descend into).
 */
function openContainer(
  value: unknown,
  type: string
): { rows: Record<string, unknown>[]; serialize: () => unknown } | null {
  const wasString = typeof value === "string";
  let container: unknown = value;
  if (wasString) {
    try {
      container = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return {
    rows: containerRows(container, type),
    serialize: () => (wasString ? JSON.stringify(container) : container),
  };
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
      const opened = openContainer(data[field.name], field.type);
      if (opened) {
        for (const row of opened.rows) {
          await hashPasswordFieldValues(row, field.fields);
        }
        data[field.name] = opened.serialize();
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
      const opened = openContainer(entry[field.name], field.type);
      if (opened) {
        for (const row of opened.rows) {
          stripPasswordFieldValues(row, field.fields);
        }
        entry[field.name] = opened.serialize();
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

/** System owner column, in the snake_case column form and the camelCase form. */
const OWNER_COLUMN_KEYS = ["created_by", "createdBy"] as const;

/**
 * Remove the system owner column (`created_by`) from a response row, in place.
 *
 * The owner column holds the creator's stable user id. Owner-only access
 * filters on it in SQL, so its value never needs to leave the server; returning
 * it would leak a stable user id to any caller who can read a collection whose
 * rows were created by other users. Callers strip it on the read/mutation
 * response boundary, the same place password values are cleared.
 */
export function stripSystemOwnerField(entry: Record<string, unknown>): void {
  for (const key of OWNER_COLUMN_KEYS) {
    if (key in entry) delete entry[key];
  }
}
