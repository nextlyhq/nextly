/**
 * Array Input Component
 *
 * A repeater field component for managing arrays of structured data.
 * Supports add, remove, and drag-and-drop reordering of items.
 *
 * @module components/entries/fields/structured/ArrayInput
 * @since 1.0.0
 */

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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ArrayFieldConfig, FieldConfig } from "@revnixhq/nextly/config";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { useCallback, useState } from "react";
import {
  useFieldArray,
  useFormContext,
  type Control,
  type FieldValues,
  type Path,
  type FieldArrayPath,
} from "react-hook-form";

import { Plus, ChevronDown, ChevronRight } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { ArrayRow, type RenderFieldFunction } from "./ArrayRow";

// ============================================================
// Types
// ============================================================

export interface ArrayInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Must be a valid array field path.
   */
  name: FieldArrayPath<TFieldValues>;

  /**
   * Array field configuration from collection schema.
   */
  field: ArrayFieldConfig;

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
// Helpers
// ============================================================

/**
 * Creates default values for a new array row based on field definitions.
 *
 * @param fields - Sub-field configurations
 * @returns Object with default values for each field
 */
function createDefaultRowValues(
  fields: FieldConfig[] | undefined
): Record<string, unknown> {
  const defaultValues: Record<string, unknown> = {};

  if (!fields) return defaultValues;

  for (const subField of fields) {
    // Only process fields with names (skip layout-only fields)
    if (!("name" in subField) || !subField.name) continue;

    // Get the field name (TypeScript needs help here after the type guard)
    const fieldName = (subField as { name: string }).name;

    // Use field's defaultValue if defined
    if ("defaultValue" in subField && subField.defaultValue !== undefined) {
      // Handle function default values
      defaultValues[fieldName] =
        typeof subField.defaultValue === "function"
          ? subField.defaultValue({})
          : subField.defaultValue;
    } else {
      // Set sensible defaults based on field type
      switch (subField.type) {
        case "checkbox":
          defaultValues[fieldName] = false;
          break;
        case "number":
          defaultValues[fieldName] = null;
          break;
        case "repeater":
          defaultValues[fieldName] = [];
          break;
        case "group":
          // Recursively create defaults for group fields
          if ("fields" in subField) {
            defaultValues[fieldName] = createDefaultRowValues(
              subField.fields as FieldConfig[]
            );
          } else {
            defaultValues[fieldName] = {};
          }
          break;
        default:
          // String fields, relationships, etc. default to empty/null
          defaultValues[fieldName] = null;
      }
    }
  }

  return defaultValues;
}

// ============================================================
// Component
// ============================================================

/**
 * ArrayInput provides a repeater field for managing arrays of structured data.
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
 *   <ArrayInput
 *     name="socialLinks"
 *     field={socialLinksField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With custom field rendering
 * ```tsx
 * <ArrayInput
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
 *   <ArrayInput name="items" field={itemsField} />
 * </FormProvider>
 * ```
 */
export function ArrayInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control: controlProp,
  disabled = false,
  readOnly = false,
  className,
  renderField,
}: ArrayInputProps<TFieldValues>) {
  // Get control from context if not provided
  const formContext = useFormContext<TFieldValues>();
  const control = controlProp ?? formContext?.control;

  if (!control) {
    throw new Error(
      "ArrayInput requires either a `control` prop or to be wrapped in a FormProvider."
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

  // Handle drag end - reorder items
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          move(oldIndex, newIndex);
        }
      }
    },
    [items, move]
  );

  // Handle adding a new row
  const handleAdd = useCallback(() => {
    const defaultValues = createDefaultRowValues(field.fields as FieldConfig[]);
    append(defaultValues as TFieldValues[FieldArrayPath<TFieldValues>][number]);
  }, [append, field.fields]);

  // Constraints
  const canAdd =
    !disabled &&
    !readOnly &&
    (field.maxRows === undefined || items.length < field.maxRows);

  const canRemove =
    !disabled &&
    !readOnly &&
    (field.minRows === undefined || items.length > field.minRows);

  // Check if sorting is enabled
  const isSortable = field.admin?.isSortable !== false;

  // Labels
  const singularLabel = field.labels?.singular || "Item";
  const pluralLabel = field.labels?.plural || "Items";

  // Collapsible state
  const [isOpen, setIsOpen] = useState(!field.admin?.initCollapsed);

  return (
    <Card
      className={cn(
        "shadow-none border border-slate-200 dark:border-slate-800 overflow-hidden",
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Collapsible Header */}
        <CardHeader
          className="p-3 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-800/60"
          noBorder
        >
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 flex-1 text-left",
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
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {field.label || pluralLabel}
                </span>
                <span className="text-xs text-muted-foreground ml-1">
                  ({items.length})
                </span>
              </button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="p-3 space-y-3">
            {/* Sortable List */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map(item => item.id)}
                strategy={verticalListSortingStrategy}
                disabled={!isSortable || disabled || readOnly}
              >
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <ArrayRow
                      key={item.id}
                      id={item.id}
                      index={index}
                      field={field}
                      basePath={`${name}.${index}` as Path<TFieldValues>}
                      data={item as Record<string, unknown>}
                      control={control}
                      onRemove={() => remove(index)}
                      canRemove={canRemove}
                      disabled={disabled}
                      readOnly={readOnly}
                      renderField={renderField}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Empty State */}
            {items.length === 0 && (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg bg-muted/20">
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
                <Plus className="mr-2 h-4 w-4" />
                Add {singularLabel}
              </Button>
            )}

            {/* Min Rows Warning */}
            {field.minRows !== undefined &&
              items.length < field.minRows &&
              items.length > 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  Minimum {field.minRows} {pluralLabel.toLowerCase()} required.
                  Currently have {items.length}.
                </p>
              )}

            {/* Max Rows Info */}
            {field.maxRows !== undefined && items.length >= field.maxRows && (
              <p className="text-sm text-muted-foreground">
                Maximum {field.maxRows} {pluralLabel.toLowerCase()} reached.
              </p>
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
