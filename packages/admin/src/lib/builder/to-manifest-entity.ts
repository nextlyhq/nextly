/**
 * Map builder output (FieldDefinition[] + settings) → a `ui-schema.json`
 * collection entity (spec §4.12). Field types are validated against the
 * canonical `UI_SCHEMA_FIELD_TYPES` set; an unsupported type throws (the field
 * picker prevents it, this is a defensive backstop). The per-field mapping is
 * shared by the collection/single/component mappers via
 * `mapBuilderFieldToManifest`.
 *
 * @module lib/builder/to-manifest-entity
 * @since v0.0.3-alpha (Plan D4)
 */
import {
  UI_SCHEMA_FIELD_TYPES,
  type UiSchemaFieldType,
} from "./ui-schema-mode";

/** Minimal slice of the builder's FieldDefinition the manifest needs. */
export interface BuilderFieldInput {
  name: string;
  type: string;
  required?: boolean;
  relationTo?: string | string[];
  hasMany?: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
  validation?: { min?: number; max?: number; pattern?: string };
  /** Nested fields for container types (repeater/group/component). */
  fields?: BuilderFieldInput[];
}

export interface BuilderSettingsInput {
  singularName?: string;
  pluralName?: string;
  status?: boolean;
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

/** A ui-schema field (matches the package's UiSchemaField shape). */
export interface ManifestField {
  name: string;
  type: UiSchemaFieldType;
  required?: boolean;
  relationTo?: string;
  hasMany?: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
  validation?: { min?: number; max?: number; pattern?: string };
  fields?: ManifestField[];
}

/** A ui-schema entity (matches the package's UiSchemaEntity shape). */
export interface ManifestEntity {
  slug: string;
  labels?: { singular: string; plural: string };
  admin?: { useAsTitle?: string; defaultColumns?: string[]; group?: string };
  status?: boolean;
  fields: ManifestField[];
}

const SUPPORTED = new Set<string>(UI_SCHEMA_FIELD_TYPES);

function relationToString(
  relationTo: string | string[] | undefined
): string | undefined {
  if (relationTo === undefined) return undefined;
  return Array.isArray(relationTo) ? relationTo[0] : relationTo;
}

/**
 * Map one builder field → a ui-schema manifest field. Recursive for container
 * types (repeater/group/component) that carry nested `fields`. Shared by every
 * entity mapper so the field translation stays in one place.
 */
export function mapBuilderFieldToManifest(f: BuilderFieldInput): ManifestField {
  if (!SUPPORTED.has(f.type)) {
    throw new Error(
      `unsupported field type '${f.type}' for ui-schema.json (field '${f.name}')`
    );
  }
  const out: ManifestField = { name: f.name, type: f.type as UiSchemaFieldType };
  if (f.required !== undefined) out.required = f.required;
  const rel = relationToString(f.relationTo);
  if (rel !== undefined) out.relationTo = rel;
  if (f.hasMany !== undefined) out.hasMany = f.hasMany;
  if (f.options !== undefined) out.options = f.options;
  if (f.defaultValue !== undefined) out.defaultValue = f.defaultValue;
  if (f.validation !== undefined) out.validation = f.validation;
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
  const { useAsTitle, defaultColumns, group, status } = settings;
  const admin: NonNullable<ManifestEntity["admin"]> = {};
  if (useAsTitle) admin.useAsTitle = useAsTitle;
  if (defaultColumns && defaultColumns.length > 0) {
    admin.defaultColumns = defaultColumns;
  }
  if (group) admin.group = group;
  if (Object.keys(admin).length > 0) entity.admin = admin;
  if (status !== undefined) entity.status = status;
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
