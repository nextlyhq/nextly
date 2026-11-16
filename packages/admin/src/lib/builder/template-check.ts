/**
 * The check a template meets when it is picked: every field it would add is
 * judged as a name typed into the Builder is, and against what the Builder
 * offers, so a template's mistake is shown on the template, before Create,
 * never met at the save.
 *
 * - Its name, by the save's own rule (`fieldNameProblem`): spelled as the
 *   Builder saves a name, not reserved at its place (built-in columns at any
 *   depth, the lifecycle's own names while drafts are on).
 * - Its siblings: no two clash by the server's sibling rule (the same name, in
 *   other letter case, or the same column), and none at the top level takes a
 *   name the entity's built-in fields hold, which the save would drop.
 * - Its type: one the kind's picker offers; a type no built-in field has is a
 *   plugin's, named as such while that plugin is not installed.
 * - Its place: a unique field only where a unique value can be kept, never in
 *   a group or repeating rows, whose values are one JSON value.
 * - Its settings: whatever the Builder's own preflight refuses before a save
 *   (`builderFieldErrors`: a dropdown with no option, a field-group field with
 *   no field group), the check a field typed into the Builder meets.
 *
 * Every rule a field breaks is named. A field left out is not judged, nor
 * anything inside it. What a template needs (a collection a link points at, a
 * field group a field uses) is read from the fields it would add.
 *
 * @module lib/builder/template-check
 */
import {
  builderColumnIsUnique,
  fieldNameProblem,
  siblingNameClash,
  type FieldNameProblem,
  type SiblingClashKind,
} from "nextly/config";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import { SYSTEM_FIELD_NAMES } from "./constants";
import { convertToBuilderField } from "./field-transformers";
import { builderFieldErrors } from "./field-validators";
import { BUILT_IN_FIELD_TYPES } from "./offered-field-types";
import type {
  SchemaTemplate,
  SchemaTemplateField,
  SchemaTemplateKind,
} from "./schema-templates";

/** Which rule a field breaks. */
export type TemplateRule =
  | "invalid-name"
  | "reserved-name"
  | "name-clash"
  | "type-not-offered"
  | "plugin-type-missing"
  | "unique-in-container"
  | "incomplete";

/** One rule one field breaks, said where the template is shown. */
export interface TemplateFailure {
  /** The field's place, names joined by dots: `call_to_action.label`. */
  path: string;
  label: string;
  rule: TemplateRule;
  message: string;
}

/** An entity a template needs to exist, read from one field. */
export interface TemplateNeed {
  kind: "collection" | "fieldGroup";
  /** Its address. */
  slug: string;
  /** The field needing it. */
  path: string;
}

/** What a template is checked against. */
export interface TemplateCheckContext {
  /** The types the kind's picker offers (`builderOfferedTypes`). */
  offeredTypes: ReadonlySet<string>;
  /**
   * The types the installed plugins contribute, offered here or not: what
   * tells a type the picker leaves out from one whose plugin is missing.
   */
  installedTypes?: ReadonlySet<string>;
  /** Whether the new entity's drafts are on; off when absent. */
  lifecycleEnabled?: boolean;
  /** The paths of the fields left out. */
  leftOut?: ReadonlySet<string>;
}

const CLASH_WORDS: Record<SiblingClashKind, string> = {
  "same-name": "the same name",
  "same-name-ignoring-case": "the same name in other letter case",
  "same-column": "a name that becomes the same column",
};

/** The fields that hold fields of their own. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(["group", "repeater"]);

/** A field placed: where it is, what it is called, and whether it is nested. */
interface Placed {
  field: SchemaTemplateField;
  path: string;
  label: string;
  nested: boolean;
}

/** Why a field's name is not one the save takes there, if it is not. */
function nameFailure(
  each: Placed,
  kind: SchemaTemplateKind,
  ctx: TemplateCheckContext
): TemplateFailure | null {
  const { field } = each;
  const problem: FieldNameProblem | null = fieldNameProblem(field.name, {
    surface: kind,
    nested: each.nested,
    lifecycleEnabled: ctx.lifecycleEnabled === true,
    // A field-group field or a link to several keeps its values elsewhere,
    // so no column carries its name.
    producesColumn: !(
      isFieldGroupFieldType(field.type) ||
      (field.type === "relationship" && field.hasMany === true)
    ),
  });
  if (!problem) return null;
  const invalid =
    problem.kind === "spelling" || problem.kind === "column-too-long";
  return {
    path: each.path,
    label: each.label,
    rule: invalid ? "invalid-name" : "reserved-name",
    message: invalid
      ? `${each.label}: "${field.name}" is not a name the Builder can save (lower-case letters, digits and underscores, starting with a letter, short enough for a column).`
      : `${each.label}: "${field.name}" is reserved here.`,
  };
}

