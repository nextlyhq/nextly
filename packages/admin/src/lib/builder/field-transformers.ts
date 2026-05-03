import { arrayMove } from "@dnd-kit/sortable";

import type { BuilderField } from "@admin/components/features/schema-builder";
import type { FieldCondition } from "@admin/components/features/schema-builder/types";
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

/**
 * Recursively find a field by ID, searching through nested fields and block types.
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
    if (field.type === "blocks" && field.blocks) {
      for (const block of field.blocks) {
        if (block.fields && block.fields.length > 0) {
          const found = findFieldById(block.fields, fieldId);
          if (found) return found;
        }
      }
    }
  }
  return null;
}

/**
 * Find which nested container (array or group) a given field lives in.
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
 * Add a field to a specific block type within a Blocks field.
 */
export function addFieldToBlockType(
  fields: BuilderField[],
  blocksFieldId: string,
  blockIndex: number,
  newField: BuilderField
): BuilderField[] {
  return fields.map(field => {
    if (field.id === blocksFieldId && field.type === "blocks" && field.blocks) {
      const updatedBlocks = field.blocks.map((block, idx) => {
        if (idx === blockIndex) {
          return {
            ...block,
            fields: [...(block.fields || []), newField],
          };
        }
        return block;
      });
      return { ...field, blocks: updatedBlocks };
    }
    if (field.fields && field.fields.length > 0) {
      return {
        ...field,
        fields: addFieldToBlockType(
          field.fields,
          blocksFieldId,
          blockIndex,
          newField
        ),
      };
    }
    return field;
  });
}

/**
 * Add a field to an Array (repeater) field's nested fields.
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
    if (field.type === "blocks" && field.blocks) {
      const updatedBlocks = field.blocks.map(block => {
        if (block.fields && block.fields.length > 0) {
          return {
            ...block,
            fields: addFieldToArray(block.fields, arrayFieldId, newField),
          };
        }
        return block;
      });
      return { ...field, blocks: updatedBlocks };
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
    if (field.type === "blocks" && field.blocks) {
      const updatedBlocks = field.blocks.map(block => {
        if (block.fields && block.fields.length > 0) {
          return {
            ...block,
            fields: addFieldToGroup(block.fields, groupFieldId, newField),
          };
        }
        return block;
      });
      return { ...field, blocks: updatedBlocks };
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
    if (field.type === "blocks" && field.blocks) {
      const updatedBlocks = field.blocks.map(block => {
        if (block.fields && block.fields.length > 0) {
          return {
            ...block,
            fields: updateFieldById(block.fields, updatedField),
          };
        }
        return block;
      });
      return { ...field, blocks: updatedBlocks };
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
      if (field.type === "blocks" && field.blocks) {
        const updatedBlocks = field.blocks.map(block => {
          if (block.fields && block.fields.length > 0) {
            return {
              ...block,
              fields: deleteFieldById(block.fields, fieldId),
            };
          }
          return block;
        });
        return { ...field, blocks: updatedBlocks };
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
    if (field.type === "blocks" && field.blocks) {
      const updatedBlocks = field.blocks.map(block => {
        if (block.fields && block.fields.length > 0) {
          return {
            ...block,
            fields: reorderNestedFields(block.fields, activeId, overId),
          };
        }
        return block;
      });
      return { ...field, blocks: updatedBlocks };
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
    type: field.type as FieldDefinition["type"],
    required: Boolean(field.validation?.required),
    unique: Boolean(field.advanced?.unique),
    index: Boolean(field.advanced?.index),
    defaultValue: field.defaultValue,
  };

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

  // Blocks
  if (field.type === "blocks" && field.blocks && field.blocks.length > 0) {
    definition.blocks = field.blocks.map(block => ({
      slug: block.slug,
      labels: block.label ? { singular: block.label } : undefined,
      fields: block.fields
        ? block.fields.map(f => convertToFieldDefinition(f))
        : [],
    }));
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

  // Upload properties
  if (field.type === "upload") {
    definition.relationTo = field.relationTo;
    definition.mimeTypes = field.mimeTypes;
    definition.maxFileSize = field.maxFileSize;
    definition.allowCreate = field.allowCreate;
    definition.allowEdit = field.allowEdit;
    definition.isSortable = field.isSortable;
    definition.displayPreview = field.displayPreview;
  }

  // Array (repeater) properties
  if (field.type === "repeater") {
    definition.labels = field.labels;
    definition.initCollapsed = field.initCollapsed;
    definition.isSortable = field.isSortable;
    definition.rowLabelField = field.rowLabelField;
  }

  // Component properties
  if (field.type === "component") {
    if (field.component) definition.component = field.component;
    if (field.components && field.components.length > 0) {
      definition.components = field.components;
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

  return definition;
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
    },
    // Relationship properties
    relationTo: field.relationTo,
    maxDepth: field.maxDepth,
    allowCreate: field.allowCreate,
    allowEdit: field.allowEdit,
    isSortable: field.isSortable,
    relationshipFilter: field.relationshipFilter,
    // Upload properties
    mimeTypes: field.mimeTypes,
    maxFileSize: field.maxFileSize,
    displayPreview: field.displayPreview,
    // Array properties
    labels: field.labels,
    initCollapsed: field.initCollapsed,
    rowLabelField: field.rowLabelField,
    // Component properties
    component: field.component,
    components: field.components ? [...field.components] : undefined,
    repeatable: field.repeatable,
  };

  // Nested fields
  if (field.fields && field.fields.length > 0) {
    builderField.fields = field.fields.map((f, i) =>
      convertToBuilderField(f, i)
    );
  }

  // Blocks
  if (field.type === "blocks" && field.blocks && field.blocks.length > 0) {
    builderField.blocks = field.blocks.map(block => ({
      slug: block.slug,
      label: block.labels?.singular,
      fields: block.fields
        ? block.fields.map((f, i) => convertToBuilderField(f, i))
        : [],
    }));
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
      // Cast: FieldDefinitionAdmin.condition's operator is typed as
      // string (broad) for storage flexibility; FieldCondition narrows
      // operator to the ConditionOperator union. The runtime evaluator
      // handles unknown operators (fail-open) so the cast is safe.
      condition: field.admin.condition as FieldCondition | undefined,
      hideGutter: field.admin.hideGutter,
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
