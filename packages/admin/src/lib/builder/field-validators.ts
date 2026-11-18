import { validationRulesForFieldType } from "nextly/field-catalog";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import {
  boundProblem,
  NUMERIC_BOUND_RULES,
} from "@admin/lib/validation-bounds";

import { brokenConditions } from "./condition-identity";

export interface FieldBuilderValidationResult {
  valid: boolean;
  errorMessage?: string;
}

/** What is wrong with a field, in the order a save reports them. */
type FieldErrorKind =
  | "unnamed"
  | "no-field-group"
  | "no-options"
  | "bad-option"
  | "no-target"
  | "empty-container"
  | "bad-bound"
  | "broken-condition";

/** One field's error: what kind it is, and what to tell the person. */
export interface BuilderFieldError {
  kind: FieldErrorKind;
  message: string;
}

/** The order a save names the kinds in: the first kind found is reported. */
const REPORT_ORDER: readonly FieldErrorKind[] = [
  "unnamed",
  "no-field-group",
  "no-options",
  "bad-option",
  "no-target",
  "empty-container",
  "bad-bound",
  "broken-condition",
];

/**
 * What is wrong with a select's or radio's options, as the save judges them: every option needs a
 * label and a value, and no two may share a value, which the stored value could not tell apart.
 * Values are compared exactly as stored. Null when the options are sound.
 */
function optionProblem(field: BuilderField): string | null {
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.some(option => !option.value)) {
    return `Field "${field.name}" has an option with no value`;
  }
  if (options.some(option => !option.label)) {
    return `Field "${field.name}" has an option with no label`;
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.value)) {
      return `Field "${field.name}" has two options with the value "${option.value}"`;
    }
    seen.add(option.value);
  }
  return null;
}

/**
 * Whether a relationship names a collection to link to, as the save requires: `relationTo`, one
 * or more, or the stored `options.target` a relationship saved the earlier way keeps
 * (`storedRelationOptions`). An upload needs none: it links to the media library.
 */
function linksSomewhere(field: BuilderField): boolean {
  const { relationTo } = field;
  if (typeof relationTo === "string" && relationTo.length > 0) return true;
  if (Array.isArray(relationTo) && relationTo.length > 0) return true;
  const target = field.storedRelationOptions?.target;
  return typeof target === "string" && target !== "";
}

/** One thing a named field's type needs: the error when the field lacks it, else null. */
type FieldCheck = (field: BuilderField) => BuilderFieldError | null;

/**
 * A field group field needs a field group chosen. Either spelling of the stored field type: a
 * migrated definition whose references were cleared must fail HERE, with the actionable message,
 * rather than at the API boundary after submission.
 */
const needsFieldGroup: FieldCheck = field => {
  if (!isFieldGroupFieldType(field.type)) return null;
  const refs = extractFieldGroupReferences(field);
  if (refs.single !== undefined || (refs.many?.length ?? 0) > 0) return null;
  return {
    kind: "no-field-group",
    message: `Field "${field.name}" must have a field group selected`,
  };
};

/** A select or radio needs options, each sound (`optionProblem`). */
const needsOptions: FieldCheck = field => {
  if (field.type !== "select" && field.type !== "radio") return null;
  if (!Array.isArray(field.options) || field.options.length === 0) {
    return {
      kind: "no-options",
      message: `Select/Radio field "${field.name}" must have at least one option`,
    };
  }
  const problem = optionProblem(field);
  return problem ? { kind: "bad-option", message: problem } : null;
};

/**
 * A relationship needs a collection to link to (`linksSomewhere`). A many-to-many it stores
 * (`storedRelationOptions.relationType`) needs exactly one: its links are kept in a table made for
 * one collection, so several picked would name none the save can keep them for.
 */
const needsTarget: FieldCheck = field => {
  if (field.type !== "relationship") return null;
  if (!linksSomewhere(field)) {
    return {
      kind: "no-target",
      message: `Relationship field "${field.name}" must link to a collection`,
    };
  }
  return field.storedRelationOptions?.relationType === "manyToMany" &&
    Array.isArray(field.relationTo) &&
    field.relationTo.length > 1
    ? {
        kind: "no-target",
        message: `Relationship field "${field.name}" keeps its links for one collection: pick only one`,
      }
    : null;
};

/** A group or repeater stores its values in the fields inside it, so it needs at least one. */
const needsInnerField: FieldCheck = field =>
  (field.type === "group" || field.type === "repeater") &&
  (!Array.isArray(field.fields) || field.fields.length === 0)
    ? {
        kind: "empty-container",
        message: `Field "${field.name}" must hold at least one field`,
      }
    : null;

