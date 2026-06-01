/**
 * Map builder output (FieldDefinition[] + settings) → a `ui-schema.json`
 * collection entity (spec §4.12). Only the 9 supported field types are
 * accepted; anything else throws (the field picker prevents it in file mode,
 * this is a defensive backstop).
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
}

export interface BuilderSettingsInput {
  singularName?: string;
  pluralName?: string;
  status?: boolean;
  useAsTitle?: string;
  defaultColumns?: string[];
  group?: string;
}

export interface CollectionToManifestArgs {
  slug: string;
  settings: BuilderSettingsInput;
  fields: BuilderFieldInput[];
}

/** A ui-schema collection entity (matches the package's UiSchemaEntity shape). */
export interface ManifestEntity {
  slug: string;
  labels?: { singular: string; plural: string };
  admin?: { useAsTitle?: string; defaultColumns?: string[]; group?: string };
  status?: boolean;
  fields: Array<{
    name: string;
    type: UiSchemaFieldType;
    required?: boolean;
    relationTo?: string;
    hasMany?: boolean;
    options?: Array<{ label: string; value: string }>;
    defaultValue?: unknown;
    validation?: { min?: number; max?: number; pattern?: string };
  }>;
}

const SUPPORTED = new Set<string>(UI_SCHEMA_FIELD_TYPES);

function relationToString(
  relationTo: string | string[] | undefined
): string | undefined {
  if (relationTo === undefined) return undefined;
  return Array.isArray(relationTo) ? relationTo[0] : relationTo;
}

export function collectionToManifestEntity(
  args: CollectionToManifestArgs
): ManifestEntity {
  const fields = args.fields.map(f => {
    if (!SUPPORTED.has(f.type)) {
      throw new Error(
        `unsupported field type '${f.type}' for ui-schema.json (field '${f.name}')`
      );
    }
    const out: ManifestEntity["fields"][number] = {
      name: f.name,
      type: f.type as UiSchemaFieldType,
    };
    if (f.required !== undefined) out.required = f.required;
    const rel = relationToString(f.relationTo);
    if (rel !== undefined) out.relationTo = rel;
    if (f.hasMany !== undefined) out.hasMany = f.hasMany;
    if (f.options !== undefined) out.options = f.options;
    if (f.defaultValue !== undefined) out.defaultValue = f.defaultValue;
    if (f.validation !== undefined) out.validation = f.validation;
    return out;
  });

  const entity: ManifestEntity = { slug: args.slug, fields };

  const {
    singularName,
    pluralName,
    useAsTitle,
    defaultColumns,
    group,
    status,
  } = args.settings;
  if (singularName && pluralName) {
    entity.labels = { singular: singularName, plural: pluralName };
  }
  const admin: NonNullable<ManifestEntity["admin"]> = {};
  if (useAsTitle) admin.useAsTitle = useAsTitle;
  if (defaultColumns && defaultColumns.length > 0) {
    admin.defaultColumns = defaultColumns;
  }
  if (group) admin.group = group;
  if (Object.keys(admin).length > 0) entity.admin = admin;
  if (status !== undefined) entity.status = status;

  return entity;
}
