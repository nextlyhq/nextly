/**
 * Block props on the field system.
 *
 * A block declares its editable props as a record of field-type declarations
 * (`{ heading: { type: "text", maxLength: 80 } }`). This module turns that
 * record into ordinary `FieldConfig`s so one declaration drives everything
 * downstream: server-side value validation runs through the same
 * `validateEntryData` pass entries use, and later the inspector controls and
 * the generated manifest read the same configs. Nothing about block props gets
 * its own parallel validation rules.
 *
 * The input shape is described structurally rather than imported, so core does
 * not depend on the blocks engine to know what a prop declaration looks like.
 * A block definition's `props` record satisfies `BlockPropDeclaration` by
 * construction.
 *
 * A plugin-contributed field type may be declared as a block prop only when
 * its author listed the `"blocks"` surface, the same opt-in the form builder
 * requires for `"forms"`.
 *
 * Block props live inside a JSON document, never in their own column, so the
 * declarations here are checked for what the field system actually consumes
 * (types, bounds, choices, relation targets) and an unusable declaration
 * raises at conversion time rather than producing a config that silently
 * validates nothing.
 *
 * That JSON document is also why the reference-shaped types carry a `validate`
 * function. The entry validator applies no scalar rules to `richText`,
 * `upload`, `relationship`, and `json`, because an entry write normalizes and
 * referentially checks those values in later pipeline stages. A block prop
 * never enters those stages, so without a shape check here a malformed value
 * would reach the renderer unexamined.
 *
 * @module collections/fields/block-props
 */

import {
  getFieldType,
  isPluginFieldTypeOnSurface,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";
import type { ValidationPublicData } from "../../errors/public-data";
import { SLUG_PATTERN } from "../../shared/base-validator";
import { validateEntryData } from "../../shared/lib/entry-validation";

import type { BlockFieldCatalogType } from "./catalog";
import {
  BLOCK_FIELD_TYPES,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  isBlockFieldType,
} from "./catalog";
import type { FieldConfig, SelectOption } from "./types";

type ConversionIssue = ValidationPublicData["errors"][number];

/**
 * One prop declaration: a field type plus that type's options. Kept open so a
 * declaration written against the block API — where options vary by type —
 * satisfies it without a conversion step.
 */
export interface BlockPropDeclaration {
  type: string;
  [option: string]: unknown;
}

/**
 * The part of a block definition this module reads. A `BlockDefinition`
 * satisfies it structurally.
 */
export interface BlockPropsSource {
  /** The block's registered name; identifies the block in conversion errors. */
  name?: string;
  /** Editable props, keyed by prop name. */
  props?: Record<string, BlockPropDeclaration>;
  /** Prop names whose values are translatable. */
  localized?: readonly string[];
}

/**
 * Prop names double as JavaScript identifiers on the render side, so they are
 * held to identifier rules rather than the column-name rules that apply to
 * fields backed by a database column.
 */
const PROP_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * How deep structured props may nest. Conversion recurses through `repeater`
 * and `group` declarations, so a bound turns a cyclic or absurdly deep
 * declaration — trivial to produce by reusing one declaration object, and
 * unavoidable once declarations arrive from a manifest rather than hand-written
 * code — into a reported issue instead of a stack overflow.
 */
const MAX_PROP_NESTING_DEPTH = 5;

interface ConversionContext {
  blockName: string;
  localized: ReadonlySet<string>;
  issues: ConversionIssue[];
}

/**
 * Field-config conversion for one prop type. Returns `null` when the
 * declaration is unusable; the issue explaining why is already recorded.
 */
type PropBuilder = (
  name: string,
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext,
  depth: number
) => FieldConfig | null;

/**
 * Convert a block's prop declarations into field configs, in declaration
 * order.
 *
 * @throws NextlyError validation error listing every unusable declaration.
 */
export function blockPropsToFieldConfigs(
  source: BlockPropsSource
): FieldConfig[] {
  const ctx: ConversionContext = {
    blockName: source.name ?? "(unnamed block)",
    localized: new Set(source.localized ?? []),
    issues: [],
  };
  const configs = buildFieldConfigs(source.props, "", ctx, 0);
  if (ctx.issues.length > 0) {
    throw NextlyError.validation({
      errors: ctx.issues,
      logContext: { blockName: ctx.blockName },
    });
  }
  return configs;
}

/**
 * Validate a block's prop values against its declarations. Returns every
 * violation rather than the first, matching the entry validator it delegates
 * to, so an editor or an agent can repair a whole block in one pass.
 */
export async function validateBlockPropValues(
  values: Record<string, unknown>,
  source: BlockPropsSource
): Promise<ConversionIssue[]> {
  const fields = blockPropsToFieldConfigs(source);
  // Only the record's own keys are stored, so only they are validated. A
  // props object carrying a custom prototype would otherwise let an inherited
  // value satisfy a required prop while encoding writes nothing for it.
  const own = ownProperties(values);
  // Block props are always written whole: a stored node carries every prop it
  // has, so absent means unset rather than untouched, which is create mode.
  const issues = await validateEntryData(own, fields, { mode: "create" });
  collectSerializationIssues(fields, own, issues);
  collectEmptyListIssues(fields, own, "", issues);
  return issues;
}

/** A shallow copy carrying only a record's own enumerable keys. */
function ownProperties(
  values: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values));
}

