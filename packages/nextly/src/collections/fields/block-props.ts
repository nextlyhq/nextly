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
 * @module collections/fields/block-props
 */

import {
  getFieldType,
  isPluginFieldTypeOnSurface,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";
import type { ValidationPublicData } from "../../errors/public-data";
import type { PluginFieldType } from "../../plugins/contributions";
import { validateEntryData } from "../../shared/lib/entry-validation";

import type { BlockFieldCatalogType } from "./catalog";
import { BLOCK_FIELD_TYPES, isBlockFieldType } from "./catalog";
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
  ctx: ConversionContext
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
  const configs = buildFieldConfigs(source.props, "", ctx);
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
  ctx: ConversionContext
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
    const config = BUILDERS[resolved](name, declaration, path, ctx);
    if (config) configs.push(config);
  }
  return configs;
}

/**
 * The block field type a plugin field type's storage primitive validates as.
 * A plugin type persists as one of the primitives, so its values are checked
 * by that primitive's rules while its own admin component renders it.
 */
const PLUGIN_STORAGE_AS_PROP_TYPE: Readonly<
  Record<PluginFieldType["storage"], BlockFieldCatalogType>
> = {
  text: "text",
  longText: "textarea",
  boolean: "checkbox",
  number: "number",
  timestamp: "date",
  json: "json",
};

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
  return storage ? PLUGIN_STORAGE_AS_PROP_TYPE[storage] : null;
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
): { name: string; label?: string; required?: boolean; localized?: boolean } {
  return {
    name,
    label: optionalString(declaration, "label", path, ctx),
    required: optionalBoolean(declaration, "required", path, ctx),
    // A block declares its translatable props by top-level name, so the flag
    // is gated on the prop being top level: a nested field that happens to
    // share a localized prop's name is a different value.
    localized: path === name && ctx.localized.has(name) ? true : undefined,
  };
}

const BUILDERS: Readonly<Record<BlockFieldCatalogType, PropBuilder>> = {
  text: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "text",
    minLength: optionalNumber(declaration, "minLength", path, ctx),
    maxLength: optionalNumber(declaration, "maxLength", path, ctx),
  }),
  textarea: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "textarea",
    minLength: optionalNumber(declaration, "minLength", path, ctx),
    maxLength: optionalNumber(declaration, "maxLength", path, ctx),
  }),
  richText: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "richText",
  }),
  email: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "email",
  }),
  number: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "number",
    min: optionalNumber(declaration, "min", path, ctx),
    max: optionalNumber(declaration, "max", path, ctx),
  }),
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
  chips: (name, declaration, path, ctx) => ({
    ...base(name, declaration, path, ctx),
    type: "chips",
    minChips: optionalNumber(declaration, "minChips", path, ctx),
    maxChips: optionalNumber(declaration, "maxChips", path, ctx),
  }),
  upload: (name, declaration, path, ctx) => {
    const relationTo = relationTarget(declaration, path, ctx);
    if (!relationTo) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "upload",
      relationTo,
      hasMany: optionalBoolean(declaration, "hasMany", path, ctx),
    };
  },
  relationship: (name, declaration, path, ctx) => {
    const relationTo = relationTarget(declaration, path, ctx);
    if (!relationTo) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "relationship",
      relationTo,
      hasMany: optionalBoolean(declaration, "hasMany", path, ctx),
    };
  },
  repeater: (name, declaration, path, ctx) => {
    const fields = nestedFields(declaration, path, ctx);
    if (!fields) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "repeater",
      fields,
      minRows: optionalNumber(declaration, "minRows", path, ctx),
      maxRows: optionalNumber(declaration, "maxRows", path, ctx),
    };
  },
  group: (name, declaration, path, ctx) => {
    const fields = nestedFields(declaration, path, ctx);
    if (!fields) return null;
    return {
      ...base(name, declaration, path, ctx),
      type: "group",
      fields,
    };
  },
};

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
  ctx: ConversionContext
): FieldConfig[] | null {
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
    ctx
  );
  // An empty result means every nested declaration failed; its own issues are
  // already recorded, so the parent is dropped without adding noise.
  return nested.length > 0 ? nested : null;
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
