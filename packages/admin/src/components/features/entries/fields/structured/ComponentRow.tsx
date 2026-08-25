"use client";

/**
 * Component Row
 *
 * A sortable, collapsible row within a repeatable component field.
 * Supports drag-and-drop reordering via @dnd-kit.
 *
 * Similar to RepeaterRow but adapted for component instances with
 * component type badges and component-specific field rendering.
 *
 * @module components/entries/fields/structured/ComponentRow
 * @since 1.0.0
 */

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import type { Control, FieldValues } from "react-hook-form";

import { FieldRow } from "@admin/components/features/entries/EntryForm/FieldRow";
import { ChevronDown, ChevronRight, Puzzle } from "@admin/components/icons";
import { packFieldsIntoRows } from "@admin/lib/forms/pack-fields-into-rows";
import { cn } from "@admin/lib/utils";

import {
  useSortableRow,
  RowDragHandle,
  RowRemoveButton,
} from "./field-array-helpers";

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

interface ComponentRowHeaderProps {
  index: number;
  label: string;
  componentType?: string;
  rowLabel: string;
  isOpen: boolean;
  isSortable: boolean;
  isInteractive: boolean;
  canRemove: boolean;
  onRemove?: () => void;
  attributes: ReturnType<typeof useSortableRow>["attributes"];
  listeners: ReturnType<typeof useSortableRow>["listeners"];
}

/**
 * Centralized header for draggable, collapsible component rows.
 *
 * Encapsulates the drag handle, expand/collapse chevron trigger, component icon,
 * dynamic-zone component type badge, dynamic row label, and remove button.
 * Centralizing these controls in a single subcomponent maintains consistent layout,
 * accessible ARIA attributes, touch behavior, and hover transitions across component instances.
 */
function ComponentRowHeader({
  index,
  label,
  componentType,
  rowLabel,
  isOpen,
  isSortable,
  isInteractive,
  canRemove,
  onRemove,
  attributes,
  listeners,
}: ComponentRowHeaderProps) {
  return (
    <CardHeader
      className="p-0 pl-2 pr-1 border-b border-border dark:border-border bg-primary/5 hover:bg-primary/5 dark:hover:bg-accent/80 transition-colors"
      noBorder
    >
      <div className="flex items-center gap-2">
        <RowDragHandle
          isSortable={isSortable}
          isInteractive={isInteractive}
          attributes={attributes}
          listeners={listeners}
          ariaLabel={`Drag to reorder ${label} ${index + 1}`}
        />

        {/* Collapse Toggle + Label */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 flex-1 text-left min-w-0 cursor-pointer",
              "rounded-md px-2 py-3",
              "focus:outline-none"
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
                {componentType}
              </Badge>
            )}

            {/* Row label */}
            <span className="truncate text-sm font-medium">{rowLabel}</span>
          </button>
        </CollapsibleTrigger>

        <RowRemoveButton
          canRemove={canRemove}
          isInteractive={isInteractive}
          onRemove={onRemove}
          ariaLabel={`Remove ${label} ${index + 1}`}
        />
      </div>
    </CardHeader>
  );
}

/**
 * ComponentRow Component
 *
 * Renders a single draggable, collapsible row within a repeatable component field.
 *
 * @example
 * ```tsx
 * <ComponentRow
 *   id="comp-1"
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
  const {
    isOpen,
    setIsOpen,
    attributes,
    listeners,
    setNodeRef,
    style,
    isDragging,
    isInteractive,
  } = useSortableRow({
    id,
    initCollapsed,
    disabled,
    readOnly,
    isSortable,
  });

  // Generate dynamic label
  const rowLabel = generateRowLabel(index, label, data);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        // The collapsible header tints itself edge to edge, so without clipping
        // that fill paints square across the card's rounded top corners at any
        // nonzero --radius. Matches the other structured-field cards.
        "overflow-hidden transition-shadow",
        isDragging && "opacity-50 ring-2 ring-primary shadow-lg z-10"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <ComponentRowHeader
          index={index}
          label={label}
          componentType={componentType}
          rowLabel={rowLabel}
          isOpen={isOpen}
          isSortable={isSortable}
          isInteractive={isInteractive}
          canRemove={canRemove}
          onRemove={onRemove}
          attributes={attributes}
          listeners={listeners}
        />

        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Render component fields */}
            {fields && fields.length > 0 ? (
              packFieldsIntoRows(fields).map((row, i) => (
                <FieldRow
                  key={i}
                  fields={row}
                  basePath={basePath}
                  disabled={disabled}
                  readOnly={readOnly}
                />
              ))
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No fields configured for this field group.
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
