/**
 * Form Field List Component
 *
 * A sortable list container for form fields with drag-and-drop reordering.
 * Uses @dnd-kit for accessible drag-and-drop functionality.
 *
 * Features:
 * - Drag-and-drop reordering via @dnd-kit
 * - Keyboard-accessible drag operations (Arrow keys)
 * - PointerSensor with 8px activation distance (prevents accidental drags)
 * - Empty state display when no fields exist
 * - Visual feedback during drag operations
 *
 * This component provides the DndContext and SortableContext wrappers.
 * Individual field rows are rendered using SortableFieldRow which uses
 * the useSortable hook for drag-and-drop functionality.
 *
 * @module admin/components/FormFieldList
 * @since 0.1.0
 */

"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useCallback } from "react";

import type { FormField } from "../../types";

import { SortableFieldRow } from "./SortableFieldRow";

// ============================================================================
// Types
// ============================================================================

export interface FormFieldListProps {
  /**
   * Array of form fields to display.
   */
  fields: FormField[];

  /**
   * Callback when fields are reordered via drag-and-drop.
   * Receives the new array with fields in updated order.
   */
  onFieldsChange: (fields: FormField[]) => void;

  /**
   * Callback when a field is selected for editing.
   * Receives the field name (unique identifier).
   */
  onEditField: (fieldName: string) => void;

  /**
   * Callback when a field should be deleted.
   * Receives the field name (unique identifier).
   */
  onDeleteField: (fieldName: string) => void;

  /**
   * Currently selected field name for highlighting.
   */
  selectedFieldName?: string | null;

  /**
   * Whether the list is disabled (no interactions allowed).
   * @default false
   */
  disabled?: boolean;
}

// ============================================================================
// FormFieldList Component
// ============================================================================

/**
 * FormFieldList provides a drag-and-drop sortable container for form fields.
 *
 * This component wraps fields with DndContext and SortableContext from @dnd-kit,
 * enabling drag-and-drop reordering with full keyboard accessibility.
 *
 * The component follows the pattern established by ArrayInput.tsx in the
 * Nextly admin package:
 * - PointerSensor with 8px activation distance (prevents accidental drags)
 * - KeyboardSensor with sortableKeyboardCoordinates (arrow key navigation)
 * - closestCenter collision detection
 * - verticalListSortingStrategy for vertical lists
 *
 * @example
 * ```tsx
 * <FormFieldList
 *   fields={formFields}
 *   onFieldsChange={setFormFields}
 *   onEditField={(name) => setSelectedField(name)}
 *   onDeleteField={(name) => handleDeleteField(name)}
 *   selectedFieldName={selectedField}
 * />
 * ```
 */
export function FormFieldList({
  fields,
  onFieldsChange,
  onEditField,
  onDeleteField,
  selectedFieldName,
  disabled = false,
}: FormFieldListProps) {
  // ---------------------------------------------------------------------------
  // Sensor Setup
  // ---------------------------------------------------------------------------

  // PointerSensor: mouse/touch with 8px activation distance to prevent accidental drags
  // KeyboardSensor: Arrow keys for accessibility (WCAG 2.2 compliance)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ---------------------------------------------------------------------------
  // Drag Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle drag end - reorder fields using arrayMove.
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = fields.findIndex(f => f.name === active.id);
        const newIndex = fields.findIndex(f => f.name === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newFields = arrayMove(fields, oldIndex, newIndex);
          onFieldsChange(newFields);
        }
      }
    },
    [fields, onFieldsChange]
  );

  // ---------------------------------------------------------------------------
  // Empty State
  // ---------------------------------------------------------------------------

  if (fields.length === 0) {
    return (
      <div className="form-field-list form-field-list--empty">
        <div className="form-field-list__empty-state">
          <div className="form-field-list__empty-icon" aria-hidden="true">
            📋
          </div>
          <p className="form-field-list__empty-title">No fields yet</p>
          <p className="form-field-list__empty-hint">
            Click &quot;Add Field&quot; to get started
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="form-field-list">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={fields.map(f => f.name)}
          strategy={verticalListSortingStrategy}
          disabled={disabled}
        >
          <div className="form-field-list__fields" role="list">
            {fields.map(field => (
              <SortableFieldRow
                key={field.name}
                field={field}
                isSelected={selectedFieldName === field.name}
                onSelect={() => onEditField(field.name)}
                onDelete={() => onDeleteField(field.name)}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Footer hint */}
      <div className="form-field-list__footer">
        <p className="form-field-list__footer-text">
          {fields.length} field{fields.length !== 1 ? "s" : ""} • Drag to
          reorder • Click to edit
        </p>
      </div>
    </div>
  );
}

export default FormFieldList;
