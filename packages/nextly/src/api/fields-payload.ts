/**
 * Shared validation for field payloads entering the schema surfaces.
 *
 * Every writer of collection/single/component field definitions — the
 * dispatcher preview/apply methods and the standalone schema routes —
 * validates with the SAME rules that gate the `ui-schema.json` mirror
 * (`uiSchemaFieldSchema`). One validator for both writers is what keeps
 * the DB and the committed manifest from ever disagreeing about what a
 * legal field is: a payload that applied to the DB but failed the mirror
 * write would silently diverge the git-facing schema from the database.
 *
 * Validation-only by design: the original payload is persisted, not the
 * parsed copy, so builder-specific passthrough keys survive untouched. That is
 * also why a plugin field type's own declaration checks run here against the
 * unparsed payload: the keys they read are the ones the parsed copy drops.
 */
import { z } from "zod";

import {
  fieldNameProblem,
  type FieldNameSurface,
  isCollectionOnlyFieldName,
} from "../domains/dynamic-collections/field-name-rule";
import { fieldProducesColumn } from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors/nextly-error";
import { uiSchemaFieldSchema } from "../schemas/_zod/ui-schema";
import { pluginFieldOptionIssues } from "../shared/lib/plugin-field-options";

import { nextlyValidationFromZod } from "./zod-to-nextly-error";

// Whether two fields clash is not judged here. A payload alone cannot say
// whether a pair of sibling fields is new or one the entity already holds,
// which keeps working, so each road asks the sibling rule
// (`domains/schema/sibling-fields`) with the stored fields beside the payload,
// and the manifest's entity validator leaves it to the same rule.
const fieldsArraySchema = z.array(uiSchemaFieldSchema);

/**
 * Run each plugin field type's own declaration checks over the payload.
 *
 * Deliberately against the ORIGINAL array rather than the parsed copy. The
 * manifest schema strips keys it does not declare, and a plugin type's options
 * are exactly that — but this module persists what it was given, not what it
 * parsed, so those options reach the database. Validating the parsed copy would
 * check a field with the options already removed and store the ones it never
 * saw.
 *
 * Exported for the writers that do NOT mirror into `ui-schema.json`: the direct
 * create/update dispatcher handlers persist to the registry and run DDL, and
 * each already enforces its own field-name and shape rules. Those rules are not
 * the manifest's — the config validator accepts camelCase names the manifest
 * schema rejects — so running the whole manifest schema there would refuse
 * declarations those APIs have always stored. The plugin rules are the only
 * ones genuinely missing from them.
 */
export function assertValidPluginFieldOptions(fields: unknown): void {
  if (!Array.isArray(fields)) return;
  const errors: Array<{ path: string; code: string; message: string }> = [];

  const walk = (list: unknown[], basePath: string): void => {
    list.forEach((field, index) => {
      if (field === null || typeof field !== "object") return;
      const at = basePath ? `${basePath}.${index}` : String(index);
      for (const issue of pluginFieldOptionIssues(field)) {
        errors.push({
          path: issue.path ? `${at}.${issue.path}` : at,
          code: "FIELD_TYPE_INVALID",
          message: issue.message,
        });
      }
      // Only the container types hold nested fields. A plugin declaration is
      // open-ended, so a custom type may carry its own `fields` option as
      // private configuration, and walking that would run OTHER types' rules
      // over data that is not a field list at all.
      const { type, fields: nested } = field as {
        type?: unknown;
        fields?: unknown;
      };
      if ((type === "repeater" || type === "group") && Array.isArray(nested)) {
        walk(nested, `${at}.fields`);
      }
    });
  };

  walk(fields, "");

  if (errors.length > 0) {
    throw NextlyError.validation({ errors });
  }
}

/**
 * Throw `NextlyError.validation` (with per-field paths) unless `fields`
 * satisfies the manifest field rules.
 *
 * @param opts.kind - Entity being validated. For `"collection"`, the owner
 *   column name (`created_by` / `createdBy`) is additionally reserved, since it
 *   only exists on collection tables. Singles and components have no owner
 *   column, so those names stay valid there.
 * @param opts.stored - The entity's fields as stored, for a change to one that
 *   exists: a name it already holds keeps working whatever its case
 *   (`assertBuilderFieldNames`). Absent, as for a new entity, every name is
 *   held to the Builder's own. `"under-lock"` leaves the names to the caller,
 *   which reads the stored fields only once it holds the schema lock and asks
 *   `assertBuilderFieldNames` there, before any write.
 * @param opts.lifecycleEnabled - Whether the collection's or Single's
 *   Draft/Published lifecycle is on once the save lands, so a new field may not
 *   take one of the lifecycle's own names.
 */