/**
 * Report a prop value that cannot be written into the block document.
 *
 * Every prop ends up inside one JSON document, so serializability is a
 * property of the surface rather than of any one field type. Checking it once
 * per prop covers the types whose own rules look only at shape — a rich-text
 * envelope with a cyclic child is well formed by every structural measure and
 * still cannot be stored — and it keeps future prop types covered without each
 * having to remember the rule.
 */
function collectSerializationIssues(
  fields: readonly WalkableField[],
  values: Record<string, unknown>,
  issues: ConversionIssue[]
): void {
  for (const field of fields) {
    if (!field.name) continue;
    const value = ownValue(values, field.name);
    if (value === undefined) continue;
    // A prop that already failed a type rule does not need a second, vaguer
    // issue: the specific one describes the same defect better.
    if (alreadyReported(issues, field.name)) continue;
    const result = isSerializable(value, field.name);
    if (result !== true) {
      issues.push({
        path: field.name,
        code: "NOT_SERIALIZABLE",
        message: `${field.label ?? field.name} ${result}.`,
      });
    }
  }
  // A stored node may carry keys no current declaration covers — an older
  // prop kept through a migration, or an extra supplied by an API caller.
  // They are written into the same document, so they answer to the same rule.
  const declared = new Set(fields.map(field => field.name));
  for (const [name, value] of Object.entries(values)) {
    if (declared.has(name) || alreadyReported(issues, name)) continue;
    const result = isSerializable(value, name);
    if (result !== true) {
      issues.push({
        path: name,
        code: "NOT_SERIALIZABLE",
        message: `${name} ${result}.`,
      });
    }
  }
}

/** Reads only a value's own key, never an inherited Object.prototype member. */
function ownValue(values: Record<string, unknown>, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(values, name)
    ? values[name]
    : undefined;
}

/** Whether any recorded issue already points at this prop or inside it. */
function alreadyReported(
  issues: readonly ConversionIssue[],
  name: string
): boolean {
  return issues.some(
    issue =>
      issue.path === name ||
      issue.path.startsWith(`${name}.`) ||
      issue.path.startsWith(`${name}[`)
  );
}

/**
 * Report values the shared validator classifies as empty and therefore skips.
 *
 * It returns before any type rule runs — including a field's own `validate` —
 * for `null`, a blank string, and an empty array, so those are the shapes the
 * per-type checks never see. For an entry that is harmless, because the value
 * is on its way to a typed column that would reject it. A block prop is
 * stored as JSON exactly as given, so the same value reaches the renderer
 * contradicting its declaration.
 *
 * Three cases follow: a value whose JavaScript type the prop cannot hold at
 * all, an empty list where the prop holds one value or declares a minimum,
 * and a required list-shaped prop explicitly set to `[]`, which the shared
 * rules route past their required check in order to reach the bounds rules.
 */
