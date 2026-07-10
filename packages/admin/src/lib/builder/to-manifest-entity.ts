/**
 * Map builder output (FieldDefinition[] + settings) → a `ui-schema.json`
 * collection entity (spec §4.12). The field `type` is recorded verbatim,
 * including plugin-contributed field types: the manifest Zod accepts plugin
 * slugs and the CLI column classifier resolves them via the field-type
 * registry, so the real type round-trips to production.
 * The per-field mapping is shared by the collection/single/component mappers via
 * `mapBuilderFieldToManifest`.
 *
 * @module lib/builder/to-manifest-entity
 * @since v0.0.3-alpha (Plan D4)
 */
import { type UiSchemaFieldType } from "./ui-schema-mode";

/** Validation shape carried by builder fields (superset of FieldDefinition's). */
export interface BuilderFieldValidationInput {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minRows?: number;
  maxRows?: number;
  pattern?: string;
  message?: string;
}

/** Per-field admin options carried by builder fields. */
export interface BuilderFieldAdminInput {
  width?: string;
  position?: "sidebar";
  readOnly?: boolean;
  hidden?: boolean;
  description?: string;
  placeholder?: string;
  hideGutter?: boolean;
  allowCreate?: boolean;
  condition?: Record<string, unknown>;
}

/**
 * The full slice of the builder's FieldDefinition the manifest preserves.
 * Structurally a superset of `FieldDefinition` (so the edit pages can pass
 * `FieldDefinition[]` straight through) — every property here round-trips
 * losslessly into `ui-schema.json`.
 */
export interface BuilderFieldInput {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  relationTo?: string | string[];
  hasMany?: boolean;
  options?: Array<{ id?: string; label: string; value: string }>;
  defaultValue?: unknown;
  validation?: BuilderFieldValidationInput;
  admin?: BuilderFieldAdminInput;
  maxDepth?: number;
  allowCreate?: boolean;
  allowEdit?: boolean;
  isSortable?: boolean;
  relationshipFilter?: { field: string; equals: string };
  mimeTypes?: string;
  maxFileSize?: number;
  labels?: { singular?: string; plural?: string };
  initCollapsed?: boolean;
  rowLabelField?: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  /** Nested fields for container types (repeater/group/component). */
  fields?: BuilderFieldInput[];
}

export interface BuilderSettingsInput {
  singularName?: string;
  pluralName?: string;
  status?: boolean;
  /** i18n: collection has translatable fields (companion `_locales` table). */
  localized?: boolean;
  useAsTitle?: string;
  defaultColumns?: string[];
  group?: string;
}

export interface EntityToManifestArgs {
  slug: string;
  settings: BuilderSettingsInput;
  fields: BuilderFieldInput[];
}

/** Back-compat alias for the collection mapper's args. */
export type CollectionToManifestArgs = EntityToManifestArgs;

/** A ui-schema field (mirrors the package's UiSchemaField / FieldNode shape). */
export interface ManifestField {
  name: string;
  // A canonical ui-schema type OR a plugin-contributed field type slug. `string
  // & {}` widens the union while preserving autocomplete for canonical types.
  type: UiSchemaFieldType | (string & {});
  label?: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  relationTo?: string | string[];
  hasMany?: boolean;
  options?: Array<{ id?: string; label: string; value: string }>;
  defaultValue?: unknown;
  validation?: BuilderFieldValidationInput;
  admin?: BuilderFieldAdminInput;
  maxDepth?: number;
  allowCreate?: boolean;
  allowEdit?: boolean;
  isSortable?: boolean;
  relationshipFilter?: { field: string; equals: string };
  mimeTypes?: string;
  maxFileSize?: number;
  labels?: { singular?: string; plural?: string };
  initCollapsed?: boolean;
  rowLabelField?: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  fields?: ManifestField[];
}

/** A ui-schema entity (matches the package's UiSchemaEntity shape). */
export interface ManifestEntity {
  slug: string;
  labels?: { singular: string; plural: string };
  admin?: { useAsTitle?: string; defaultColumns?: string[]; group?: string };
  status?: boolean;
  /** i18n: collection has translatable fields. */
  localized?: boolean;
  fields: ManifestField[];
}

/** Scalar/object props copied verbatim from a builder field to the manifest. */
const PASSTHROUGH_KEYS = [
  "label",
  "required",
  "unique",
  "index",
  "localized",
  "relationTo",
  "hasMany",
  "options",
  "defaultValue",
  "validation",
  "admin",
  "maxDepth",
  "allowCreate",
  "allowEdit",
  "isSortable",
  "relationshipFilter",
  "mimeTypes",
  "maxFileSize",
  "labels",
  "initCollapsed",
  "rowLabelField",
  "component",
  "components",
  "repeatable",
] as const;

/**
 * Map one builder field → a ui-schema manifest field. Forwards every property
 * losslessly (a `relationTo` array stays an array — no truncation). Recursive
 * for container types (repeater/group/component) that carry nested `fields`.
 * Shared by every entity mapper so the field translation stays in one place.
 */
export function mapBuilderFieldToManifest(f: BuilderFieldInput): ManifestField {
  // Record the field type verbatim — including plugin-contributed field types.
  // The manifest Zod accepts plugin slugs and the CLI column classifier resolves
  // them via the field-type registry, so the real type round-trips to
  // production. The field picker prevents typos.
  const out: ManifestField = {
    name: f.name,
    type: f.type,
  };
  const sink = out as unknown as Record<string, unknown>;
  for (const key of PASSTHROUGH_KEYS) {
    if (f[key] !== undefined) {
      sink[key] = f[key];
    }
  }
  if (f.fields !== undefined) {
    out.fields = f.fields.map(mapBuilderFieldToManifest);
  }
  return out;
}

/** Apply the shared admin/status settings onto an entity in place. */
export function applyCommonSettings(
  entity: ManifestEntity,
  settings: BuilderSettingsInput
): void {
  const { useAsTitle, defaultColumns, group, status, localized } = settings;
  const admin: NonNullable<ManifestEntity["admin"]> = {};
  if (useAsTitle) admin.useAsTitle = useAsTitle;
  if (defaultColumns && defaultColumns.length > 0) {
    admin.defaultColumns = defaultColumns;
  }
  if (group) admin.group = group;
  if (Object.keys(admin).length > 0) entity.admin = admin;
  if (status !== undefined) entity.status = status;
  if (localized !== undefined) entity.localized = localized;
}

export function collectionToManifestEntity(
  args: CollectionToManifestArgs
): ManifestEntity {
  const entity: ManifestEntity = {
    slug: args.slug,
    fields: args.fields.map(mapBuilderFieldToManifest),
  };
  const { singularName, pluralName } = args.settings;
  if (singularName && pluralName) {
    entity.labels = { singular: singularName, plural: pluralName };
  }
  applyCommonSettings(entity, args.settings);
  return entity;
}
