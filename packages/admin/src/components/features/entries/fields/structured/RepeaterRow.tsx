"use client";

/**
 * Repeater Row Component
 *
 * A sortable, collapsible row within a repeater field.
 * Supports drag-and-drop reordering via @dnd-kit.
 *
 * @module components/entries/fields/structured/RepeaterRow
 * @since 1.0.0
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
import type { RepeaterFieldConfig, FieldConfig } from "nextly/config";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { fieldWeight } from "@admin/components/features/entries/EntryForm/FieldRow";
import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "@admin/components/icons";
import { packFieldsIntoRows } from "@admin/lib/forms/pack-fields-into-rows";
import { cn } from "@admin/lib/utils";

import { RepeaterRowLabel } from "./RepeaterRowLabel";

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

export interface RepeaterRowProps<
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
   * The repeater field configuration containing sub-fields.
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
 * RepeaterRow renders a single row within a repeater field.
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
 * <RepeaterRow
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
export function RepeaterRow<TFieldValues extends FieldValues = FieldValues>({
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
}: RepeaterRowProps<TFieldValues>) {
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
        "transition-all shadow-none border-primary/5 dark:border-primary/5 overflow-hidden",
        isDragging && "opacity-50 ring-1 ring-primary z-10"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader
          className="p-0 pl-2 pr-1 border-b border-primary/5 dark:border-primary/5 bg-primary/5/50 dark:bg-slate-900/50 hover:bg-primary/5 dark:hover:bg-slate-900/80 transition-colors"
          noBorder
        >
          <div className="flex items-center gap-2">
            {/* Drag Handle */}
            {isSortable && isInteractive && (
              <button
                type="button"
                className={cn(
                  "cursor-grab active:cursor-grabbing p-2 rounded-none",
                  "focus:outline-none",
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
                  "flex items-center gap-2 flex-1 text-left min-w-0 cursor-pointer",
                  "rounded-none px-2 py-3",
                  "focus:outline-none"
                )}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <RepeaterRowLabel index={index} field={field} data={data} />
              </button>
            </CollapsibleTrigger>

            {/* Remove Button */}
            {canRemove && isInteractive && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 mr-1"
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
                (() => {
                  const rows = packFieldsIntoRows(
                    field.fields as unknown as FieldConfig[]
                  );
                  return rows.map((row, rIdx) => {
                    const weights = row.map(fieldWeight);
                    const sum = weights.reduce((a, b) => a + b, 0);
                    const cols =
                      sum < 100
                        ? [...weights, 100 - sum].map(w => `${w}fr`).join(" ")
                        : weights.map(w => `${w}fr`).join(" ");

                    return (
                      <div
                        key={rIdx}
                        className="grid gap-6 items-start [&>*]:!w-full"
                        style={{ gridTemplateColumns: cols }}
                      >
                        {row.map((subField, idx) => {
                          if (!("name" in subField) || !subField.name) {
                            return null;
                          }
                          return (
                            <div
                              key={(subField as { name: string }).name || idx}
                            >
                              {renderField(subField, basePath, control, {
                                disabled,
                                readOnly,
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              ) : (
                // Default placeholder when no renderField provided
                <div className="text-sm text-muted-foreground bg-primary/5 rounded-none p-4  border border-primary/5 border-dashed">
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
