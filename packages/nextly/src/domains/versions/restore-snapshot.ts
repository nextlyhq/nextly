/**
 * Turning a stored snapshot back into something the normal update path accepts.
 *
 * Restore deliberately writes through the same update a human edit uses, so
 * validation, hooks, component and many-to-many writes, events and the outbox
 * all run identically. That leaves one job here: decide what of a snapshot may
 * be resubmitted.
 *
 * @module domains/versions/restore-snapshot
 */

import type { FieldConfig } from "../../collections/fields/types";

/**
 * Columns a write must never carry.
 *
 * The collection update path strips these too, but only inside its transaction
 * — long after `beforeUpdate` hooks have seen the payload. Stripping here means
 * a hook is never handed a forged `createdBy` or a stale `createdAt`. The
 * singles path strips only `id` and `createdAt`, so for that path this is the
 * only place ownership is protected at all.
 */
const IMMUTABLE_FIELDS = new Set([
  "id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "createdBy",
  "created_by",
]);

/**
 * Columns every document carries whether or not the schema declares a field of
 * that name — the schema pipeline synthesizes them when it does not.
 */
const ALWAYS_WRITABLE_COLUMNS = new Set(["title", "slug"]);

/**
 * Whether any field in this subtree stores a password.
 *
 * Capture strips password values wherever they appear, including inside a
 * group or repeater. The update path replaces a container wholesale, so
 * resubmitting one that held a password would overwrite the stored credential
 * with the stripped snapshot's blank.
 */
function containsPasswordField(fields: FieldConfig[]): boolean {
  return fields.some(field => {
    if (field.type === "password") return true;
    const nested = (field as { fields?: unknown }).fields;
    return Array.isArray(nested)
      ? containsPasswordField(nested as FieldConfig[])
      : false;
  });
}

/**
 * Every name the current schema accepts, including nested container names,
 * which are written as whole values by the update path.
 */
function currentFieldNames(fields: FieldConfig[]): Set<string> {
  const names = new Set<string>();
  for (const field of fields) {
    if (typeof field.name === "string" && field.name.length > 0) {
      names.add(field.name);
    }
  }
  return names;
}

/** What the current schema accepts, beyond its declared fields. */
export interface RestoreSchemaContext {
  /**
   * Whether the entity has draft/published status. Turning it off drops the
   * column, so a snapshot taken while it was on still carries `status`.
   */
  hasStatus: boolean;
}

export interface RestorePayloadResult {
  /** What to submit through the normal update path. */
  payload: Record<string, unknown>;
  /**
   * Snapshot keys that no longer exist in the schema. Reported rather than
   * silently dropped, so a restore can tell the editor what it could not bring
   * back instead of appearing to restore the document exactly.
   */
  droppedFields: string[];
}

/**
 * Build the update payload for restoring `snapshot`.
 *
 * Unknown keys are removed here because nothing downstream does it. Validation
 * walks the schema's *fields* rather than the payload's keys, so it ignores a
 * key the schema no longer has, and the update then builds its SET clause
 * straight from those keys — a snapshot taken before a field was renamed or
 * removed would reach the database naming a column that does not exist.
 */
export function buildRestorePayload(
  snapshot: unknown,
  fields: FieldConfig[],
  context: RestoreSchemaContext = { hasStatus: true }
): RestorePayloadResult {
  if (typeof snapshot !== "object" || snapshot === null) {
    return { payload: {}, droppedFields: [] };
  }

  const known = currentFieldNames(fields);
  const byName = new Map(
    fields
      .filter(
        (f): f is FieldConfig & { name: string } => typeof f.name === "string"
      )
      .map(f => [f.name, f])
  );

  const payload: Record<string, unknown> = {};
  const droppedFields: string[] = [];

  for (const [key, value] of Object.entries(snapshot)) {
    if (IMMUTABLE_FIELDS.has(key)) continue;

    // Turning draft/published off drops the column, so a snapshot from before
    // that still names it. Sending it would fail the whole restore.
    if (key === "status" && !context.hasStatus) {
      droppedFields.push(key);
      continue;
    }

    if (
      !known.has(key) &&
      !ALWAYS_WRITABLE_COLUMNS.has(key) &&
      key !== "status"
    ) {
      droppedFields.push(key);
      continue;
    }

    // A container whose subtree holds a password cannot be resubmitted: the
    // snapshot's copy has the password stripped, and the update replaces the
    // container whole, which would wipe the stored credential.
    const field = byName.get(key);
    const nested = field
      ? ((field as { fields?: unknown }).fields as FieldConfig[] | undefined)
      : undefined;
    if (Array.isArray(nested) && containsPasswordField(nested)) {
      droppedFields.push(key);
      continue;
    }

    payload[key] = value;
  }

  return { payload, droppedFields };
}

/**
 * Whether a version can be restored into a document that stores values per
 * locale.
 *
 * A localized snapshot holds exactly one locale's values, so restoring it
 * requires knowing which. Versions captured before the locale was recorded
 * cannot say, and writing them anyway would put one language's content into
 * whichever locale happens to be the default.
 */
export function canRestoreLocale(
  documentIsLocalized: boolean,
  versionLocale: string | null
): boolean {
  return !documentIsLocalized || versionLocale !== null;
}
