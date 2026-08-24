"use client";

/**
 * Repeater Input Component
 *
 * A repeater field component for managing lists of structured data.
 * Supports add, remove, and drag-and-drop reordering of items.
 *
 * @module components/entries/fields/structured/RepeaterInput
 * @since 1.0.0
 */

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
import { useCallback, useState } from "react";
import {
  useFieldArray,
  useFormContext,
  type Control,
  type FieldValues,
  type FieldArrayPath,
} from "react-hook-form";

import { Plus, ChevronDown, ChevronRight } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import {
  useSortableFieldArray,
  getFieldArrayConstraints,
  SortableFieldArrayContainer,
  RowLimitNotice,
} from "./field-array-helpers";
import { createDefaultFieldValues } from "./nested-field-defaults";
import { RepeaterRow, type RenderFieldFunction } from "./RepeaterRow";

// ============================================================
// Types
// ============================================================

export interface RepeaterInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Must be a valid repeater field path.
   */
  name: FieldArrayPath<TFieldValues>;

  /**
   * Repeater field configuration from collection schema.
   */
  field: RepeaterFieldConfig;

  /**
   * React Hook Form control object.
   * If not provided, will attempt to get from FormContext.
   */
  control?: Control<TFieldValues>;

  /**
   * Whether the entire field is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the field is read-only.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the container.
   */
  className?: string;

  /**
   * Optional function to render sub-fields within each row.
   * When provided, enables full field rendering inside array rows.
   * When not provided, rows show a placeholder with field information.
   *
   * @example
   * ```tsx
   * renderField={(field, basePath, control, options) => (
   *   <FieldRenderer
   *     field={field}
   *     basePath={basePath}
   *     control={control}
   *     {...options}
   *   />
   * )}
   * ```
   */
  renderField?: RenderFieldFunction<TFieldValues>;
}

// ============================================================
// Component
// ============================================================

/**
 * RepeaterInput provides a repeater field for managing lists of structured data.
 *
 * Features:
 * - Add/remove rows with min/max constraints
 * - Drag-and-drop reordering via @dnd-kit
 * - Keyboard-accessible drag operations
 * - Collapsible rows for complex structures
 * - Custom row labels based on content
 * - Integration with React Hook Form
 *
 * @example Basic usage
 * ```tsx
 * <FieldWrapper field={socialLinksField} error={errors.socialLinks?.message}>
 *   <RepeaterInput
 *     name="socialLinks"
 *     field={socialLinksField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With custom field rendering
 * ```tsx
 * <RepeaterInput
 *   name="faq"
 *   field={faqField}
 *   control={control}
 *   renderField={(field, basePath, control, options) => (
 *     <FieldRenderer field={field} basePath={basePath} control={control} {...options} />
 *   )}
 * />
 * ```
 *
 * @example With FormProvider (no control prop needed)
 * ```tsx
 * <FormProvider {...methods}>
 *   <RepeaterInput name="items" field={itemsField} />
 * </FormProvider>
 * ```
 */
export function RepeaterInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control: controlProp,
  disabled = false,
  readOnly = false,
  className,
  renderField,
}: RepeaterInputProps<TFieldValues>) {
  // Get control from context if not provided
  const formContext = useFormContext<TFieldValues>();
  const control = controlProp ?? formContext?.control;

  if (!control) {
    throw new Error(
      "RepeaterInput requires either a `control` prop or to be wrapped in a FormProvider."
    );
  }

  // useFieldArray for managing array state
  const {
    fields: items,
    append,
    remove,
    move,
  } = useFieldArray({
    control,
    name,
  });

  // Sensor setup for drag-and-drop
  const { sensors, handleDragEnd } = useSortableFieldArray(items, move);

  // Handle adding a new row
  const handleAdd = useCallback(() => {
    const defaultValues = createDefaultFieldValues(
      field.fields as FieldConfig[]
    );
    append(defaultValues as TFieldValues[FieldArrayPath<TFieldValues>][number]);
  }, [append, field.fields]);

  // Constraints
  const { canAdd, canRemove, isSortable } = getFieldArrayConstraints({
    count: items.length,
    minRows: field.minRows,
    maxRows: field.maxRows,
    isSortable: field.admin?.isSortable,
    disabled,
    readOnly,
  });

  // Labels
  const singularLabel = field.labels?.singular || "Item";
  const pluralLabel = field.labels?.plural || "Items";

  // Collapsible state
  const [isOpen, setIsOpen] = useState(!field.admin?.initCollapsed);

  return (
    <Card
      className={cn(
        "shadow-none  border border-border dark:border-border overflow-hidden",
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Collapsible Header */}
        <CardHeader
          className="bg-primary/5 border-b border-border dark:border-border p-0"
          noBorder
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-2 w-full text-left cursor-pointer",
                "rounded-md p-4",
                "hover-unified focus:outline-none"
              )}
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold text-foreground dark:text-muted-foreground">
                {field.label || pluralLabel}
              </span>
              <span className="text-xs text-muted-foreground ml-1">
                ({items.length})
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="p-3 space-y-3">
            {/* Sortable List */}
            <SortableFieldArrayContainer
              items={items}
              sensors={sensors}
              handleDragEnd={handleDragEnd}
              isSortable={isSortable}
              disabled={disabled}
              readOnly={readOnly}
            >
              {items.map((item, index) => (
                <RepeaterRow
                  key={item.id}
                  id={item.id}
                  index={index}
                  field={field}
                  basePath={`${name}.${index}`}
                  data={item as Record<string, unknown>}
                  control={control}
                  onRemove={() => remove(index)}
                  canRemove={canRemove}
                  disabled={disabled}
                  readOnly={readOnly}
                  renderField={renderField}
                />
              ))}
            </SortableFieldArrayContainer>

            {/* Empty State */}
            {items.length === 0 && (
              <div className="text-center py-8 text-muted-foreground  border border-border border-dashed rounded-md bg-primary/5">
                <p className="mb-1">No {pluralLabel.toLowerCase()} yet.</p>
                {canAdd && (
                  <p className="text-sm">Click the button below to add one.</p>
                )}
              </div>
            )}

            {/* Add Button */}
            {canAdd && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAdd}
                className="w-full"
                disabled={disabled}
              >
                <Plus className="h-4 w-4" />
                Add {singularLabel}
              </Button>
            )}

            {/* Min / Max Rows Notices */}
            <RowLimitNotice
              count={items.length}
              minRows={field.minRows}
              maxRows={field.maxRows}
              label={pluralLabel}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ============================================================
// Exports
// ============================================================
