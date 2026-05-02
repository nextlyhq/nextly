/**
 * ArrayFieldContainer Component
 *
 * Droppable container for an Array field's nested fields.
 * Shows the array field name, field count, and a drop zone for adding fields.
 */

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ReactNode } from "react";

import * as Icons from "@admin/components/icons";

import type { BuilderField, FieldValidationError } from "../types";

export interface ArrayFieldContainerProps {
  /** The parent Array field ID */
  parentFieldId: string;
  /** The parent Array field label/name for descriptive drop zone text */
  parentFieldLabel: string;
  /** The Array field's nested fields */
  nestedFields: BuilderField[];
  /** Current depth level */
  depth: number;
  /** Current nesting depth (for max-depth enforcement) */
  nestingDepth: number;
  /** Currently selected field ID */
  selectedFieldId: string | null;
  /** Callback when a field is selected */
  onFieldSelect: (fieldId: string) => void;
  /** Callback when a field is deleted */
  onFieldDelete: (fieldId: string) => void;
  /** Map of validation errors */
  validationErrors: Map<string, FieldValidationError>;
  /** Collapsed field IDs */
  collapsedFieldIds: Set<string>;
  /** Toggle collapse for nested fields */
  onToggleCollapse: (fieldId: string) => void;
  /** Callback when the placeholder is clicked */
  onPlaceholderClick?: (parentFieldId?: string) => void;
  /** Render function for nested fields (avoids circular imports) */
  renderField: (field: BuilderField, key: string) => ReactNode;
}

export function ArrayFieldContainer({
  parentFieldId,
  _parentFieldLabel,
  nestedFields,
  depth: _depth,
  nestingDepth,
  _selectedFieldId,
  _onFieldSelect,
  _onFieldDelete,
  _validationErrors,
  _collapsedFieldIds,
  _onToggleCollapse,
  onPlaceholderClick,
  renderField,
}: ArrayFieldContainerProps) {
  const fieldCount = nestedFields.length;
  const droppableId = `array-drop-${parentFieldId}`;

  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: {
      type: "array-field",
      parentFieldId,
    },
  });

  // Progressively darker shade per nesting depth
  const arrayBgClasses: Record<number, string> = {
    0: "light:bg-slate-50 dark:transparent",
    1: "light:bg-primary/5 dark:transparent",
    2: "light:bg-slate-200 dark:transparent",
    3: "light:bg-slate-300 dark:transparent",
    4: "light:bg-slate-400 dark:transparent",
  };
  const bgClass = arrayBgClasses[Math.min(nestingDepth, 4)];

  return (
    <div className={`p-4 rounded-none ${bgClass}`}>
      <div className="flex">
        {/* Left accent stripe -- teal for arrays/repeaters */}
        <div className="w-[3px] shrink-0 rounded-none pb-3 mr-3" />

        <div className="flex-1 min-w-0">
          {/* Nested field rows */}
          {fieldCount > 0 && (
            <div
              className="border-border/60 rounded-none overflow-hidden bg-background mb-2"
              style={{ borderRadius: "6px" }}
            >
              <SortableContext
                items={nestedFields.map(f => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="[&>*:last-child]:border-b-0">
                  {nestedFields.map(nestedField =>
                    renderField(nestedField, nestedField.id)
                  )}
                </div>
              </SortableContext>
            </div>
          )}

          <div
            ref={setNodeRef}
            className={`
              relative flex flex-col items-center justify-center gap-1.5
              px-6 py-4 rounded-none border-2 border-dashed
              transition-all duration-200 select-none
              ${
                isOver
                  ? "border-primary bg-primary/15 dark:bg-primary/20"
                  : "border-primary/60 dark:border-primary/40 bg-primary/[0.04] dark:bg-primary/[0.08] hover:bg-primary/[0.06] hover:border-primary cursor-pointer"
              }
            `}
            onClick={e => {
              e.stopPropagation();
              onPlaceholderClick?.(parentFieldId);
            }}
          >
            <Icons.ArrowDown
              className={`h-3.5 w-3.5 shrink-0 transition-all duration-200 ${
                isOver ? "text-primary translate-y-0.5" : "text-primary/40"
              }`}
            />
            <p
              className={`text-[11px] font-medium text-center leading-tight transition-colors duration-200 ${
                isOver ? "text-primary font-semibold" : "text-primary/60"
              }`}
            >
              {isOver ? "Release to add Field" : "Add Field"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