/** The clashes among one level's fields, and with the entity's built-in fields at the top. */
function clashFailures(
  level: readonly Placed[],
  topLevel: boolean
): Map<Placed, TemplateFailure> {
  const found = new Map<Placed, TemplateFailure>();
  const clash = (each: Placed, other: string, kind: SiblingClashKind) => {
    if (found.has(each)) return;
    found.set(each, {
      path: each.path,
      label: each.label,
      rule: "name-clash",
      message: `${each.label} has ${CLASH_WORDS[kind]} as ${other} beside it.`,
    });
  };
  level.forEach((each, at) => {
    if (topLevel) {
      for (const builtIn of SYSTEM_FIELD_NAMES) {
        const kind = siblingNameClash(each.field.name, builtIn);
        if (kind) clash(each, `the built-in field ${builtIn}`, kind);
      }
    }
    for (const other of level.slice(at + 1)) {
      const kind = siblingNameClash(each.field.name, other.field.name);
      if (kind) {
        clash(each, other.label, kind);
        clash(other, each.label, kind);
      }
    }
  });
  return found;
}

/** Why a field's type is not one the Builder offers here, if it is not. */
function typeFailure(
  each: Placed,
  ctx: TemplateCheckContext
): TemplateFailure | null {
  const { type } = each.field;
  if (ctx.offeredTypes.has(type)) return null;
  const known =
    BUILT_IN_FIELD_TYPES.has(type) || (ctx.installedTypes?.has(type) ?? false);
  return {
    path: each.path,
    label: each.label,
    rule: known ? "type-not-offered" : "plugin-type-missing",
    message: known
      ? `${each.label} is a ${type} field, which the Builder does not offer here.`
      : `${each.label} is a ${type} field, from a plugin that is not installed.`,
  };
}

/** Why a field may not sit where it is, if it may not. */
function placeFailure(each: Placed): TemplateFailure | null {
  if (!each.nested || !builderColumnIsUnique(each.field)) return null;
  return {
    path: each.path,
    label: each.label,
    rule: "unique-in-container",
    message: `${each.label} is unique, and a group or repeating rows keep their values in one JSON value, which cannot be kept unique.`,
  };
}

/**
 * Why the Builder's own preflight would refuse the field, if it would: judged
 * on the field alone, its own fields judged in their turn. An empty name is
 * left to the name rule, which already names it.
 */
function preflightFailure(each: Placed): TemplateFailure | null {
  const { fields: _inside, options, ...rest } = each.field;
  const builderField = convertToBuilderField(
    { ...rest, options: options?.map(option => ({ ...option })) },
    each.path
  );
  const error = builderFieldErrors([builderField]).get(builderField.id);
  if (!error || error.kind === "unnamed") return null;
  return {
    path: each.path,
    label: each.label,
    rule: "incomplete",
    message: `${each.label}: ${error.message}.`,
  };
}

/** What one field needs to exist. */
function needOf(each: Placed): TemplateNeed | null {
  const { field } = each;
  if (field.type === "relationship" && field.relationTo) {
    return { kind: "collection", slug: field.relationTo, path: each.path };
  }
  if (isFieldGroupFieldType(field.type) && field.component) {
    return { kind: "fieldGroup", slug: field.component, path: each.path };
  }
  return null;
}

/** Each rule `template`'s fields break, and what they need. */
export function checkTemplate(
  template: SchemaTemplate,
  ctx: TemplateCheckContext
): { failures: TemplateFailure[]; needs: TemplateNeed[] } {
  const failures: TemplateFailure[] = [];
  const needs: TemplateNeed[] = [];
  const leftOut = ctx.leftOut ?? new Set<string>();
  const walk = (
    list: readonly SchemaTemplateField[],
    parentPath: string | null
  ): void => {
    const level: Placed[] = list
      .map(field => ({
        field,
        path: parentPath ? `${parentPath}.${field.name}` : field.name,
        label: field.label || field.name,
        nested: parentPath !== null,
      }))
      .filter(each => !leftOut.has(each.path));
    const clashes = clashFailures(level, parentPath === null);
    for (const each of level) {
      const found = [
        nameFailure(each, template.kind, ctx),
        clashes.get(each) ?? null,
        typeFailure(each, ctx),
        placeFailure(each),
        preflightFailure(each),
      ];
      for (const failure of found) if (failure) failures.push(failure);
      const need = needOf(each);
      if (need) needs.push(need);
      if (CONTAINER_TYPES.has(each.field.type) && each.field.fields) {
        walk(each.field.fields, each.path);
      }
    }
  };
  walk(template.fields, null);
  return { failures, needs };
}
