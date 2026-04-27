/**
 * Array Row Component
 *
 * A sortable, collapsible row within an array field.
 * Supports drag-and-drop reordering via @dnd-kit.
 *
 * @module components/entries/fields/structured/ArrayRow
 * @since 1.0.0
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RepeaterFieldConfig, FieldConfig } from "@revnixhq/nextly/config";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { ArrayRowLabel } from "./ArrayRowLabel";

// ============================================================
// Types
// ============================================================

/**
 * Function type for rendering sub-fields within an array row.
 * This allows injection of FieldRenderer or custom rendering logic.
 */
export type RenderFieldFunction<
  TFieldValues extends FieldValues = FieldValues,
> = (
  field: FieldConfig,
  basePath: string,
  control: Control<TFieldValues>,
  options: {
    disabled?: boolean;
    readOnly?: boolean;
  }
) => ReactNode;

export interface ArrayRowProps<TFieldValues extends FieldValues = FieldValues> {
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
   * The array field configuration containing sub-fields.
   */
  field: RepeaterFieldConfig;

  /**
   * Base path for form field registration (e.g., "items.0").
   */
  basePath: string;

  /**
   * The current data for this row.
   */
  data: Record<string, unknown>;

  /**
   * React Hook Form control object.
   */
  control: Control<TFieldValues>;

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
   * Optional function to render sub-fields.
   * When not provided, renders a placeholder for sub-field content.
   */
  renderField?: RenderFieldFunction<TFieldValues>;
}

// ============================================================
// Component
// ============================================================

/**
 * ArrayRow renders a single row within an array field.
 *
 * Features:
 * - Drag handle for reordering via @dnd-kit
 * - Collapsible content with smooth animation
 * - Dynamic row labels based on content
 * - Remove button with disabled state
 * - Visual feedback during drag operations
 *
 * @example
 * ```tsx
 * <ArrayRow
 *   id={item.id}
 *   index={0}
 *   field={repeaterFieldConfig}
 *   basePath="socialLinks.0"
 *   data={item}
 *   control={control}
 *   onRemove={() => remove(0)}
 *   canRemove={fields.length > minRows}
 * />
 * ```
 */
export function ArrayRow<TFieldValues extends FieldValues = FieldValues>({
  id,
  index,
  field,
  basePath,
  data,
  control,
  onRemove,
  canRemove,
  disabled = false,
  readOnly = false,
  renderField,
}: ArrayRowProps<TFieldValues>) {
  // Collapsible state - respect initCollapsed from field config
  const [isOpen, setIsOpen] = useState(!field.admin?.initCollapsed);

  // Check if sorting is enabled (defaults to true)
  const isSortable = field.admin?.isSortable !== false;

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

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "transition-all shadow-none border-slate-200 dark:border-slate-800 overflow-hidden",
        isDragging && "opacity-50 ring-1 ring-primary z-10"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader
          className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
          noBorder
        >
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
                aria-label={`Drag to reorder ${field.labels?.singular || "item"} ${index + 1}`}
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
                  "flex items-center gap-2 flex-1 text-left min-w-0",
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
                <ArrayRowLabel index={index} field={field} data={data} />
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
                aria-label={`Remove ${field.labels?.singular || "item"} ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="p-5 pt-5 space-y-6">
            {/* Render sub-fields */}
            {field.fields && field.fields.length > 0 ? (
              renderField ? (
                // Use provided renderField function
                field.fields.map(subField => {
                  // Only render fields with names (skip layout-only fields for now)
                  if (!("name" in subField) || !subField.name) {
                    return null;
                  }
                  return (
                    <div key={(subField as { name: string }).name}>
                      {renderField(
                        subField,
                        basePath,
                        control,
                        {
                          disabled,
                          readOnly,
                        }
                      )}
                    </div>
                  );
                })
              ) : (
                // Default placeholder when no renderField provided
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-4 border border-dashed">
                  <p className="font-medium mb-2">Sub-fields:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {field.fields.map((subField, idx) => {
                      const fieldWithName = subField as {
                        name?: string;
                        type: string;
                      };
                      return (
                        <li key={fieldWithName.name || idx}>
                          {fieldWithName.name ? (
                            <>
                              <span className="font-mono text-xs">
                                {fieldWithName.name}
                              </span>
                              <span className="text-muted-foreground/70">
                                {" "}
                                ({fieldWithName.type})
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground/70">
                              {fieldWithName.type} (layout)
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-muted-foreground/70 mt-3 italic">
                    Full field rendering will be available when FieldRenderer is
                    integrated.
                  </p>
                </div>
              )
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No sub-fields configured for this array.
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