function collectEmptyListIssues(
  fields: readonly WalkableField[],
  values: Record<string, unknown>,
  basePath: string,
  issues: ConversionIssue[]
): void {
  for (const field of fields) {
    if (!field.name) continue;
    const value = ownValue(values, field.name);
    if (value === undefined) continue;
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    if (typeof value === "string" && value.trim() === "") {
      if (!alreadyReported(issues, path) && !holdsText(field)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${field.label ?? field.name} must not be text.`,
        });
      }
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      // A scalar select or radio is inspected for arrays by the shared rules,
      // so its issue is already recorded and does not need repeating.
      if (alreadyReported(issues, path)) continue;
      if (!holdsList(field)) {
        issues.push({
          path,
          code: "INVALID_TYPE",
          message: `${field.label ?? field.name} must not be a list.`,
        });
        continue;
      }
      // The shared rules route a provided empty list past their required
      // check so it can reach the bounds rules, which leaves a required list
      // prop accepting no content at all.
      if (field.required === true) {
        issues.push({
          path,
          code: "REQUIRED",
          message: `${field.label ?? field.name} is required.`,
        });
        continue;
      }
      // Repeaters and chips reach their own bounds rules even when empty;
      // a hasMany scalar does not, so its minimum is enforced here.
      if (
        field.hasMany === true &&
        field.minRows !== undefined &&
        field.minRows > 0
      ) {
        issues.push({
          path,
          code: "TOO_FEW_ROWS",
          message: `${field.label ?? field.name} must have at least ${field.minRows} entries.`,
        });
      }
      continue;
    }
    const nested = field.fields;
    if (!nested) continue;
    if (field.type === "group" && isPlainObject(value)) {
      collectEmptyListIssues(nested, value, path, issues);
      continue;
    }
    if (field.type === "repeater" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (isPlainObject(row)) {
          collectEmptyListIssues(nested, row, `${path}[${index}]`, issues);
        }
      });
    }
  }
}

/**
 * Whether a field's value is a list. `json` counts because an array is a
 * legitimate JSON value, not a cardinality mistake.
 */
/**
 * Whether a field's value may be a string. A blank string reaching any other
 * prop contradicts its declared type: a number cannot be text, and an id that
 * is blank resolves to nothing.
 */
function holdsText(field: WalkableField): boolean {
  return (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "email" ||
    field.type === "code" ||
    field.type === "select" ||
    field.type === "radio" ||
    field.type === "date" ||
    // An array or a bare string are both legitimate JSON values.
    field.type === "json"
  );
}

function holdsList(field: WalkableField): boolean {
  if (field.type === "chips" || field.type === "repeater") return true;
  if (field.type === "json") return true;
  return field.hasMany === true;
}

/**
 * The part of a field config the empty-list walk reads. Nested fields inside a
 * group or repeater are typed permissively by their own configs, so the walk
 * describes what it needs rather than requiring the concrete union.
 */
interface WalkableField {
  name?: string;
  type: string;
  label?: string;
  required?: boolean;
  hasMany?: boolean;
  minRows?: number;
  fields?: readonly WalkableField[];
}

function buildFieldConfigs(
  props: Record<string, BlockPropDeclaration> | undefined,
  prefix: string,
  ctx: ConversionContext,
  depth: number
): FieldConfig[] {
  if (!props) return [];
  const configs: FieldConfig[] = [];
  for (const [name, declaration] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (!PROP_NAME_PATTERN.test(name)) {
      record(
        ctx,
        path,
        "INVALID_NAME",
        "Prop names must start with a letter, underscore, or dollar sign and contain only letters, digits, underscores, and dollar signs."
      );
      continue;
    }
    // A prop named after an Object.prototype member reads back as the
    // inherited function whenever the prop is absent, so an omitted optional
    // prop would look like a value of the wrong type to every consumer.
    if (name in Object.prototype) {
      record(
        ctx,
        path,
        "RESERVED_NAME",
        `"${name}" is a member of Object.prototype and cannot be a prop name.`
      );
      continue;
    }
    if (!isPlainObject(declaration)) {
      record(
        ctx,
        path,
        "INVALID_DECLARATION",
        "A prop declaration must be an object carrying at least a field type."
      );
      continue;
    }
    const resolved = resolvePropType(declaration.type);
    if (!resolved) {
      record(
        ctx,
        path,
        "UNKNOWN_FIELD_TYPE",
        `"${String(declaration.type)}" is not a field type a block prop can declare. Available types: ${BLOCK_FIELD_TYPES.join(", ")}.`
      );
      continue;
    }
    if (!rejectUnknownOptions(declaration, resolved, path, ctx)) continue;
    const config = BUILDERS[resolved](name, declaration, path, ctx, depth);
    if (config) configs.push(config);
  }
  return configs;
}

/**
 * The block field type a declaration is built as, or `null` when the type is
 * not available on the block-prop surface.
 *
 * A plugin-contributed type is admitted only when its author opted into the
 * `"blocks"` surface, the same gate the form builder applies for `"forms"`, so
 * a type never becomes a block prop where its author did not intend it.
 */
function resolvePropType(type: string): BlockFieldCatalogType | null {
  if (isBlockFieldType(type)) return type;
  if (!isPluginFieldTypeOnSurface(type, "blocks")) return null;
  const storage = getFieldType(type)?.storage;
  return storage ? STORAGE_PRIMITIVE_AS_FIELD_TYPE[storage] : null;
}

/**
 * The options each prop type accepts, beside its `type`.
 *
 * Anything else is refused rather than dropped. A silently ignored option is
 * the worst outcome available here: a declaration that reads as if it
 * constrains its values while validating nothing. That covers both misspelled
 * options and rule shapes this surface does not take — the nested
 * `validation: { ... }` object the Schema Builder stores, whose flat
 * equivalents are listed below, and a `validate` function, which a block
 * declaration cannot carry because it must serialize into the generated
 * manifest.
 */
const ALLOWED_OPTIONS: Readonly<
  Record<BlockFieldCatalogType, readonly string[]>
> = {
  text: [
    "label",
    "required",
    "minLength",
    "maxLength",
    "hasMany",
    "minRows",
    "maxRows",
  ],
  textarea: ["label", "required", "minLength", "maxLength"],
  richText: ["label", "required"],
  email: ["label", "required"],
  number: ["label", "required", "min", "max", "hasMany", "minRows", "maxRows"],
  code: ["label", "required"],
  date: ["label", "required"],
  select: ["label", "required", "options", "hasMany"],
  radio: ["label", "required", "options"],
  checkbox: ["label", "required"],
  json: ["label", "required"],
  chips: ["label", "required", "minChips", "maxChips"],
  upload: ["label", "required", "relationTo", "hasMany", "minRows", "maxRows"],
  relationship: [
    "label",
    "required",
    "relationTo",
    "hasMany",
    "minRows",
    "maxRows",
  ],
  repeater: ["label", "required", "fields", "minRows", "maxRows"],
  group: ["label", "required", "fields"],
};

/** Whether every option on a declaration is one its type accepts. */
function rejectUnknownOptions(
  declaration: BlockPropDeclaration,
  resolved: BlockFieldCatalogType,
  path: string,
  ctx: ConversionContext
): boolean {
  const allowed = ALLOWED_OPTIONS[resolved];
  let ok = true;
  for (const key of Object.keys(declaration)) {
    if (key === "type" || allowed.includes(key)) continue;
    ok = false;
    record(
      ctx,
      `${path}.${key}`,
      "UNKNOWN_OPTION",
      `A ${resolved} prop does not accept \`${key}\`. Accepted options: ${allowed.join(", ")}.`
    );
  }
  return ok;
}

/**
 * The plugin type a declaration named, when conversion resolved it to a
 * storage primitive. Carried on the config so an inspector can still dispatch
 * the plugin's own component instead of the primitive's built-in control.
 */
function pluginIdentity(
  type: string
): { custom: { pluginFieldType: string } } | undefined {
  return isBlockFieldType(type)
    ? undefined
    : { custom: { pluginFieldType: type } };
}

/**
 * The options every prop type carries. `defaultValue` is deliberately absent:
 * a block's defaults live in its `defaultProps`, applied by the engine when a
 * block is inserted, so duplicating them onto the field config would give one
 * value two sources.
 */
function base(
  name: string,
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): {
  name: string;
  label?: string;
  required?: boolean;
  localized?: boolean;
  custom?: { pluginFieldType: string };
} {
  return {
    name,
    ...pluginIdentity(declaration.type),
    label: optionalString(declaration, "label", path, ctx),
    required: optionalBoolean(declaration, "required", path, ctx),
    // A block declares its translatable props by top-level name, so the flag
    // is gated on the prop being top level: a nested field that happens to
    // share a localized prop's name is a different value.
    localized: path === name && ctx.localized.has(name) ? true : undefined,
  };
}

const BUILDERS: Readonly<Record<BlockFieldCatalogType, PropBuilder>> = {
  text: (name, declaration, path, ctx) => {
    const hasMany = optionalBoolean(declaration, "hasMany", path, ctx);
    const rows = rowBounds(declaration, path, ctx, hasMany);
    return {
      ...base(name, declaration, path, ctx),
      type: "text",
      ...lengthBounds(declaration, path, ctx),
      hasMany,
      ...rows,
      validate: listBoundsValidator(rows.minRows, rows.maxRows),
    };
  },
  textarea: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "textarea",
    ...lengthBounds(declaration, path, ctx),
  }),
  richText: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "richText",
    validate: isEditorContent,
  }),
  email: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "email",
  }),
  number: (name, declaration, path, ctx) => {
    const min = optionalNumber(declaration, "min", path, ctx);
    const max = optionalNumber(declaration, "max", path, ctx);
    const hasMany = optionalBoolean(declaration, "hasMany", path, ctx);
    const rows = rowBounds(declaration, path, ctx, hasMany);
    // A number prop is free to range below zero and to hold fractions, so
    // ordering is the only rule its bounds must satisfy.
    return {
      ...base(name, declaration, path, ctx),
      type: "number",
      ...orderedPair(min, max, "min", "max", path, ctx),
      hasMany,
      ...rows,
      validate: listBoundsValidator(rows.minRows, rows.maxRows),
    };
  },
  code: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "code",
  }),
  date: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "date",
  }),
  select: (name, declaration, path, ctx) => {
    const options = choiceOptions(declaration, path, ctx);
    if (!options) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "select",
      options,
      hasMany: optionalBoolean(declaration, "hasMany", path, ctx),
    };
  },
  radio: (name, declaration, path, ctx) => {
    const options = choiceOptions(declaration, path, ctx);
    if (!options) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "radio",
      options,
    };
  },
  checkbox: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "checkbox",
  }),
  json: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "json",
  }),
  chips: (name, declaration, path, ctx) => {
    const minChips = countOption(declaration, "minChips", path, ctx);
    const maxChips = countOption(declaration, "maxChips", path, ctx);
    return {
      ...base(name, declaration, path, ctx),
      type: "chips",
      ...orderedPair(minChips, maxChips, "minChips", "maxChips", path, ctx),
      validate: isTextList,
    };
  },
  upload: (name, declaration, path, ctx) => {
    const relationTo = relationTarget(declaration, path, ctx);
    if (!relationTo) return null;
    const hasMany = optionalBoolean(declaration, "hasMany", path, ctx);
    const rows = rowBounds(declaration, path, ctx, hasMany);
    return {
      ...base(name, declaration, path, ctx),
      type: "upload",
      relationTo,
      hasMany,
      ...rows,
      validate: allOf(
        referenceValidator(hasMany, relationTo),
        listBoundsValidator(rows.minRows, rows.maxRows)
      ),
    };
  },
  relationship: (name, declaration, path, ctx) => {
    const relationTo = relationTarget(declaration, path, ctx);
    if (!relationTo) return null;
    const hasMany = optionalBoolean(declaration, "hasMany", path, ctx);
    const rows = rowBounds(declaration, path, ctx, hasMany);
    return {
      ...base(name, declaration, path, ctx),
      type: "relationship",
      relationTo,
      hasMany,
      ...rows,
      validate: allOf(
        referenceValidator(hasMany, relationTo),
        listBoundsValidator(rows.minRows, rows.maxRows)
      ),
    };
  },
  repeater: (name, declaration, path, ctx, depth) => {
    const fields = nestedFields(declaration, path, ctx, depth);
    if (!fields) return null;
    const minRows = countOption(declaration, "minRows", path, ctx);
    const maxRows = countOption(declaration, "maxRows", path, ctx);
    return {
      ...base(name, declaration, path, ctx),
      type: "repeater",
      fields,
      ...orderedPair(minRows, maxRows, "minRows", "maxRows", path, ctx),
      validate: isJsonRecordList,
    };
  },
  group: (name, declaration, path, ctx, depth) => {
    const fields = nestedFields(declaration, path, ctx, depth);
    if (!fields) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "group",
      fields,
      validate: isJsonRecord,
    };
  },
};

