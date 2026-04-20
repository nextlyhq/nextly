// Compares old vs new field definitions for the preview endpoint.
// Pure function, no drizzle-kit dependency. Just JSON comparison.
// Used by the visual builder's "Save" flow to show what changed before applying.

import type { FieldDefinition } from "../../../schemas/dynamic-collections";

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

// Compare old and new field definitions and return a structured diff
export function computeFieldDiff(
  oldFields: FieldDefinition[],
  newFields: FieldDefinition[]
): FieldDiffResult {
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
    } else if (hasFieldChanged(oldField, newField)) {
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
  if (oldField.required !== newField.required) return "constraint_changed";
  if (
    oldField.relationTo !== newField.relationTo ||
    oldField.hasMany !== newField.hasMany
  )
    return "relation_changed";
  return "options_changed";
}

// Check if a field's definition has changed (type, required, options, etc.)
function hasFieldChanged(
  oldField: FieldDefinition,
  newField: FieldDefinition
): boolean {
  if (oldField.type !== newField.type) return true;
  if (oldField.required !== newField.required) return true;
  if (oldField.unique !== newField.unique) return true;

  // Compare field options for select/radio fields
  if (
    JSON.stringify(oldField.fieldOptions) !==
    JSON.stringify(newField.fieldOptions)
  ) {
    return true;
  }

  // Compare relationship config
  if (oldField.relationTo !== newField.relationTo) return true;
  if (oldField.hasMany !== newField.hasMany) return true;

  return false;
}
