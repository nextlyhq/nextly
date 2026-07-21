/**
 * Turning a stored snapshot back into something the normal update path accepts.
 *
 * Restore deliberately writes through the same update a human edit uses, so
 * validation, hooks, component and many-to-many writes, events and the outbox
 * all run identically. That leaves one job here: decide what of a snapshot may
 * be resubmitted.
 *
 * The decision is entirely schema-driven, and the schema is more layered than a
 * flat field list suggests — a presentational group's children sit at the
 * document's top level, a container's children live inside its stored value,
 * and a component names its child schema by slug rather than carrying it. Each
 * has to be resolved, or the filter passes through keys the table no longer has
 * or strips keys it still does.
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

/** What the current schema accepts, beyond its declared fields. */
export interface RestoreSchemaContext {
  /**
   * Whether the entity has draft/published status. Turning it off drops the
   * column, so a snapshot taken while it was on still carries `status`.
   */
  hasStatus: boolean;
  /**
   * Whether the entity has a `slug` column. It is synthesized for ordinary
   * collections, but a plugin collection has one only when it declares the
   * field, so it cannot be assumed.
   */
  hasSlug: boolean;
  /** Whether the entity has a `title` column, on the same terms as `slug`. */
  hasTitle: boolean;
  /**
   * Child fields for each component slug the schema references. A component
   * field names its schema rather than carrying it, so without these the walk
   * cannot see inside one.
   */
  componentFields?: Map<string, FieldConfig[]>;
}

export interface RestorePayloadResult {
  /** What to submit through the normal update path. */
  payload: Record<string, unknown>;
  /**
   * Snapshot keys that cannot be applied to the current schema, whether because
   * the field is gone or because resubmitting it would destroy something. Named
   * rather than silently dropped, so a restore reports what it could not bring
   * back instead of appearing to restore the document exactly.
   */
  droppedFields: string[];
}

/** A field's declared children, when it carries them inline. */
function inlineChildren(field: FieldConfig): FieldConfig[] | undefined {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : undefined;
}

/** The component slugs a field references, which name its child schema. */
function componentSlugs(field: FieldConfig): string[] {
  const one = (field as { component?: unknown }).component;
  const many = (field as { components?: unknown }).components;
  const slugs: string[] = [];
  if (typeof one === "string") slugs.push(one);
  if (Array.isArray(many)) {
    for (const slug of many) if (typeof slug === "string") slugs.push(slug);
  }
  return slugs;
}

/** Component slugs a field currently permits, or null when it permits any. */
function allowedComponentSlugs(field: FieldConfig): Set<string> | null {
  const slugs = componentSlugs(field);
  return slugs.length > 0 ? new Set(slugs) : null;
}

/** A field's children, wherever the schema keeps them. */
function childrenOf(
  field: FieldConfig,
  componentFields?: Map<string, FieldConfig[]>
): FieldConfig[] {
  const inline = inlineChildren(field);
  if (inline) return inline;

  const resolved: FieldConfig[] = [];
  for (const slug of componentSlugs(field)) {
    const fields = componentFields?.get(slug);
    if (fields) resolved.push(...fields);
  }
  return resolved;
}

/**
 * Whether anything in this subtree stores a password.
 *
 * Capture strips password values wherever they appear, so any value holding one
 * comes back incomplete. A field that is a password *now* counts too: it may
 * not have been when the snapshot was taken, and a text field converted later
 * leaves a readable value that restoring would hash over the live credential.
 */
function containsPasswordField(
  fields: FieldConfig[],
  componentFields?: Map<string, FieldConfig[]>,
  seen: Set<string> = new Set()
): boolean {
  return fields.some(field => {
    if (field.type === "password") return true;

    // A component can reference itself through a descendant, so a slug already
    // walked is not followed again.
    const slugs = componentSlugs(field);
    if (slugs.length > 0 && slugs.every(slug => seen.has(slug))) return false;
    for (const slug of slugs) seen.add(slug);

    const children = childrenOf(field, componentFields);
    return children.length > 0
      ? containsPasswordField(children, componentFields, seen)
      : false;
  });
}

/**
 * Fields addressable at the document's top level.
 *
 * A group with no name is presentational: it exists to lay fields out, and its
 * children are stored at this level rather than under the group. Treating it as
 * one key would drop every field inside it as unknown.
 */
function topLevelFields(fields: FieldConfig[]): Map<string, FieldConfig> {
  const byName = new Map<string, FieldConfig>();

  const walk = (list: FieldConfig[]): void => {
    for (const field of list) {
      if (typeof field.name === "string" && field.name.length > 0) {
        byName.set(field.name, field);
        continue;
      }

      // Presentational groups nest, so flattening one level would leave a
      // grandchild's key looking like a field the schema no longer has.
      if (field.type === "group") walk(inlineChildren(field) ?? []);
    }
  };

  walk(fields);
  return byName;
}