/** Text length bounds, which must be ordered non-negative integers. */
function lengthBounds(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): { minLength?: number; maxLength?: number } {
  const minLength = countOption(declaration, "minLength", path, ctx);
  const maxLength = countOption(declaration, "maxLength", path, ctx);
  return orderedPair(minLength, maxLength, "minLength", "maxLength", path, ctx);
}

/**
 * Row bounds for a prop that holds several values. They are refused unless the
 * prop is a list: on a scalar they would constrain nothing, and a declaration
 * that advertises an unenforceable rule is worse than one that omits it.
 */
function rowBounds(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext,
  hasMany: boolean | undefined
): { minRows?: number; maxRows?: number } {
  const minRows = countOption(declaration, "minRows", path, ctx);
  const maxRows = countOption(declaration, "maxRows", path, ctx);
  if (hasMany !== true && (minRows !== undefined || maxRows !== undefined)) {
    record(
      ctx,
      path,
      "INVALID_OPTION",
      "`minRows` and `maxRows` apply only to a prop declaring `hasMany: true`."
    );
    return {};
  }
  return orderedPair(minRows, maxRows, "minRows", "maxRows", path, ctx);
}

/**
 * A lower/upper bound pair, dropped entirely when the lower exceeds the upper.
 * Such a pair admits no value at all, so it is a declaration defect rather
 * than a rule to enforce on every subsequent edit.
 */
