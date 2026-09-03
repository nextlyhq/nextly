import { arrayMove } from "@dnd-kit/sortable";
// The shared readers preserve both reference spellings across the builder
// round trip: a migrated definition loads with its references intact and
// saves them back resolved, rather than losing them into pluginOptions.
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "nextly/field-group-type";

import type {
  BuilderField,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";
import type { FieldDefinition } from "@admin/types/collection";

/**
 * Generate a unique ID for builder fields.
 */
export function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Convert a string to snake_case.
 */
export function toSnakeName(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_");
}

export function toKebabName(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Recursively find a field by ID, searching through nested fields.
 */
export function findFieldById(
  fields: BuilderField[],
  fieldId: string
): BuilderField | null {
  for (const field of fields) {
    if (field.id === fieldId) {
      return field;
    }
    if (field.fields && field.fields.length > 0) {
      const found = findFieldById(field.fields, fieldId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find which nested container (repeater or group) a given field lives in.
 * Returns { containerId, containerType } if found, null otherwise.
 */
export function findParentContainerId(
  fields: BuilderField[],
  fieldId: string
): {
  containerId: string;
  containerType: "repeater" | "group";
} | null {
  for (const field of fields) {
    if ((field.type === "repeater" || field.type === "group") && field.fields) {
      if (field.fields.some(f => f.id === fieldId)) {
        return {
          containerId: field.id,
          containerType: field.type,
        };
      }
      const found = findParentContainerId(field.fields, fieldId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Add a field to a Repeater field's nested fields.
 */
export function addFieldToArray(
  fields: BuilderField[],
  arrayFieldId: string,
  newField: BuilderField
): BuilderField[] {
  return fields.map(field => {
    if (field.id === arrayFieldId && field.type === "repeater") {
      return {
        ...field,
        fields: [...(field.fields || []), newField],
      };
    }
    if (field.fields && field.fields.length > 0) {
      return {
        ...field,
        fields: addFieldToArray(field.fields, arrayFieldId, newField),
      };
    }
    return field;
  });
}

/**
 * Add a field to a Group field's nested fields.
 */
export function addFieldToGroup(
  fields: BuilderField[],
  groupFieldId: string,
  newField: BuilderField
): BuilderField[] {
  return fields.map(field => {
    if (field.id === groupFieldId && field.type === "group") {
      return {
        ...field,
        fields: [...(field.fields || []), newField],
      };
    }
    if (field.fields && field.fields.length > 0) {
      return {
        ...field,
        fields: addFieldToGroup(field.fields, groupFieldId, newField),
      };
    }
    return field;
  });
}

/**
 * Recursively update a field by ID.
 */
export function updateFieldById(
  fields: BuilderField[],
  updatedField: BuilderField
): BuilderField[] {
  return fields.map(field => {
    if (field.id === updatedField.id) {
      return updatedField;
    }
    if (field.fields && field.fields.length > 0) {
      return {
        ...field,
        fields: updateFieldById(field.fields, updatedField),
      };
    }
    return field;
  });
}

/**
 * Recursively delete a field by ID.
 */
export function deleteFieldById(
  fields: BuilderField[],
  fieldId: string
): BuilderField[] {
  return fields
    .filter(field => field.id !== fieldId)
    .map(field => {
      if (field.fields && field.fields.length > 0) {
        return {
          ...field,
          fields: deleteFieldById(field.fields, fieldId),
        };
      }
      return field;
    });
}

/**
 * Recursively reorder fields within a nested structure.
 */
export function reorderNestedFields(
  fields: BuilderField[],
  activeId: string,
  overId: string
): BuilderField[] {
  const activeIndex = fields.findIndex(f => f.id === activeId);
  const overIndex = fields.findIndex(f => f.id === overId);

  if (activeIndex !== -1 && overIndex !== -1) {
    return arrayMove(fields, activeIndex, overIndex);
  }

  return fields.map(field => {
    if (field.fields && field.fields.length > 0) {
      return {
        ...field,
        fields: reorderNestedFields(field.fields, activeId, overId),
      };
    }
    return field;
  });
}

/**
 * Convert BuilderField (UI) to FieldDefinition (API payload).
 * Handles nested fields, blocks, and all field-type-specific properties.
 */
export function convertToFieldDefinition(field: BuilderField): FieldDefinition {
  const definition: FieldDefinition = {
    name: toSnakeName(field.name),
    label: field.label || field.name,
    type: field.type,
    required: Boolean(field.validation?.required),
    unique: Boolean(field.advanced?.unique),
    index: Boolean(field.advanced?.index),
    defaultValue: field.defaultValue,
  };

  // Forward the localized choice only when the editor actually set it; coercing
  // an untouched switch to false would override the backend's per-type default
  // (text-like fields localize when the collection opts in), pinning fields to
  // shared. Omission means "use the default".
  if (typeof field.advanced?.localized === "boolean") {
    definition.localized = field.advanced.localized;
  }

  // Validation rules
  if (field.validation) {
    const rules: FieldDefinition["validation"] = {};
    if (field.validation.minLength !== undefined)
      rules.minLength = field.validation.minLength;
    if (field.validation.maxLength !== undefined)
      rules.maxLength = field.validation.maxLength;
    if (field.validation.min !== undefined) rules.min = field.validation.min;
    if (field.validation.max !== undefined) rules.max = field.validation.max;
    if (field.validation.minRows !== undefined)
      rules.minRows = field.validation.minRows;
    if (field.validation.maxRows !== undefined)
      rules.maxRows = field.validation.maxRows;
    if (field.validation.pattern) rules.pattern = field.validation.pattern;
    if (field.validation.message) rules.message = field.validation.message;
    if (Object.keys(rules).length > 0) definition.validation = rules;
  }

  // Nested fields
  if (field.fields && field.fields.length > 0) {
    definition.fields = field.fields.map(convertToFieldDefinition);
  }

  // A blocks field's policy. Rebuilding a field without it would silently
  // widen it back to accepting every registered block.
  if (field.blocks !== undefined) {
    definition.blocks = field.blocks;
  }

  // Options (select, radio)
  if (field.options && field.options.length > 0) {
    definition.options = field.options.map(opt => ({
      id: opt.id,
      label: opt.label,
      value: opt.value,
    }));
  }

  // Relationship properties
  if (field.type === "relationship") {
    definition.relationTo = field.relationTo;
    definition.maxDepth = field.maxDepth;
    definition.allowCreate = field.allowCreate;
    definition.allowEdit = field.allowEdit;
    definition.isSortable = field.isSortable;
    definition.relationshipFilter = field.relationshipFilter;
  }

  // Upload properties. PR H feedback 2.2: per-knob audit removed
  // dead config (relationTo, allowEdit, isSortable, displayPreview --
  // none affected runtime). Allow Create now persisted under
  // definition.admin.allowCreate to match the framework's
  // UploadFieldAdminOptions and the runtime UploadInput's read path.
  if (field.type === "upload") {
    definition.mimeTypes = field.mimeTypes;
    definition.maxFileSize = field.maxFileSize;
    if (field.admin?.allowCreate !== undefined) {
      definition.admin = {
        ...(definition.admin ?? {}),
        allowCreate: field.admin.allowCreate,
      };
    }
  }

  // Array (repeater) properties
  if (field.type === "repeater") {
    definition.labels = field.labels;
    definition.initCollapsed = field.initCollapsed;
    definition.isSortable = field.isSortable;
    definition.rowLabelField = field.rowLabelField;
  }

  // Component properties — either type spelling, with the references resolved
  // through the shared extractor onto the keys this editor edits. Reading the
  // legacy keys alone dropped a migrated definition's references into
  // pluginOptions, where the next save stripped the field's reference
  // entirely and the manifest refinement rejected the result.
  if (isFieldGroupFieldType(field.type)) {
    const refs = extractFieldGroupReferences(field);
    if (refs.single !== undefined) definition.component = refs.single;
    if (refs.many !== undefined && refs.many.length > 0) {
      definition.components = refs.many;
    }
    if (field.repeatable !== undefined)
      definition.repeatable = field.repeatable;
    if (field.initCollapsed !== undefined)
      definition.initCollapsed = field.initCollapsed;
    if (field.isSortable !== undefined)
      definition.isSortable = field.isSortable;
  }

  // Chips validation limits — merged into the validation object
  if (field.type === "chips") {
    const chipsLimits: Record<string, number> = {};
    if (field.validation?.minChips !== undefined)
      chipsLimits.minChips = field.validation.minChips;
    if (field.validation?.maxChips !== undefined)
      chipsLimits.maxChips = field.validation.maxChips;
    if (Object.keys(chipsLimits).length > 0) {
      definition.validation = {
        ...(definition.validation ?? {}),
        ...chipsLimits,
      };
    }
  }

  // hasMany for supported types
  if (
    ["text", "number", "select", "upload", "relationship"].includes(field.type)
  ) {
    definition.hasMany = field.hasMany;
  }

  // Admin options
  if (field.admin) {
    const admin: FieldDefinition["admin"] = {};
    if (field.admin.width) admin.width = field.admin.width;
    if (field.admin.position === "sidebar")
      admin.position = field.admin.position;
    if (field.admin.readOnly) admin.readOnly = field.admin.readOnly;
    if (field.admin.hidden) admin.hidden = field.admin.hidden;
    if (field.admin.description) admin.description = field.admin.description;
    if (field.admin.placeholder) admin.placeholder = field.admin.placeholder;
    if (field.admin.condition) admin.condition = field.admin.condition;
    if (field.admin.hideGutter) admin.hideGutter = field.admin.hideGutter;
    if (Object.keys(admin).length > 0) definition.admin = admin;
  }

  // Last, so a carried option can never displace a property the builder owns.
  applyCarriedOptions(definition, field.pluginOptions);

  return definition;
}

/**
 * Every property the builder rebuilds from its own state.
 *
 * Anything else on a stored field was put there by whoever declared its type.
 * A plugin-contributed field type names its own options, so they cannot be
 * enumerated here; they are carried verbatim instead. Rebuilding a field from
 * the modelled keys alone drops them, and since a save replaces the whole
 * entity, editing an unrelated setting would erase options the field's own
 * type requires.
 */
const BUILDER_MODELLED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "id",
  "isSystem",
  "name",
  "label",
  "type",
  "source",
  "owner",
  "locked",
  "description",
  "defaultValue",
  "required",
  "unique",
  "index",
  "localized",
  "hasMany",
  "validation",
  "advanced",
  "admin",
  "options",
  "fields",
  "relationTo",
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
  "blocks",
  "pluginOptions",
]);

/** Whether a value is a `{}` literal, matching what core accepts as a container. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Gather the properties the builder does not model into one bag.
 *
 * Reads own enumerable keys only, so an option named after an
 * `Object.prototype` member is neither invented nor missed.
 */
function collectUnmodelledOptions(
  field: object
): Record<string, unknown> | undefined {
  const carried: Record<string, unknown> = {};

  // Defined rather than assigned, for the same reason the write below defines:
  // a manifest deserialized from JSON can hold an own `__proto__` key, and
  // assigning it would set this object's prototype instead of collecting the
  // option — which would drop it on the next save, from the very container that
  // promises any name is legal.
  const collect = (key: string, value: unknown): void => {
    if (value === undefined) return;
    Object.defineProperty(carried, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };

  for (const [key, value] of Object.entries(field)) {
    if (BUILDER_MODELLED_FIELD_KEYS.has(key)) continue;
    collect(key, value);
  }

  // The container's entries win over any of the same name sitting directly on
  // the field: a type that moved an option into the container did so to escape
  // the meaning the surrounding schema gives that name.
  // Own, and a plain object: `typeof x === "object"` also admits arrays and
  // class instances, which the core reader rejects — the two have to agree on
  // what counts as a container or a field round-trips differently through each.
  if (Object.prototype.hasOwnProperty.call(field, "pluginOptions")) {
    const container = (field as { pluginOptions?: unknown }).pluginOptions;
    if (isPlainRecord(container)) {
      for (const [key, value] of Object.entries(container)) collect(key, value);
    }
  }

  return Object.keys(carried).length > 0 ? carried : undefined;
}

/**
 * Write carried options back onto a rebuilt field.
 *
 * Defined rather than assigned, and never over a key the target already owns,
 * so a carried option cannot reach an inherited setter or overwrite a property
 * the builder just produced.
 */
export function applyCarriedOptions(
  target: object,
  carried: Record<string, unknown> | undefined
): void {
  if (!carried) return;
  // Written into the container rather than onto the field. Directly on the
  // field an option is legal only while its name differs from every key the
  // field schema declares, and the writer cannot know which names a future
  // core version will add. Both locations are still read, so a field stored
  // the old way keeps working until something saves it.
  Object.defineProperty(target, "pluginOptions", {
    value: { ...carried },
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Convert FieldDefinition (API) to BuilderField (UI).
 * Handles nested fields, blocks, and all field-type-specific properties.
 */
export function convertToBuilderField(
  field: FieldDefinition,
  index: number | string
): BuilderField {
  const id = generateFieldId();

  const builderField: BuilderField = {
    id,
    name: field.name,
    label: field.label || field.name,
    type: field.type,
    isSystem: field.name === "title" || field.name === "slug",
    // Provenance (P8): carry the plugin tag through so the Builder renders a
    // plugin-contributed field locked + badged instead of as an editable field.
    source: field.source,
    owner: field.owner,
    locked: field.locked,
    defaultValue: field.defaultValue as
      | string
      | number
      | boolean
      | null
      | undefined,
    hasMany: field.hasMany,
    validation: field.validation
      ? {
          required: field.required,
          ...field.validation,
        }
      : {
          required: field.required,
        },
    advanced: {
      unique: field.unique || false,
      index: field.index || false,
      // Preserve an omitted (default-on) localized flag instead of coercing it
      // to false, so editing and re-saving a default-localized field does not
      // silently un-localize it.
      localized: field.localized,
    },
    // Relationship properties
    relationTo: field.relationTo,
    maxDepth: field.maxDepth,
    allowCreate: field.allowCreate,
    allowEdit: field.allowEdit,
    isSortable: field.isSortable,
    relationshipFilter: field.relationshipFilter,
    // Upload properties. PR H feedback 2.2 dropped displayPreview
    // (was dead config, never read at runtime).
    mimeTypes: field.mimeTypes,
    maxFileSize: field.maxFileSize,
    // Array properties
    labels: field.labels,
    initCollapsed: field.initCollapsed,
    rowLabelField: field.rowLabelField,
    // Component properties. References resolve through the shared extractor,
    // so a migrated definition loads its references onto the keys the editor
    // edits rather than losing them into pluginOptions.
    component: extractFieldGroupReferences(field).single,
    components: extractFieldGroupReferences(field).many,
    repeatable: field.repeatable,
    // A blocks field's policy. Loading it is what makes writing it back
    // meaningful: without this the outbound branch always sees undefined.
    blocks: field.blocks,
    // Options belonging to the field's own type, kept as declared.
    pluginOptions: collectUnmodelledOptions(field),
  };

  // Nested fields
  if (field.fields && field.fields.length > 0) {
    builderField.fields = field.fields.map((f, i) =>
      convertToBuilderField(f, i)
    );
  }

  // Admin options
  if (field.admin) {
    builderField.admin = {
      width: field.admin.width,
      position: field.admin.position === "sidebar" ? "sidebar" : "main",
      readOnly: field.admin.readOnly,
      hidden: field.admin.hidden,
      description: field.admin.description,
      placeholder: field.admin.placeholder,
      condition: field.admin.condition as FieldCondition | undefined,
      hideGutter: field.admin.hideGutter,
      allowCreate: field.admin.allowCreate,
    };
  }

  // Options with generated IDs
  if (field.options && field.options.length > 0) {
    builderField.options = field.options.map((opt, optIndex) => ({
      id: `opt_${index}_${optIndex}_${opt.value}`,
      label: opt.label,
      value: opt.value,
    }));
  }

  return builderField;
}
