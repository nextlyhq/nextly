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
  // Block props are always written whole: a stored node carries every prop it
  // has, so absent means unset rather than untouched, which is create mode.
  return validateEntryData(values, fields, { mode: "create" });
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
  upload: ["label", "required", "relationTo", "hasMany"],
  relationship: ["label", "required", "relationTo", "hasMany"],
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
    return {
      ...base(name, declaration, path, ctx),
      type: "text",
      ...lengthBounds(declaration, path, ctx),
      hasMany,
      ...rowBounds(declaration, path, ctx),
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
    // A number prop is free to range below zero and to hold fractions, so
    // ordering is the only rule its bounds must satisfy.
    return {
      ...base(name, declaration, path, ctx),
      type: "number",
      ...orderedPair(min, max, "min", "max", path, ctx),
      hasMany,
      ...rowBounds(declaration, path, ctx),
      validate: finiteValidator(hasMany),
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
    validate: isSerializable,
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
    return {
      ...base(name, declaration, path, ctx),
      type: "upload",
      relationTo,
      hasMany,
      validate: referenceValidator(hasMany, relationTo),
    };
  },
  relationship: (name, declaration, path, ctx) => {
    const relationTo = relationTarget(declaration, path, ctx);
    if (!relationTo) return null;
    const hasMany = optionalBoolean(declaration, "hasMany", path, ctx);
    return {
      ...base(name, declaration, path, ctx),
      type: "relationship",
      relationTo,
      hasMany,
      validate: referenceValidator(hasMany, relationTo),
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
    };
  },
  group: (name, declaration, path, ctx, depth) => {
    const fields = nestedFields(declaration, path, ctx, depth);
    if (!fields) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "group",
      fields,
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

/** Row bounds for the prop types that hold a list of values. */
function rowBounds(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): { minRows?: number; maxRows?: number } {
  const minRows = countOption(declaration, "minRows", path, ctx);
  const maxRows = countOption(declaration, "maxRows", path, ctx);
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
    options.push({ label: entry.label, value: entry.value });
  }
  return options;
}

/** The collection(s) an `upload` or `relationship` prop points at. */
function relationTarget(
  declaration: BlockPropDeclaration,
  path: string,
  ctx: ConversionContext
): string | string[] | null {
  const raw = declaration.relationTo;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every(entry => typeof entry === "string" && entry.length > 0)
  ) {
    return [...raw];
  }
  record(
    ctx,
    path,
    "MISSING_RELATION_TARGET",
    "An upload or relationship prop must declare `relationTo` as a collection slug or a non-empty array of slugs."
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
  if (!isPlainObject(value)) return "must be editor content";
  const root = value.root;
  if (!isPlainObject(root) || root.type !== "root") {
    return "must be editor content with a root node";
  }
  if (!Array.isArray(root.children)) {
    return "must be editor content whose root has a list of children";
  }
  return root.children.every(
    child => isPlainObject(child) && typeof child.type === "string"
  )
    ? true
    : "must be editor content whose root children are nodes";
}

/** Whether every entry of a list value is text. */
function isTextList(value: unknown): string | true {
  if (!Array.isArray(value)) return "must be a list";
  return value.every(entry => typeof entry === "string")
    ? true
    : "must contain only text entries";
}

/**
 * Finite-value check for a number prop, honoring its cardinality. The shared
 * number rules reject `NaN` but accept the infinities, which JSON writes as
 * `null` — so an accepted value would not survive being stored.
 */
function finiteValidator(
  hasMany: boolean | undefined
): (value: unknown) => string | true {
  const finite = (entry: unknown) =>
    typeof entry === "number" && Number.isFinite(entry);
  return value => {
    if (!hasMany) {
      return finite(value) ? true : "must be a finite number";
    }
    if (!Array.isArray(value)) return "must be a list of numbers";
    return value.every(finite) ? true : "must contain only finite numbers";
  };
}

/**
 * Whether a value is a stored reference to one of `targets`: an id, or the
 * polymorphic `{ relationTo, value }` pair a multi-collection relation stores.
 * A polymorphic reference naming a collection the prop does not relate to is
 * rejected, since nothing downstream would resolve it.
 */
function isReference(value: unknown, targets: readonly string[]): boolean {
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isPlainObject(value)) return false;
  return (
    typeof value.relationTo === "string" &&
    targets.includes(value.relationTo) &&
    (typeof value.value === "string" || typeof value.value === "number")
  );
}

/** Reference-shape check for one prop, honoring its cardinality and targets. */
function referenceValidator(
  hasMany: boolean | undefined,
  relationTo: string | string[]
): (value: unknown) => string | true {
  const targets = Array.isArray(relationTo) ? relationTo : [relationTo];
  const expected = `an id or a { relationTo, value } reference to ${targets.join(" or ")}`;
  return value => {
    if (hasMany) {
      if (!Array.isArray(value)) return "must be a list of references";
      return value.every(entry => isReference(entry, targets))
        ? true
        : `must contain only ${expected}`;
    }
    if (Array.isArray(value)) return "must be a single reference, not a list";
    return isReference(value, targets) ? true : `must be ${expected}`;
  };
}

/**
 * Whether a value survives being written to a block document. The document is
 * stored as JSON, so anything JSON cannot represent — a function, a symbol, a
 * bigint, a cycle — would be silently dropped or would throw on write.
 */
function isSerializable(value: unknown): string | true {
  try {
    JSON.stringify(value);
  } catch {
    return "must be JSON-serializable";
  }
  return containsUnserializable(value)
    ? "must not contain functions, symbols, undefined, or non-finite numbers"
    : true;
}

/**
 * Whether any part of a value is something `JSON.stringify` drops rather than
 * rejects. Stringify succeeds on these by omitting object keys, writing array
 * holes as `null`, and turning `NaN` and the infinities into `null`, so the
 * loss is invisible without an explicit walk.
 */
function containsUnserializable(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      typeof current === "function" ||
      typeof current === "symbol" ||
      current === undefined ||
      (typeof current === "number" && !Number.isFinite(current))
    ) {
      return true;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (isPlainObject(current)) pending.push(...Object.values(current));
  }
  return false;
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