function orderedPair<L extends string, U extends string>(
  lower: number | undefined,
  upper: number | undefined,
  lowerKey: L,
  upperKey: U,
  path: string,
  ctx: ConversionContext
): Partial<Record<L | U, number>> {
  if (lower !== undefined && upper !== undefined && lower > upper) {
    record(
      ctx,
      path,
      "INVALID_BOUNDS",
      `\`${lowerKey}\` must not be greater than \`${upperKey}\`.`
    );
    return {};
  }
  const pair: Partial<Record<L | U, number>> = {};
  if (lower !== undefined) pair[lowerKey] = lower;
  if (upper !== undefined) pair[upperKey] = upper;
  return pair;
}

/** The choice list `select` and `radio` cannot be built without. */
function choiceOptions(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): SelectOption[] | null {
  const raw = declaration.options;
  if (!Array.isArray(raw) || raw.length === 0) {
    record(
      ctx,
      path,
      "MISSING_OPTIONS",
      "A select or radio prop must declare a non-empty `options` array of `{ label, value }` entries."
    );
    return null;
  }
  const options: SelectOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (
      !isPlainObject(entry) ||
      typeof entry.label !== "string" ||
      typeof entry.value !== "string"
    ) {
      record(
        ctx,
        path,
        "INVALID_OPTIONS",
        "Every entry in `options` must be an object with string `label` and `value`."
      );
      return null;
    }
    // A blank stored value is indistinguishable from no value at all: the
    // shared rules trim before deciding emptiness, so an option declaring one
    // could never be selected, and a blank label leaves nothing to click.
    if (entry.label.trim().length === 0 || entry.value.trim().length === 0) {
      record(
        ctx,
        path,
        "INVALID_OPTIONS",
        "Every entry in `options` must have a `label` and `value` that are not empty or whitespace."
      );
      return null;
    }
    // Two labels sharing one stored value make the choice ambiguous in both
    // directions: the picker cannot tell which entry a stored value came from.
    if (seen.has(entry.value)) {
      record(
        ctx,
        path,
        "DUPLICATE_OPTION",
        `Two options declare the value "${entry.value}"; stored values must be unique.`
      );
      return null;
    }
    seen.add(entry.value);
    options.push({ label: entry.label, value: entry.value });
  }
  return options;
}

