// Compares old vs new field definitions for the preview endpoint.
// Pure function, no drizzle-kit dependency. Just JSON comparison.
// Used by the Visual Schema Builder's "Save" flow to show what changed before applying.

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isFieldLocalized } from "../../i18n/classify-fields";

// A single field change: what the field was and what it became
export interface FieldChange {
  name: string;
  from: string;
  to: string;
  reason:
    | "type_changed"
    | "constraint_changed"
    | "options_changed"
    | "relation_changed";
}

// Result of comparing old and new field definitions
export interface FieldDiffResult {
  added: FieldDefinition[];
  removed: FieldDefinition[];
  changed: FieldChange[];
  unchanged: string[];
  hasChanges: boolean;
  hasDestructiveChanges: boolean;
  warnings: string[];
}

// Compare old and new field definitions and return a structured diff. `options.localized` says
// whether the entity is translated now, and `options.newLocalized` whether the save asks for it to
// be (the same when not given): a translated field's values live in the companion table, so a field
// moving in or out of translation, its own setting or its entity's, changes where they are stored.
export function computeFieldDiff(
  oldFields: FieldDefinition[],
  newFields: FieldDefinition[],
  options: { localized?: boolean; newLocalized?: boolean } = {}
): FieldDiffResult {
  const translated = {
    before: options.localized === true,
    after: (options.newLocalized ?? options.localized) === true,
  };
  const oldMap = new Map(oldFields.map(f => [f.name, f]));
  const newMap = new Map(newFields.map(f => [f.name, f]));

  const added: FieldDefinition[] = [];
  const removed: FieldDefinition[] = [];
  const changed: FieldChange[] = [];
  const unchanged: string[] = [];
  const warnings: string[] = [];

  // Check for added and changed fields
  for (const [name, newField] of newMap) {
    const oldField = oldMap.get(name);
    if (!oldField) {
      added.push(newField);
    } else if (hasFieldChanged(oldField, newField, translated)) {
      changed.push({
        name,
        from: oldField.type,
        to: newField.type,
        reason: getChangeReason(oldField, newField),
      });
    } else {
      unchanged.push(name);
    }
  }

  // Check for removed fields
  for (const [name, oldField] of oldMap) {
    if (!newMap.has(name)) {
      removed.push(oldField);
    }
  }

  // Generate warnings for destructive changes
  for (const field of removed) {
    warnings.push(
      `Removing field '${field.name}' will drop the column and its data permanently.`
    );
  }
  for (const change of changed) {
    if (change.from !== change.to) {
      warnings.push(
        `Changing field '${change.name}' type from '${change.from}' to '${change.to}' may cause data loss.`
      );
    }
  }

  const hasChanges =
    added.length > 0 || removed.length > 0 || changed.length > 0;
  const hasDestructiveChanges = removed.length > 0 || changed.length > 0;

  return {
    added,
    removed,
    changed,
    unchanged,
    hasChanges,
    hasDestructiveChanges,
    warnings,
  };
}

// Determine why a field changed (for classification by SchemaChangeService)
function getChangeReason(
  oldField: FieldDefinition,
  newField: FieldDefinition
):
  | "type_changed"
  | "constraint_changed"
  | "options_changed"
  | "relation_changed" {
  if (oldField.type !== newField.type) return "type_changed";
  if (isSet(oldField.required) !== isSet(newField.required))
    return "constraint_changed";
  if (
    oldField.relationTo !== newField.relationTo ||
    isSet(oldField.hasMany) !== isSet(newField.hasMany)
  )
    return "relation_changed";
  return "options_changed";
}

// Check if a field's definition has changed (type, required, options, where it is stored, etc.)
function hasFieldChanged(
  oldField: FieldDefinition,
  newField: FieldDefinition,
  translated: { before: boolean; after: boolean }
): boolean {
  if (oldField.type !== newField.type) return true;
  // Read as resolved, not as stored: a field with no setting takes its type's default, so the
  // Builder stating that same default moves nothing, while stating the other moves the values. The
  // old field is judged where its entity is translated now, the new one where the save asks.
  if (
    isFieldLocalized(oldField, translated.before) !==
    isFieldLocalized(newField, translated.after)
  )
    return true;
  if (isSet(oldField.required) !== isSet(newField.required)) return true;
  if (isSet(oldField.unique) !== isSet(newField.unique)) return true;

  // Compare field options for select/radio fields
  if (
    JSON.stringify(oldField.fieldOptions) !==
    JSON.stringify(newField.fieldOptions)
  ) {
    return true;
  }

  // Compare relationship config
  if (oldField.relationTo !== newField.relationTo) return true;
  if (isSet(oldField.hasMany) !== isSet(newField.hasMany)) return true;

  return false;
}

// Whether a yes-or-no setting is on. A field made through the REST API, the Direct API or code may
// store no `required`, `unique` or `hasMany` at all, while the Builder always sends each as a
// boolean, so a missing setting is read as off: compared as stored, every Builder save of such a
// field read as a change, even one that only relabelled it.
function isSet(value: boolean | undefined): boolean {
  return value === true;
}
