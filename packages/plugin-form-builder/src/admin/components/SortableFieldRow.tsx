"use client";

/**
 * Sortable Field Row Component
 *
 * A draggable row component for form fields in the Visual Form Builder.
 * Uses @dnd-kit's useSortable hook for drag-and-drop reordering.
 *
 * Features:
 * - Drag handle with GripVertical icon for reordering
 * - Visual feedback during drag operations (opacity, ring, shadow)
 * - Field type icon and label display
 * - Required field indicator
 * - Delete button with keyboard accessibility
 * - WCAG 2.2 compliant with proper ARIA attributes
 *
 * This component follows the pattern established by ArrayRow.tsx in the
 * Nextly admin package for consistency across the codebase.
 *
 * @module admin/components/SortableFieldRow
 * @since 0.1.0
 */

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { useCallback } from "react";

import type { FormField } from "../../types";
import {
  getFieldTypeIcon,
  getFieldTypeLabel,
  resolveFieldIcon,
} from "../fields";

// ============================================================================
// Types
// ============================================================================

export interface SortableFieldRowProps {
  /**
   * The form field to display.
   */
  field: FormField;

  /**
   * Whether this row is currently selected for editing.
   */
  isSelected: boolean;

  /**
   * Callback when the row is clicked/selected.
   */
  onSelect: () => void;

  /**
   * Callback when the delete button is clicked.
   */
  onDelete: () => void;

  /**
   * Whether the row is disabled (no interactions allowed).
   * @default false
   */
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SortableFieldRow renders a single draggable field row in the form builder.
 *
 * Uses @dnd-kit's useSortable hook to enable drag-and-drop reordering.
 * The component displays:
 * - A drag handle (GripVertical icon) for reordering
 * - The field type icon
 * - The field label (or name as fallback) with required indicator
 * - The field type badge
 * - A delete button
 *
 * Visual feedback is provided during drag operations:
 * - Reduced opacity (50%)
 * - Primary color ring (2px)
 * - Elevated shadow
 * - Higher z-index
 *
 * @example
 * ```tsx
 * <SortableFieldRow
 *   field={field}
 *   isSelected={selectedFieldName === field.name}
 *   onSelect={() => setSelectedFieldName(field.name)}
 *   onDelete={() => handleDeleteField(field.name)}
 * />
 * ```
 */
export function SortableFieldRow({
  field,
  isSelected,
  onSelect,
  onDelete,
  disabled = false,
}: SortableFieldRowProps) {
  // ---------------------------------------------------------------------------
  // @dnd-kit Sortable Hook
  // ---------------------------------------------------------------------------

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: field.name,
    disabled,
  });

  // Apply CSS transform for drag animation
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // ---------------------------------------------------------------------------
  // Field Type Info
  // ---------------------------------------------------------------------------

  const iconName = getFieldTypeIcon(field.type);
  const typeLabel = getFieldTypeLabel(field.type);
  const IconComponent = resolveFieldIcon(iconName);

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle delete button click.
   * Stops propagation to prevent row selection.
   */
  const handleDelete = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  /**
   * Handle keyboard navigation on the row.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Build class names based on state
  const rowClassName = [
    "form-field-row",
    isSelected && "form-field-row--selected",
    isDragging && "form-field-row--dragging",
    disabled && "form-field-row--disabled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={rowClassName}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${field.label || field.name} field, type: ${typeLabel}${isSelected ? ", selected" : ""}`}
      aria-pressed={isSelected}
      aria-disabled={disabled}
    >
      {/* Drag Handle */}
      {!disabled && (
        <button
          type="button"
          className="form-field-row__drag-handle"
          aria-label={`Drag to reorder ${field.label || field.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="form-field-row__drag-icon" />
        </button>
      )}

      {/* Spacer when drag handle is hidden */}
      {disabled && <div className="form-field-row__drag-handle-spacer" />}

      {/* Field Type Icon */}
      <span className="form-field-row__type-icon" aria-hidden="true">
        <IconComponent className="form-field-row__icon" />
      </span>

      {/* Field Content */}
      <div className="form-field-row__content">
        <span className="form-field-row__label">
          {field.label || field.name}
          {field.required && (
            <span className="form-field-row__required" aria-label="Required">
              *
            </span>
          )}
        </span>
        <span className="form-field-row__type-badge">{typeLabel}</span>
      </div>

      {/* Actions */}
      <div className="form-field-row__actions">
        <button
          type="button"
          className="form-field-row__action form-field-row__action--delete"
          onClick={handleDelete}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleDelete(e);
            }
          }}
          disabled={disabled}
          aria-label={`Delete ${field.label || field.name}`}
          title="Delete field"
        >
          <Trash2 className="form-field-row__action-icon" />
        </button>
      </div>
    </div>
  );
}

export default SortableFieldRow;