/**
 * The collection(s) an `upload` or `relationship` prop points at. Targets are
 * held to the canonical slug rule, so a target no collection could ever have
 * fails at conversion instead of producing a reference nothing can resolve.
 */
function relationTarget(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): string | string[] | null {
  const raw = declaration.relationTo;
  const isSlug = (entry: unknown): entry is string =>
    typeof entry === "string" && SLUG_PATTERN.test(entry);
  if (isSlug(raw)) return raw;
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isSlug)) {
    return [...raw];
  }
  record(
    ctx,
    path,
    "MISSING_RELATION_TARGET",
    "An upload or relationship prop must declare `relationTo` as a collection slug or a non-empty array of slugs, each starting with a lowercase letter and containing only lowercase letters, digits, underscores, and hyphens."
  );
  return null;
}

/** Nested prop declarations for `repeater` and `group`, keyed like the parent. */
function nestedFields(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext,
  depth: number
): FieldConfig[] | null {
  if (depth >= MAX_PROP_NESTING_DEPTH) {
    record(
      ctx,
      path,
      "NESTING_TOO_DEEP",
      `Block props may nest at most ${MAX_PROP_NESTING_DEPTH} levels deep.`
    );
    return null;
  }
  const raw = declaration.fields;
  if (!isPlainObject(raw) || Object.keys(raw).length === 0) {
    record(
      ctx,
      path,
      "MISSING_FIELDS",
      "A repeater or group prop must declare a non-empty `fields` record of nested prop declarations."
    );
    return null;
  }
  const nested = buildFieldConfigs(
    raw as Record<string, BlockPropDeclaration>,
    path,
    ctx,
    depth + 1
  );
  // An empty result means every nested declaration failed; its own issues are
  // already recorded, so the parent is dropped without adding noise.
  return nested.length > 0 ? nested : null;
}

/**
 * A count-shaped option: lengths, chip counts, and row counts are quantities,
 * so a fractional or negative value describes a rule no value can satisfy.
 */