/**
 * A field's numeric bounds must be keepable as they stand — `boundProblem`,
 * the rule the settings panel already says under each bound.
 *
 * The panel has no Apply — an edit is in the draft as soon as it is made — so
 * without this the panel's red words were only a warning the Save button
 * ignored: a max length of 0 was stored and read downstream as "no limit", a
 * min above its max outlived a refusal core makes only for lengths and
 * values, not rows. The message after the colon is the panel's own, so a held
 * row says what its bound already says.
 *
 * Asked only of the rules the field's TYPE offers
 * (`validationRulesForFieldType`, the same answer the Validation tab draws
 * its controls from): a stored bound the type does not offer — an icon's
 * length, a text field's rows — is not this save's to judge, and refusing it
 * would hold the save with a message about a control the panel never shows,
 * with no way to fix it there. A plugin-contributed type is answered by
 * core's fallback for a type with no declared primitive (only what every
 * field has), so this gate never strands one; its panel still says an
 * unsound bound inline.
 */
const needsSoundBounds: FieldCheck = field => {
  const validation = field.validation;
  if (validation === undefined) return null;
  const offered = validationRulesForFieldType(field.type);
  for (const rule of NUMERIC_BOUND_RULES) {
    if (!offered.includes(rule)) continue;
    const problem = boundProblem(rule, validation);
    if (problem) {
      return {
        kind: "bad-bound",
        message: `Field "${field.name}": ${problem}`,
      };
    }
  }
  return null;
};

/** A named field's checks, in the order of `REPORT_ORDER`. */
const FIELD_CHECKS: readonly FieldCheck[] = [
  needsFieldGroup,
  needsOptions,
  needsTarget,
  needsInnerField,
  needsSoundBounds,
];

/** The one error a field has, or null; a field reports its first. */
function errorOf(field: BuilderField): BuilderFieldError | null {
  if (!field.name) {
    return { kind: "unnamed", message: "All fields must have a name" };
  }
  for (const check of FIELD_CHECKS) {
    const error = check(field);
    if (error) return error;
  }
  return null;
}

/**
 * Every field's error, by field id, at every depth.
 *
 * The one place the Builder decides what is wrong with a field: the outline
 * marks each row from this map, and the save's refusal is read from it too, so
 * a row can never look fine while the save refuses it, or the reverse.
 *
 * `sources` is the whole field tree, built-in fields included: a condition may
 * read a built-in field, which `fields` (the user's own) leaves out, so a
 * condition is judged against the tree it is read in.
 */
export function builderFieldErrors(
  fields: readonly BuilderField[],
  sources: readonly BuilderField[] = fields
): Map<string, BuilderFieldError> {
  const errors = new Map<string, BuilderFieldError>();
  const broken = brokenConditions(sources);
  const walk = (list: readonly BuilderField[]): void => {
    for (const field of list) {
      const condition = broken.get(field.id);
      const error =
        errorOf(field) ??
        (condition
          ? { kind: "broken-condition" as const, message: condition.message }
          : null);
      if (error) errors.set(field.id, error);
      // Only a group or a repeater holds nested fields, as the save judges them: a plugin type may
      // keep a `fields` option of its own as private configuration, which is no field list.
      if (
        (field.type === "group" || field.type === "repeater") &&
        Array.isArray(field.fields)
      ) {
        walk(field.fields);
      }
    }
  };
  walk(fields);
  return errors;
}

/**
 * Run the schema-save preflight checks against the user-defined fields: every
 * field named, every field-group field pointing at a field group, every select
 * or radio given sound options, every relationship a collection, every group
 * or repeater a field inside it, every numeric bound keepable as it stands,
 * every condition reading a field it can. The refusal
 * names the first kind of error found, in that order, and the first field of
 * that kind.
 *
 * An empty field list is a legitimate state. The auto-create flow creates
 * schemas with empty user fields (system columns id/title/slug/timestamps/
 * status are auto-injected), so blocking save on `userFields.length === 0`
 * would prevent users from removing all custom fields and saving the result.
 */
export function validateBuilderFields(
  userFields: BuilderField[],
  sources: readonly BuilderField[] = userFields
): FieldBuilderValidationResult {
  const errors = [...builderFieldErrors(userFields, sources).values()];
  for (const kind of REPORT_ORDER) {
    const first = errors.find(error => error.kind === kind);
    if (first) return { valid: false, errorMessage: first.message };
  }
  return { valid: true };
}