export function assertValidFieldsPayload(
  fields: unknown,
  opts: {
    kind?: "collection" | "single" | "component";
    stored?: readonly unknown[] | "under-lock";
    lifecycleEnabled?: boolean;
  } = {}
): void {
  const parsed = fieldsArraySchema.safeParse(fields);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }
  assertValidPluginFieldOptions(fields);
  if (opts.stored !== "under-lock") {
    assertBuilderFieldNames(fields, opts.stored ?? [], {
      surface: surfaceOf(opts.kind),
      lifecycleEnabled: opts.lifecycleEnabled,
    });
  }
  // Every name, kept ones included: a collection's own system column is never
  // a field of it, whenever the field was saved.
  if (opts.kind === "collection" && Array.isArray(fields)) {
    fields.forEach((field, index) => {
      const name = (field as { name?: unknown } | null)?.name;
      if (typeof name === "string" && isCollectionOnlyFieldName(name)) {
        throw NextlyError.validation({
          errors: [
            {
              path: `${index}.name`,
              code: "RESERVED",
              message: `field name '${name}' is reserved`,
            },
          ],
        });
      }
    });
  }
}

/** The name rule's surface for a payload's entity kind; absent stays absent. */
function surfaceOf(
  kind: "collection" | "single" | "component" | undefined
): FieldNameSurface | undefined {
  return kind === "component" ? "fieldGroup" : kind;
}

/**
 * The entity a payload's names are judged for: its kind and whether its
 * Draft/Published lifecycle is on. Unstated, only the rules every kind of
 * entity shares are asked.
 */
export interface FieldNamesEntity {
  surface?: FieldNameSurface;
  lifecycleEnabled?: boolean;
}

/** A field as its name, nested fields and storage are read here. */
interface FieldName {
  name?: unknown;
  fields?: unknown;
  type?: unknown;
  options?: unknown;
  virtual?: unknown;
}

/** The fields of a list read as `FieldName`s, skipping anything that is not one. */
function fieldNames(list: unknown): readonly FieldName[] {
  return Array.isArray(list)
    ? list.filter(
        (field): field is FieldName =>
          field !== null && typeof field === "object"
      )
    : [];
}

/**
 * Refuses a field, at any depth, whose name is new at its place (not one
 * `stored` already holds there) and breaks the Builder's name rule for that
 * place (`fieldNameProblem`): its spelling, a column longer than the database
 * keeps whole, a system column's name, or a name the entity's lifecycle owns.
 *
 * A name the entity already holds keeps working where it is stored. The
 * definition file takes a camelCase name a plugin or the API declared, and a
 * `status` field may predate the lifecycle being turned on; the admin sends
 * every field the entity has on each save, so refusing those would refuse
 * every later edit. A name the save creates, renames to, or moves to another
 * place is the Builder's, and is held to the whole rule.
 */
export function assertBuilderFieldNames(
  fields: unknown,
  stored: readonly unknown[],
  entity: FieldNamesEntity = {},
  path = ""
): void {
  const held = new Map<string, FieldName>();
  for (const field of fieldNames(stored)) {
    if (typeof field.name === "string") held.set(field.name, field);
  }
  fieldNames(fields).forEach((field, index) => {
    const at = `${path}${index}`;
    const kept =
      typeof field.name === "string" ? held.get(field.name) : undefined;
    const problem =
      typeof field.name === "string" && kept === undefined
        ? fieldNameProblem(field.name, {
            surface: entity.surface,
            nested: path !== "",
            lifecycleEnabled: entity.lifecycleEnabled,
            // Asked of the field by the one predicate that says whether it has a column.
            producesColumn: fieldProducesColumn(field),
          })
        : null;
    if (problem !== null) {
      throw NextlyError.validation({
        errors: [
          { path: `${at}.name`, code: problem.code, message: problem.message },
        ],
      });
    }
    if (Array.isArray(field.fields)) {
      assertBuilderFieldNames(
        field.fields,
        fieldNames(kept?.fields),
        entity,
        `${at}.fields.`
      );
    }
  });
}