function countOption(
  declaration: BlockPropDeclaration,
  key: string,
  path: string,
  ctx: ConversionContext
): number | undefined {
  const value = declaration[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  recordOptionType(ctx, path, key, "a non-negative integer");
  return undefined;
}

/**
 * Whether a value is shaped like editor content: a `root` node of type
 * `"root"` whose children are nodes. The admin hands the stored value to the
 * editor as-is, so a value that only resembles editor content fails there
 * instead of here unless the whole envelope is checked.
 *
 * The check is one level deep on purpose: node types are open (plugins add
 * their own), so validating the full tree would encode the editor's node
 * catalog into the field system.
 */
function isEditorContent(value: unknown): string | true {
  // Plain records, not merely objects: a class instance with the right keys
  // encodes to whatever its own `toJSON` decides, so the renderer would read
  // back something other than the envelope that was validated.
  if (!isPlainRecord(value) || definesOwnToJson(value)) {
    return "must be editor content";
  }
  const root = value.root;
  if (!isPlainRecord(root) || definesOwnToJson(root) || root.type !== "root") {
    return "must be editor content with a root node";
  }
  if (!Array.isArray(root.children)) {
    return "must be editor content whose root has a list of children";
  }
  return root.children.every(
    child =>
      isPlainRecord(child) &&
      !definesOwnToJson(child) &&
      typeof child.type === "string"
  )
    ? true
    : "must be editor content whose root children are nodes";
}

/** Whether every entry of a list value is text. */
function isTextList(value: unknown): string | true {
  // The shared rules report a non-list chips value, so this looks only at the
  // elements of a value that already has the right container shape.
  if (!Array.isArray(value)) return true;
  return value.every(entry => typeof entry === "string")
    ? true
    : "must contain only text entries";
}

/**
 * Whether a value is a document id. The canonical contracts type ids as
 * strings on both the single and polymorphic forms, so a number would reach
 * reference consumers in a shape they do not accept.
 */
function isDocumentId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Reference-shape check for one prop, honoring its cardinality and targets.
 *
 * The stored shape follows the target arity, the same rule that decides
 * whether the field needs JSON storage: a single-target relation stores a bare
 * id, because the collection is already fixed by the declaration, while a
 * multi-target relation stores `{ relationTo, value }` so the reference
 * carries the collection identity a bare id could not express.
 */
function referenceValidator(
  hasMany: boolean | undefined,
  relationTo: string | string[]
): (value: unknown) => string | true {
  const polymorphic = Array.isArray(relationTo);
  const expected = polymorphic
    ? `a { relationTo, value } reference to ${relationTo.join(" or ")}`
    : `an id of a ${relationTo} document`;
  const isOne = (entry: unknown): boolean =>
    polymorphic
      ? isPlainObject(entry) &&
        typeof entry.relationTo === "string" &&
        relationTo.includes(entry.relationTo) &&
        isDocumentId(entry.value)
      : isDocumentId(entry);
  return value => {
    if (hasMany) {
      if (!Array.isArray(value)) return "must be a list of references";
      return value.every(isOne) ? true : `must contain only ${expected}`;
    }
    if (Array.isArray(value)) return "must be a single reference, not a list";
    return isOne(value) ? true : `must be ${expected}`;
  };
}

/** Runs validators in order, reporting the first failure. */
function allOf(
  ...validators: Array<(value: unknown) => string | true>
): (value: unknown) => string | true {
  return value => {
    for (const validator of validators) {
      const result = validator(value);
      if (result !== true) return result;
    }
    return true;
  };
}

/**
 * Row-count check for a list-shaped scalar prop. The shared rules read row
 * bounds for repeaters and chips but not for a `hasMany` text or number field,
 * so without this the declaration would advertise a constraint nothing
 * enforces.
 */
function listBoundsValidator(
  minRows: number | undefined,
  maxRows: number | undefined
): (value: unknown) => string | true {
  return value => {
    if (!Array.isArray(value)) return true;
    if (minRows !== undefined && value.length < minRows) {
      return `must have at least ${minRows} entries`;
    }
    if (maxRows !== undefined && value.length > maxRows) {
      return `must have at most ${maxRows} entries`;
    }
    return true;
  };
}

/**
 * Whether a structured value is a plain JSON record. The shared rules accept
 * any non-array object, which lets a `Date` through — it becomes a string once
 * the document is encoded — and a cyclic object, which makes encoding throw.
 */
function isJsonRecord(value: unknown): string | true {
  // The shared rules own the container-shape check for these types, so a
  // non-object is already reported and repeating it would double the issue.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return true;
  }
  if (!isPlainRecord(value)) return "must be a plain object";
  // A record whose shape was just validated must be stored as that shape; an
  // own `toJSON` replaces it with something else entirely on encode.
  return definesOwnToJson(value) ? "must not define its own toJSON" : true;
}

/** Whether a value would substitute something else for itself on encode. */
function definesOwnToJson(value: object): boolean {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
}

