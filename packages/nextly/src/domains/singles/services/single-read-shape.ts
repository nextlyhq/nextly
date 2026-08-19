/**
 * Turning a Single's stored row into the shape everything downstream expects.
 *
 * Three places need it — the webhook payload, the version snapshot on the
 * update path, and the snapshot the query path captures — and every one of them
 * was a copy. They agreed, which is what made the
 * duplication cheap to keep and expensive to have: each is a REDACTION, so a
 * field type that learns a JSON encoding, or a new column that must never leave
 * the server, has to be taught to all of them or one of them ships the raw
 * value. A password hash reaching durable version history is not a bug that
 * announces itself.
 *
 * @module domains/singles/services/single-read-shape
 */

import type { FieldConfig } from "../../../collections/fields/types";
import {
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";

import { shouldTreatAsJson } from "./single-utils";

/**
 * Redact a row and normalise its JSON-backed fields, in place.
 *
 * Two things, because they are never wanted apart:
 *
 * - Password hashes and the system owner column never leave the server. The
 *   row carries bcrypt hashes (hashing runs before the write), so a later
 *   password change would otherwise leave the superseded hash permanently
 *   recoverable through a snapshot or a webhook payload; the owner column is
 *   stripped for the same reason the read path strips it, so history cannot
 *   retain a stable owner id or let a restore overwrite ownership.
 * - JSON-backed fields (richText, group, json, ...) are parsed to the read
 *   shape. SQLite returns them as strings, so an unparsed value would not match
 *   a normal read — and a snapshot holding the string form restores wrongly.
 */
export function applyReadShape(
  row: Record<string, unknown>,
  fieldConfigs: FieldConfig[]
): void {
  stripPasswordFieldValues(row, fieldConfigs);
  stripSystemOwnerField(row);
  for (const field of fieldConfigs) {
    if (!("name" in field) || !field.name) continue;
    const value = row[field.name];
    if (shouldTreatAsJson(field) && typeof value === "string") {
      try {
        row[field.name] = JSON.parse(value);
      } catch {
        // Not valid JSON — keep the raw string.
      }
    }
  }
}
