"use client";

/**
 * FieldList Component
 *
 * Center panel of the Collection Builder.
 * Displays a sortable list of added fields using @dnd-kit.
 * Also serves as a drop zone for fields dragged from the palette.
 *
 * Features:
 * - Drag handle for reordering
 * - Field preview showing: type icon, name, label, required badge
 * - Click to select and open in Field Editor
 * - Delete button with confirmation dialog
 * - Nested field visualization for array/group/blocks
 * - Expand/collapse for nested structures
 * - Visual indicators for validation errors
 * - Drop zone for palette items
 * - Block type containers with individual drop zones for Blocks fields
 *
 * Note: DndContext is managed by the parent CollectionBuilder page
 * to enable drag from palette to list.
 */

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState, useCallback } from "react";

import * as Icons from "@admin/components/icons";

import type {
  BuilderField,
  FieldListProps,
  FieldValidationError,
} from "../types";
import { isNestedFieldType } from "../types";

import { countNestedFields, findFieldById } from "./constants";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { DropZone } from "./DropZone";
import { FieldRenderer } from "./FieldRenderer";

// ============================================================
// Main FieldList Component
// ============================================================

export function FieldList({
  fields,
  selectedFieldId,
  onFieldSelect,
  onFieldDelete,
  _onFieldAdd,
  validationErrors = [],
  collapsedFieldIds: externalCollapsedIds,
  onToggleCollapse: externalToggleCollapse,
  isDropping = false,
  onPlaceholderClick,
}: FieldListProps & { isDropping?: boolean }) {
  // Local state for delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<BuilderField | null>(null);

  // Local collapsed state if not controlled externally
  const [localCollapsedIds, setLocalCollapsedIds] = useState<Set<string>>(
    new Set()
  );

  const collapsedFieldIds = externalCollapsedIds ?? localCollapsedIds;
  const toggleCollapse = useCallback(
    (fieldId: string) => {
      if (externalToggleCollapse) {
        externalToggleCollapse(fieldId);
      } else {
        setLocalCollapsedIds(prev => {
          const next = new Set(prev);
          if (next.has(fieldId)) {
            next.delete(fieldId);
          } else {
            next.add(fieldId);
          }
          return next;
        });
      }
    },
    [externalToggleCollapse]
  );

  // Convert validation errors array to map for O(1) lookup
  const errorMap = new Map<string, FieldValidationError>(
    validationErrors.map(e => [e.fieldId, e])
  );

  // Handle delete request - show confirmation
  // Accepts field ID and looks up the field to support nested field deletion
  const handleDeleteRequest = useCallback(
    (fieldId: string) => {
      const field = findFieldById(fields, fieldId);
      if (field) {
        // System fields cannot be deleted
        if (field.isSystem) return;
        setFieldToDelete(field);
        setDeleteDialogOpen(true);
      }
    },
    [fields]
  );

  // Handle confirmed delete
  const handleConfirmDelete = useCallback(() => {
    if (fieldToDelete) {
      onFieldDelete(fieldToDelete.id);
      setFieldToDelete(null);
      setDeleteDialogOpen(false);
    }
  }, [fieldToDelete, onFieldDelete]);

  // Make the entire field list area droppable
  const { setNodeRef, isOver } = useDroppable({
    id: "field-list-drop-zone",
  });

  return (
    <div className="h-full flex flex-col w-full relative">
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-12 space-y-4"
      >
        {fields.length > 0 ? (
          <SortableContext
            items={fields.map(f => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col border border-border rounded-none overflow-hidden bg-background [&>*:last-child]:border-b-0">
              {fields.map(field => (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  depth={0}
                  selectedFieldId={selectedFieldId}
                  onFieldSelect={onFieldSelect}
                  onFieldDelete={handleDeleteRequest}
                  collapsedFieldIds={collapsedFieldIds}
                  onToggleCollapse={toggleCollapse}
                  validationErrors={errorMap}
                  onPlaceholderClick={onPlaceholderClick}
                />
              ))}
            </div>
            {/* Drop zone indicator at the end */}
            <DropZone
              isOver={isOver || isDropping}
              hasFields={fields.length > 0}
              onPlaceholderClick={onPlaceholderClick}
            />
          </SortableContext>
        ) : (
          // Empty state with drop zone
          <button
            type="button"
            onClick={() => onPlaceholderClick?.()}
            className={`
              h-full w-full flex flex-col items-center justify-center text-center p-10
              rounded-none border-2 border-dashed transition-all duration-200 cursor-pointer
              ${
                isOver || isDropping
                  ? "border-primary bg-primary/15 dark:bg-primary/20"
                  : "border-primary/60 dark:border-primary/40 bg-primary/[0.04] dark:bg-primary/[0.08] hover:bg-primary/[0.06] hover:border-primary"
              }
            `}
          >
            {/* Icon */}
            <div
              className={`w-12 h-12 rounded-none flex items-center justify-center mb-4 transition-all duration-200 ${
                isOver || isDropping
                  ? "bg-primary/15 scale-110"
                  : "bg-primary/8"
              }`}
              style={{
                background:
                  isOver || isDropping
                    ? "hsl(var(--primary) / 0.15)"
                    : "hsl(var(--primary) / 0.07)",
              }}
            >
              <Icons.Layers
                className={`h-5 w-5 transition-all duration-200 ${
                  isOver || isDropping ? "text-primary" : "text-primary/40"
                }`}
              />
            </div>
            {/* Text */}
            <p
              className={`text-sm font-medium transition-colors duration-200 ${
                isOver || isDropping
                  ? "text-primary font-semibold"
                  : "text-primary/60"
              }`}
            >
              {isOver || isDropping ? "Release to add Field" : "Add Field"}
            </p>
            {!(isOver || isDropping) && (
              <p className="text-xs text-primary/40 mt-1.5">
                Drag a field from the panel on the right or click here
              </p>
            )}
          </button>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        fieldName={fieldToDelete?.label || fieldToDelete?.name || ""}
        hasNestedFields={
          fieldToDelete ? isNestedFieldType(fieldToDelete.type) : false
        }
        nestedCount={fieldToDelete ? countNestedFields(fieldToDelete) : 0}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
