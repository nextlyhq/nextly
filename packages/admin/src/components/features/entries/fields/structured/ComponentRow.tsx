/**
 * Component Row
 *
 * A sortable, collapsible row within a repeatable component field.
 * Supports drag-and-drop reordering via @dnd-kit.
 *
 * Similar to ArrayRow but adapted for component instances with
 * component type badges and component-specific field rendering.
 *
 * @module components/entries/fields/structured/ComponentRow
 * @since 1.0.0
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FieldConfig } from "@revnixhq/nextly/config";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { useState } from "react";
import type { Control, FieldValues } from "react-hook-form";

import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Trash2,
  Puzzle,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { FieldRenderer } from "../FieldRenderer";

// ============================================================
// Types
// ============================================================

export interface ComponentRowProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Unique identifier for this row (from useFieldArray).
   * Used as the sortable ID for drag-and-drop.
   */
  id: string;

  /**
   * Zero-based index of this row in the array.
   */
  index: number;

  /**
   * Display label for this component instance.
   */
  label: string;

  /**
   * Component type slug (for multi-component/dynamic zone).
   * Shown as a badge in the row header.
   */
  componentType?: string;

  /**
   * Field configurations for this component.
   */
  fields: FieldConfig[];

  /**
   * Base path for form field registration (e.g., "layout.0").
   */
  basePath: string;

  /**
   * The current data for this row.
   */
  data: Record<string, unknown>;

  /**
   * React Hook Form control object.
   * Reserved for future use - FieldRenderer gets control from FormContext.
   */
  control?: Control<TFieldValues>;

  /**
   * Callback to remove this row from the array.
   */
  onRemove: () => void;

  /**
   * Whether this row can be removed (respects minRows constraint).
   */
  canRemove: boolean;

  /**
   * Whether the entire form/field is disabled.
   */
  disabled?: boolean;

  /**
   * Whether the field is read-only.
   */
  readOnly?: boolean;

  /**
   * Whether this row should start collapsed.
   */
  initCollapsed?: boolean;

  /**
   * Whether drag-and-drop reordering is enabled.
   */
  isSortable?: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Generates a dynamic label for the component row based on data.
 * Tries to find a meaningful value from common field names.
 */
function generateRowLabel(
  index: number,
  label: string,
  data: Record<string, unknown>
): string {
  // Priority order of fields to check for label
  const labelFields = [
    "title",
    "name",
    "heading",
    "label",
    "text",
    "question",
    "metaTitle",
  ];

  for (const fieldName of labelFields) {
    const value = data[fieldName];
    if (value && typeof value === "string" && value.trim()) {
      // Truncate long values
      const truncated =
        value.length > 40 ? `${value.substring(0, 40)}...` : value;
      return truncated;
    }
  }

  // Fallback to generic label with index
  return `${label} ${index + 1}`;
}

// ============================================================
// Component
// ============================================================

/**
 * ComponentRow renders a single row within a repeatable component field.
 *
 * Features:
 * - Drag handle for reordering via @dnd-kit
 * - Collapsible content with smooth animation
 * - Component type badge for dynamic zones
 * - Dynamic row labels based on content
 * - Remove button with disabled state
 * - Visual feedback during drag operations
 *
 * @example
 * ```tsx
 * <ComponentRow
 *   id={item.id}
 *   index={0}
 *   label="Hero"
 *   componentType="hero"
 *   fields={heroFields}
 *   basePath="layout.0"
 *   data={item}
 *   control={control}
 *   onRemove={() => remove(0)}
 *   canRemove={true}
 * />
 * ```
 */
export function ComponentRow<TFieldValues extends FieldValues = FieldValues>({
  id,
  index,
  label,
  componentType,
  fields,
  basePath,
  data,
  control: _control,
  onRemove,
  canRemove,
  disabled = false,
  readOnly = false,
  initCollapsed = false,
  isSortable = true,
}: ComponentRowProps<TFieldValues>) {
  // Note: _control is reserved for future use - FieldRenderer gets control from FormContext
  void _control;
  // Collapsible state
  const [isOpen, setIsOpen] = useState(!initCollapsed);

  // @dnd-kit sortable hook
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: disabled || readOnly || !isSortable,
  });

  // Apply transform styles for drag animation
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Determine if row can be interacted with
  const isInteractive = !disabled && !readOnly;

  // Generate dynamic label
  const rowLabel = generateRowLabel(index, label, data);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "transition-shadow",
        isDragging && "opacity-50 ring-2 ring-primary shadow-lg z-10"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="p-3" noBorder>
          <div className="flex items-center gap-2">
            {/* Drag Handle */}
            {isSortable && isInteractive && (
              <button
                type="button"
                className={cn(
                  "cursor-grab active:cursor-grabbing p-1 rounded",
                  "hover-unified focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                  "touch-none" // Prevent touch scrolling interference
                )}
                aria-label={`Drag to reorder ${label} ${index + 1}`}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            )}

            {/* Spacer when drag handle is hidden */}
            {(!isSortable || !isInteractive) && <div className="w-6" />}

            {/* Collapse Toggle + Label */}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 flex-1 text-left min-w-0 cursor-pointer",
                  "rounded px-1 py-0.5",
                  "hover-unified focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                )}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}

                {/* Component icon */}
                <Puzzle className="h-4 w-4 shrink-0 text-muted-foreground" />

                {/* Component type badge (for dynamic zones) */}
                {componentType && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {label}
                  </Badge>
                )}

                {/* Row label */}
                <span className="truncate text-sm font-medium">
                  {componentType ? rowLabel : rowLabel}
                </span>
              </button>
            </CollapsibleTrigger>

            {/* Remove Button */}
            {canRemove && isInteractive && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                aria-label={`Remove ${label} ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Render component fields */}
            {fields && fields.length > 0 ? (
              fields.map((subField, idx) => {
                // Only render fields with names
                if (!("name" in subField) || !subField.name) {
                  return null;
                }
                return (
                  <FieldRenderer
                    key={(subField as { name: string }).name || idx}
                    field={subField}
                    basePath={basePath}
                    disabled={disabled}
                    readOnly={readOnly}
                  />
                );
              })
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No fields configured for this component.
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ============================================================
// Exports
// ============================================================