/**
 * Remove keys the current schema no longer declares from a container's stored
 * value, recursively.
 *
 * The update writes a container as one JSON value, and validation walks the
 * schema's fields rather than the value's keys — so a key removed from the
 * schema is neither rejected nor stripped. It would be written back into the
 * column and served again as though it were still part of the document.
 */
function pruneContainerValue(
  value: unknown,
  fields: FieldConfig[],
  componentFields: Map<string, FieldConfig[]> | undefined,
  removed: string[],
  path: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((row, i) =>
      pruneContainerValue(
        row,
        fields,
        componentFields,
        removed,
        `${path}[${i}]`
      )
    );
  }

  if (typeof value !== "object" || value === null) return value;

  const known = topLevelFields(fields);
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    // Row metadata rather than schema fields, and both are needed to write the
    // value back: the type discriminator selects the component, and the id lets
    // the save path update the existing row. Dropping the id would make a
    // restore delete and reinsert instances, taking their per-locale companion
    // rows and any other row-scoped state with them.
    if (key === "_componentType" || key === "id") {
      out[key] = child;
      continue;
    }

    const field = known.get(key);
    if (!field) {
      removed.push(`${path}.${key}`);
      continue;
    }

    const grandchildren = childrenOf(field, componentFields);
    out[key] =
      grandchildren.length > 0
        ? pruneContainerValue(
            child,
            grandchildren,
            componentFields,
            removed,
            `${path}.${key}`
          )
        : child;
  }

  return out;
}

/**
 * Split a component value into the instances the schema still permits and the
 * ones it does not.
 *
 * Returns `kept: null` when nothing survives, so the caller drops the field
 * entirely rather than submitting an empty set — which the save path would read
 * as "remove everything".
 */
function partitionAllowedInstances(
  value: unknown,
  allowed: Set<string> | null,
  path: string
): { kept: unknown; rejected: string[] } {
  if (allowed === null) return { kept: value, rejected: [] };

  const typeOf = (row: unknown): string | undefined =>
    typeof row === "object" && row !== null
      ? (row as { _componentType?: string })._componentType
      : undefined;

  if (Array.isArray(value)) {
    const rejected: string[] = [];
    const kept = value.filter((row, i) => {
      const type = typeOf(row);
      if (type === undefined || allowed.has(type)) return true;
      rejected.push(`${path}[${i}] (${type})`);
      return false;
    });
    return kept.length > 0 ? { kept, rejected } : { kept: null, rejected };
  }

  const type = typeOf(value);
  if (type !== undefined && !allowed.has(type)) {
    return { kept: null, rejected: [`${path} (${type})`] };
  }
  return { kept: value, rejected: [] };
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
  context: RestoreSchemaContext = {
    hasStatus: true,
    hasSlug: true,
    hasTitle: true,
  }
): RestorePayloadResult {
  if (typeof snapshot !== "object" || snapshot === null) {
    return { payload: {}, droppedFields: [] };
  }

  const known = topLevelFields(fields);
  const { componentFields } = context;

  /** System columns that exist only when the entity actually has them. */
  const systemColumns = new Map<string, boolean>([
    ["status", context.hasStatus],
    ["slug", context.hasSlug],
    ["title", context.hasTitle],
  ]);

  const payload: Record<string, unknown> = {};
  const droppedFields: string[] = [];

  for (const [key, value] of Object.entries(snapshot)) {
    if (IMMUTABLE_FIELDS.has(key)) continue;

    const field = known.get(key);

    if (!field) {
      // A system column exists only when the entity has it; naming one it does
      // not have would fail the whole restore in the raw SET clause.
      const systemColumnExists = systemColumns.get(key);
      if (systemColumnExists === true) {
        payload[key] = value;
      } else {
        droppedFields.push(key);
      }
      continue;
    }

    // Nothing that stores a password is resubmitted, at any depth: the
    // snapshot's copy has it stripped, and the update replaces a container
    // whole, which would wipe the stored credential.
    if (containsPasswordField([field], componentFields)) {
      droppedFields.push(key);
      continue;
    }

    const children = childrenOf(field, componentFields);
    if (children.length > 0) {
      const removed: string[] = [];

      // A dynamic zone's allowed component list can change. The save path skips
      // an instance whose type is no longer allowed and then deletes the live
      // instances that were not in the incoming set — so resubmitting a
      // snapshot of only-removed types would clear the field rather than
      // leaving it alone.
      const allowed = allowedComponentSlugs(field);
      const { kept, rejected } = partitionAllowedInstances(value, allowed, key);
      droppedFields.push(...rejected);

      if (kept === null) {
        droppedFields.push(key);
        continue;
      }

      payload[key] = pruneContainerValue(
        kept,
        children,
        componentFields,
        removed,
        key
      );
      droppedFields.push(...removed);
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
