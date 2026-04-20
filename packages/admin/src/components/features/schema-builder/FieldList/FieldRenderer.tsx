/**
 * FieldRenderer Component
 *
 * Recursive field renderer for the Collection Builder field list.
 * Renders a field and its nested children with proper indentation.
 * Delegates to container components (ArrayFieldContainer, GroupFieldContainer)
 * for nested field types, passing a render function for recursive rendering.
 */

import * as Icons from "@admin/components/icons";

import type { BuilderField, FieldValidationError } from "../types";
import { isNestedFieldType, MAX_NESTING_DEPTH } from "../types";

import { ArrayFieldContainer } from "./ArrayFieldContainer";
import { countNestedFields } from "./constants";
import { GroupFieldContainer } from "./GroupFieldContainer";
import { SortableFieldItem } from "./SortableFieldItem";
import { StaticFieldItem } from "./StaticFieldItem";

export interface FieldRendererProps {
  field: BuilderField;
  depth: number;
  nestingDepth?: number;
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string) => void;
  onFieldDelete: (fieldId: string) => void;
  collapsedFieldIds: Set<string>;
  onToggleCollapse: (fieldId: string) => void;
  validationErrors: Map<string, FieldValidationError>;
  /** Whether this field row is sortable */
  isSortable?: boolean;
  /** Callback when the placeholder is clicked */
  onPlaceholderClick?: (parentFieldId?: string) => void;
}

export function FieldRenderer({
  field,
  depth,
  nestingDepth,
  selectedFieldId,
  onFieldSelect,
  onFieldDelete,
  collapsedFieldIds,
  onToggleCollapse,
  validationErrors,
  isSortable = true,
  onPlaceholderClick,
}: FieldRendererProps) {
  const isCollapsed = collapsedFieldIds.has(field.id);
  const hasNestedFields = isNestedFieldType(field.type);

  const isArrayField = field.type === "repeater";
  const isGroupField = field.type === "group";
  const nestedFields = field.fields || [];
  const effectiveDepth = nestingDepth ?? depth;
  const atMaxDepth = effectiveDepth >= MAX_NESTING_DEPTH;
  const nestedCount = hasNestedFields ? countNestedFields(field) : 0;

  // For Array fields, always show the drop zone when expanded (even if empty)
  const showArrayDropZone = isArrayField && !isCollapsed;

  // For Group fields, always show the drop zone when expanded (even if empty)
  const showGroupDropZone = isGroupField && !isCollapsed;

  // For other nested field types - only show if they have nested fields
  const showNested =
    hasNestedFields &&
    !isArrayField &&
    !isGroupField &&
    !isCollapsed &&
    nestedFields.length > 0;

  const childNestingDepth = (nestingDepth ?? depth) + 1;

  // Render function passed to container components for recursive rendering
  const renderNestedField = (nestedField: BuilderField, key: string) => (
    <FieldRenderer
      key={key}
      field={nestedField}
      depth={0}
      nestingDepth={childNestingDepth}
      selectedFieldId={selectedFieldId}
      onFieldSelect={onFieldSelect}
      onFieldDelete={onFieldDelete}
      collapsedFieldIds={collapsedFieldIds}
      onToggleCollapse={onToggleCollapse}
      validationErrors={validationErrors}
      isSortable={true}
      onPlaceholderClick={onPlaceholderClick}
    />
  );

  return (
    <>
      {isSortable ? (
        <SortableFieldItem
          field={field}
          isSelected={selectedFieldId === field.id}
          onSelect={() => onFieldSelect(field.id)}
          onDelete={() => onFieldDelete(field.id)}
          depth={depth}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => onToggleCollapse(field.id)}
          validationError={validationErrors.get(field.id)}
          isSystem={field.isSystem}
        />
      ) : (
        <StaticFieldItem
          field={field}
          isSelected={selectedFieldId === field.id}
          onSelect={() => onFieldSelect(field.id)}
          onDelete={() => onFieldDelete(field.id)}
          depth={depth}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => onToggleCollapse(field.id)}
          nestedCount={nestedCount}
          validationError={validationErrors.get(field.id)}
          isSystem={field.isSystem}
        />
      )}

      {/* Render drop zone for Array fields (always shows when expanded) */}
      {showArrayDropZone && !atMaxDepth && (
        <ArrayFieldContainer
          parentFieldId={field.id}
          parentFieldLabel={field.label || field.name || ""}
          nestedFields={nestedFields}
          depth={depth}
          nestingDepth={effectiveDepth}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onFieldSelect}
          onFieldDelete={onFieldDelete}
          validationErrors={validationErrors}
          collapsedFieldIds={collapsedFieldIds}
          onToggleCollapse={onToggleCollapse}
          onPlaceholderClick={onPlaceholderClick}
          renderField={renderNestedField}
        />
      )}

      {/* Render drop zone for Group fields (always shows when expanded) */}
      {showGroupDropZone && !atMaxDepth && (
        <GroupFieldContainer
          parentFieldId={field.id}
          parentFieldLabel={field.label || field.name || ""}
          nestedFields={nestedFields}
          depth={depth}
          nestingDepth={effectiveDepth}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onFieldSelect}
          onFieldDelete={onFieldDelete}
          validationErrors={validationErrors}
          collapsedFieldIds={collapsedFieldIds}
          onToggleCollapse={onToggleCollapse}
          onPlaceholderClick={onPlaceholderClick}
          renderField={renderNestedField}
        />
      )}

      {/* Render nested fields for other nested field types (group, etc.) */}
      {showNested && !atMaxDepth && (
        <div className="space-y-2">
          {nestedFields.map(nestedField => (
            <FieldRenderer
              key={nestedField.id}
              field={nestedField}
              depth={depth + 1}
              nestingDepth={effectiveDepth + 1}
              selectedFieldId={selectedFieldId}
              onFieldSelect={onFieldSelect}
              onFieldDelete={onFieldDelete}
              collapsedFieldIds={collapsedFieldIds}
              onToggleCollapse={onToggleCollapse}
              validationErrors={validationErrors}
              isSortable={isSortable}
              onPlaceholderClick={onPlaceholderClick}
            />
          ))}
        </div>
      )}

      {/* Max depth warning */}
      {((showNested && nestedFields.length > 0) ||
        showArrayDropZone ||
        showGroupDropZone) &&
        atMaxDepth && (
          <div
            className="ml-6 p-2 text-xs text-yellow-600 bg-yellow-50 rounded border border-yellow-200"
            style={{ marginLeft: `${(depth + 1) * 24}px` }}
          >
            <Icons.AlertTriangle className="h-3 w-3 inline mr-1" />
            Maximum nesting depth reached ({MAX_NESTING_DEPTH} levels)
          </div>
        )}
    </>
  );
}