/**
 * Whether a value is an object literal rather than a class instance. The
 * looser object check is not enough here: a `Date` or a `Map` passes it while
 * encoding turns the first into a string and the second into `{}`.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/** The same check applied to every row of a repeater value. */
function isJsonRecordList(value: unknown): string | true {
  if (!Array.isArray(value)) return true;
  for (const row of value) {
    // A malformed row is reported by the shared rules with its own index, so
    // only rows that passed that check are examined here.
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const result = isJsonRecord(row);
    if (result !== true) return `rows ${result}`;
  }
  return true;
}

/**
 * Whether a value survives being written to a block document. The document is
 * stored as JSON, so anything JSON cannot represent — a function, a symbol, a
 * bigint, a cycle — would be silently dropped or would throw on write.
 */
function isSerializable(value: unknown, key: string): string | true {
  try {
    // A prop that encodes to nothing is dropped from the document entirely
    // rather than stored wrongly, so the encoded result is inspected and not
    // just the absence of a throw.
    if (JSON.stringify(value) === undefined) {
      return "must not encode to nothing";
    }
  } catch {
    return "must be JSON-serializable";
  }
  return containsUnserializable(value, key)
    ? "must not contain functions, symbols, undefined, non-finite numbers, or values JSON would reshape"
    : true;
}

/**
 * Whether any part of a value is something `JSON.stringify` drops rather than
 * rejects. Stringify succeeds on these by omitting object keys, writing array
 * holes as `null`, and turning `NaN` and the infinities into `null`, so the
 * loss is invisible without an explicit walk.
 */
function containsUnserializable(value: unknown, key: string): boolean {
  const pending: Array<{ value: unknown; key: string }> = [{ value, key }];
  // Objects can name each other, and a `toJSON` may hand back a fresh object
  // each call, so the walk remembers what it has already accounted for.
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) continue;
    const current = entry.value;
    if (
      typeof current === "function" ||
      typeof current === "symbol" ||
      current === undefined ||
      (typeof current === "number" && !Number.isFinite(current))
    ) {
      return true;
    }
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    // An object that defines `toJSON` chooses its own stored form, which is
    // how a Date becomes an ISO string. What it produces is what gets stored,
    // so the walk follows that result rather than the value it was called on.
    // Arrays are consulted here too: one carrying a `toJSON` is encoded from
    // that result, not from its elements.
    const encoded = encodedForm(current, entry.key);
    if (encoded !== current) {
      pending.push({ value: encoded, key: entry.key });
      continue;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) =>
        pending.push({ value: item, key: String(index) })
      );
      continue;
    }
    // Anything else that is not a plain record is reshaped rather than
    // rejected: a Map or a Set encodes as `{}`, losing its contents with no
    // error to notice.
    if (!isPlainRecord(current)) return true;
    for (const [childKey, childValue] of Object.entries(current)) {
      pending.push({ value: childValue, key: childKey });
    }
  }
  return false;
}

/**
 * What an object encodes to, or the object itself when it has no say. A
 * `toJSON` that throws is reported as unserializable, which is what
 * `JSON.stringify` would do with it anyway.
 */
function encodedForm(value: object, key: string): unknown {
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON !== "function") return value;
  try {
    // Encoding passes the containing key, and a serializer is free to read
    // it, so the walk supplies the same one rather than calling bare.
    return (toJSON as (key: string) => unknown).call(value, key);
  } catch {
    return undefined;
  }
}

function optionalString(
  declaration: BlockPropDeclaration,
  key: string,
  path: string,
  ctx: ConversionContext
): string | undefined {
  const value = declaration[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  recordOptionType(ctx, path, key, "a string");
  return undefined;
}

function optionalNumber(
  declaration: BlockPropDeclaration,
  key: string,
  path: string,
  ctx: ConversionContext
): number | undefined {
  const value = declaration[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  recordOptionType(ctx, path, key, "a finite number");
  return undefined;
}

function optionalBoolean(
  declaration: BlockPropDeclaration,
  key: string,
  path: string,
  ctx: ConversionContext
): boolean | undefined {
  const value = declaration[key];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  recordOptionType(ctx, path, key, "a boolean");
  return undefined;
}

function recordOptionType(
  ctx: ConversionContext,
  path: string,
  key: string,
  expected: string
): void {
  record(
    ctx,
    `${path}.${key}`,
    "INVALID_OPTION",
    `\`${key}\` must be ${expected}.`
  );
}

function record(
  ctx: ConversionContext,
  path: string,
  code: string,
  message: string
): void {
  ctx.issues.push({ path, code, message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
