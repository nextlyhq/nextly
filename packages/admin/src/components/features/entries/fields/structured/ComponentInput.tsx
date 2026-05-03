"use client";

/**
 * Component Input
 *
 * A field component for rendering Component fields (reusable field groups)
 * within Collection and Single entry forms.
 *
 * Supports four modes:
 * - **Single component, non-repeatable:** Renders component fields inline (like GroupInput)
 * - **Single component, repeatable:** Array of same component type (like ArrayInput)
 * - **Multi-component, non-repeatable:** Single instance with type selector
 * - **Multi-component, repeatable:** Dynamic zone - array of mixed component types
 *
 * @module components/entries/fields/structured/ComponentInput
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
import type { FieldConfig } from "@revnixhq/nextly/config";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { useCallback, useMemo, useState } from "react";
import {
  useFieldArray,
  useFormContext,
  type Control,
  type FieldValues,
  type FieldArrayPath,
} from "react-hook-form";

import { Plus, Puzzle, ChevronDown } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { FieldRenderer } from "../FieldRenderer";

import { ComponentRow } from "./ComponentRow";
import { ComponentSelector } from "./ComponentSelector";

// ============================================================
// Types
// ============================================================

/**
 * Schema information for a single component type.
 * Populated by the backend's enrichFieldsWithComponentSchemas().
 */
export interface ComponentSchema {
  /** Display label for the component */
  label: string;
  /** Field configurations for the component */
  fields: FieldConfig[];
  /** Admin options (category, icon, description, imageURL) */
  admin?: {
    category?: string;
    icon?: string;
    description?: string;
    imageURL?: string;
  };
}

/**
 * Extended component field config with enriched schema data.
 * The API enriches component fields with componentFields (single mode)
 * or componentSchemas (multi mode).
 */
export interface EnrichedComponentFieldConfig {
  name: string;
  type: "component";
  label?: string;

  /** Single component mode: component slug */
  component?: string;
  /** Multi-component mode: array of component slugs */
  components?: string[];

  /** Whether this field is repeatable (array of instances) */
  repeatable?: boolean;
  /** Minimum number of instances (when repeatable) */
  minRows?: number;
  /** Maximum number of instances (when repeatable) */
  maxRows?: number;

  /** Admin options */
  admin?: {
    initCollapsed?: boolean;
    isSortable?: boolean;
    description?: string;
    className?: string;
    /** Field placement: 'sidebar' | 'main' */
    position?: "sidebar" | "main";
  };

  /** Single mode: enriched component fields */
  componentFields?: FieldConfig[];
  /** Multi mode: enriched component schemas by slug */
  componentSchemas?: Record<string, ComponentSchema>;
}

export interface ComponentInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   */
  name: string;

  /**
   * Component field configuration with enriched schema data.
   */
  field: EnrichedComponentFieldConfig;

  /**
   * Base path for nested fields.
   */
  basePath?: string;

  /**
   * React Hook Form control object.
   */
  control?: Control<TFieldValues>;

  /**
   * Whether the field is disabled.
   */
  disabled?: boolean;

  /**
   * Whether the field is read-only.
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Determines if the component field is in multi-component (dynamic zone) mode.
 */
function isMultiComponentMode(field: EnrichedComponentFieldConfig): boolean {
  return Array.isArray(field.components) && field.components.length > 0;
}

/**
 * Gets the component slug for single-component mode.
 */
function getSingleComponentSlug(
  field: EnrichedComponentFieldConfig
): string | undefined {
  return field.component;
}

/**
 * Gets available component slugs for multi-component mode.
 */
function getAvailableComponentSlugs(
  field: EnrichedComponentFieldConfig
): string[] {
  return field.components || [];
}

/**
 * Creates default values for a new component instance.
 */
function createDefaultComponentValues(
  fields: FieldConfig[] | undefined,
  componentType?: string
): Record<string, unknown> {
  const defaultValues: Record<string, unknown> = {};

  // Add _componentType for multi-component mode
  if (componentType) {
    defaultValues._componentType = componentType;
  }

  if (!fields) return defaultValues;

  for (const subField of fields) {
    // Only process fields with names
    if (!("name" in subField) || !subField.name) continue;

    const fieldName = (subField as { name: string }).name;

    // Use field's defaultValue if defined
    if ("defaultValue" in subField && subField.defaultValue !== undefined) {
      defaultValues[fieldName] =
        typeof subField.defaultValue === "function"
          ? subField.defaultValue({})
          : subField.defaultValue;
    } else {
      // Set sensible defaults based on field type
      const subFieldType = subField.type as string;
      switch (subFieldType) {
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
          if ("fields" in subField) {
            defaultValues[fieldName] = createDefaultComponentValues(
              subField.fields as FieldConfig[],
              undefined
            );
          } else {
            defaultValues[fieldName] = {};
          }
          break;
        case "component":
          // Nested components default to null (single) or [] (repeatable)
          if ("repeatable" in subField && subField.repeatable) {
            defaultValues[fieldName] = [];
          } else {
            defaultValues[fieldName] = null;
          }
          break;
        default:
          defaultValues[fieldName] = null;
      }
    }
  }

  return defaultValues;
}

// ============================================================
// Single Component (Non-Repeatable) - Like GroupInput
// ============================================================

interface SingleComponentNonRepeatableProps {
  name: string;
  field: EnrichedComponentFieldConfig;
  componentFields: FieldConfig[];
  disabled?: boolean;
  readOnly?: boolean;
}

function SingleComponentNonRepeatable({
  name,
  field,
  componentFields,
  disabled,
  readOnly,
}: SingleComponentNonRepeatableProps) {
  const label =
    field.label ||
    (field.componentSchemas?.[field.component!]?.label ??
      field.component ??
      "Component");

  const isSidebar = field.admin?.position === "sidebar";
  const [isOpen, setIsOpen] = useState(true);

  // ---- Sidebar: Accordion style ----
  if (isSidebar) {
    return (
      // Wrapper has -mt-px to physically overlap previous bottom borders
      <div
        className={cn("flex flex-col relative -mt-px", field.admin?.className)}
      >
        {/* Accordion header — top and bottom  border border-primary/5 always */}
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          className={cn(
            "w-full flex items-center justify-between bg-primary/5 px-8 py-4 transition-all duration-200 cursor-pointer",
            "border-y border-primary/5 hover:border-primary/50 relative z-10"
          )}
        >
          <span className="text-[11px] font-bold tracking-[0.08em] uppercase text-primary">
            {label}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-primary transition-transform duration-200",
              isOpen ? "rotate-0" : "-rotate-90"
            )}
          />
        </button>

        {/* Accordion content */}
        {isOpen && (
          <div className="space-y-4 px-6 pt-4 pb-4  border-b border-primary/5 border-primary/5 z-0">
            {field.admin?.description && (
              <p className="text-xs text-muted-foreground">
                {field.admin.description}
              </p>
            )}
            {componentFields.map((subField, idx) => {
              if (!("name" in subField) || !subField.name) return null;
              return (
                <FieldRenderer
                  key={(subField as { name: string }).name || idx}
                  field={subField}
                  basePath={name}
                  disabled={disabled}
                  readOnly={readOnly}
                />
              );
            })}
            {componentFields.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">
                No fields configured.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Main content: Card / repeater-row style ----
  return (
    <div
      className={cn(
        "border border-primary/5 dark:border-primary/5 shadow-none rounded-none overflow-hidden",
        field.admin?.className
      )}
    >
      {/* Card header — same style as array repeater rows */}
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-primary/5/50 dark:bg-slate-900/50 hover:bg-primary/5 dark:hover:bg-slate-900 transition-colors  border-b border-primary/5 dark:border-primary/5"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200",
            !isOpen && "-rotate-90"
          )}
        />
        <span className="text-sm font-medium flex-1 text-left text-foreground">
          {label}
        </span>
      </button>

      {/* Card content */}
      {isOpen && (
        <div className="p-4 space-y-4">
          {field.admin?.description && (
            <p className="text-xs text-muted-foreground">
              {field.admin.description}
            </p>
          )}
          {componentFields.map((subField, idx) => {
            if (!("name" in subField) || !subField.name) return null;
            return (
              <FieldRenderer
                key={(subField as { name: string }).name || idx}
                field={subField}
                basePath={name}
                disabled={disabled}
                readOnly={readOnly}
              />
            );
          })}
          {componentFields.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No fields configured for this component.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Multi-Component (Non-Repeatable) - Single instance with type selector
// ============================================================

interface MultiComponentNonRepeatableProps {
  name: string;
  field: EnrichedComponentFieldConfig;
  componentSchemas: Record<string, ComponentSchema>;
  availableSlugs: string[];
  disabled?: boolean;
  readOnly?: boolean;
}

function MultiComponentNonRepeatable({
  name,
  field,
  componentSchemas,
  availableSlugs,
  disabled,
  readOnly,
}: MultiComponentNonRepeatableProps) {
  const { watch, setValue } = useFormContext();

  // Watch the current component type
  const currentData = watch(name) as Record<string, unknown> | null;
  const currentType = currentData?._componentType as string | undefined;

  // Get the schema for the current type
  const currentSchema = currentType ? componentSchemas[currentType] : null;
  const currentFields = currentSchema?.fields || [];

  // Handle type change
  const handleTypeChange = useCallback(
    (newType: string) => {
      const newSchema = componentSchemas[newType];
      const defaultValues = createDefaultComponentValues(
        newSchema?.fields,
        newType
      );
      setValue(name, defaultValues, { shouldDirty: true });
    },
    [componentSchemas, name, setValue]
  );

  // Handle clear
  const handleClear = useCallback(() => {
    setValue(name, null, { shouldDirty: true });
  }, [name, setValue]);

  const label = field.label || "Component";

  return (
    <Card className={cn("", field.admin?.className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-muted-foreground" />
            {label}
          </CardTitle>
          {currentType && !disabled && !readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive"
            >
              Clear
            </Button>
          )}
        </div>
        {field.admin?.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {field.admin.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Type Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Component Type</label>
          <Select
            value={currentType || ""}
            onValueChange={handleTypeChange}
            disabled={disabled || readOnly}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a component type..." />
            </SelectTrigger>
            <SelectContent>
              {availableSlugs.map(slug => {
                const schema = componentSchemas[slug];
                return (
                  <SelectItem key={slug} value={slug}>
                    {schema?.label || slug}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Component Fields */}
        {currentType && currentFields.length > 0 && (
          <div className="space-y-4 pt-2  border-t border-primary/5">
            {currentFields.map((subField, idx) => {
              if (!("name" in subField) || !subField.name) return null;
              return (
                <FieldRenderer
                  key={(subField as { name: string }).name || idx}
                  field={subField}
                  basePath={name}
                  disabled={disabled}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        )}

        {!currentType && (
          <p className="text-sm text-muted-foreground text-center py-4  border border-primary/5 border-dashed rounded-none bg-primary/5">
            Select a component type to add fields.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Repeatable Component (Single or Multi) - Like ArrayInput
// ============================================================

interface RepeatableComponentProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  name: string;
  field: EnrichedComponentFieldConfig;
  control: Control<TFieldValues>;
  isMultiMode: boolean;
  singleComponentFields?: FieldConfig[];
  componentSchemas?: Record<string, ComponentSchema>;
  availableSlugs: string[];
  disabled?: boolean;
  readOnly?: boolean;
}

function RepeatableComponent<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  isMultiMode,
  singleComponentFields,
  componentSchemas,
  availableSlugs,
  disabled = false,
  readOnly = false,
}: RepeatableComponentProps<TFieldValues>) {
  // useFieldArray for managing array state
  const {
    fields: items,
    append,
    remove,
    move,
  } = useFieldArray({
    control,
    name: name as FieldArrayPath<TFieldValues>,
  });

  // Sensor setup for drag-and-drop
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
  const handleAdd = useCallback(
    (componentType?: string) => {
      let fieldsForDefaults: FieldConfig[] | undefined;

      if (isMultiMode && componentType && componentSchemas) {
        fieldsForDefaults = componentSchemas[componentType]?.fields;
      } else if (!isMultiMode && singleComponentFields) {
        fieldsForDefaults = singleComponentFields;
      }

      const defaultValues = createDefaultComponentValues(
        fieldsForDefaults,
        isMultiMode ? componentType : undefined
      );

      append(
        defaultValues as TFieldValues[FieldArrayPath<TFieldValues>][number]
      );
    },
    [append, isMultiMode, singleComponentFields, componentSchemas]
  );

  // State for component selector dialog (multi-mode only)
  const [selectorOpen, setSelectorOpen] = useState(false);

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
  const singularLabel = field.label || "Component";
  const pluralLabel = field.label ? `${field.label}s` : "Components";

  return (
    <div className={cn("space-y-3", field.admin?.className)}>
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
            {items.map((item, index) => {
              const itemData = item as Record<string, unknown>;
              const itemComponentType = itemData._componentType as
                | string
                | undefined;

              // Get fields for this row
              let rowFields: FieldConfig[];
              let rowLabel: string;

              if (isMultiMode && itemComponentType && componentSchemas) {
                const schema = componentSchemas[itemComponentType];
                rowFields = schema?.fields || [];
                rowLabel = schema?.label || itemComponentType;
              } else if (!isMultiMode && singleComponentFields) {
                rowFields = singleComponentFields;
                rowLabel = singularLabel;
              } else {
                rowFields = [];
                rowLabel = "Unknown";
              }

              return (
                <ComponentRow
                  key={item.id}
                  id={item.id}
                  index={index}
                  label={rowLabel}
                  componentType={itemComponentType}
                  fields={rowFields}
                  basePath={`${name}.${index}`}
                  data={itemData}
                  control={control}
                  onRemove={() => remove(index)}
                  canRemove={canRemove}
                  disabled={disabled}
                  readOnly={readOnly}
                  initCollapsed={field.admin?.initCollapsed}
                  isSortable={isSortable}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Empty State */}
      {items.length === 0 && (
        <div className="text-center py-8 text-muted-foreground  border border-primary/5 border-dashed rounded-none bg-primary/5">
          <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="mb-1">No {pluralLabel.toLowerCase()} yet.</p>
          {canAdd && (
            <p className="text-sm">Click the button below to add one.</p>
          )}
        </div>
      )}

      {/* Add Button(s) */}
      {canAdd && (
        <div className="flex gap-2">
          {isMultiMode ? (
            // Multi-mode: Open component selector dialog
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectorOpen(true)}
                className="w-full"
                disabled={disabled}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add {singularLabel}
              </Button>
              <ComponentSelector
                open={selectorOpen}
                onOpenChange={setSelectorOpen}
                componentSchemas={componentSchemas || {}}
                availableSlugs={availableSlugs}
                onSelect={handleAdd}
                title={`Add ${singularLabel}`}
                description={`Choose a component type to add to ${pluralLabel.toLowerCase()}.`}
              />
            </>
          ) : (
            // Single-mode: Simple add button
            <Button
              type="button"
              variant="outline"
              onClick={() => handleAdd()}
              className="w-full"
              disabled={disabled}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add {singularLabel}
            </Button>
          )}
        </div>
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
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

/**
 * ComponentInput - Renders component fields in entry forms
 *
 * Handles four scenarios based on field configuration:
 * 1. Single component, non-repeatable: Like GroupInput
 * 2. Single component, repeatable: Array of same component type
 * 3. Multi-component, non-repeatable: Single instance with type selector
 * 4. Multi-component, repeatable: Dynamic zone with mixed types
 *
 * @example Single component (non-repeatable)
 * ```tsx
 * <ComponentInput
 *   name="seo"
 *   field={{
 *     name: 'seo',
 *     type: 'component',
 *     component: 'seo',
 *     componentFields: [{ name: 'metaTitle', type: 'text' }, ...]
 *   }}
 * />
 * ```
 *
 * @example Multi-component repeatable (dynamic zone)
 * ```tsx
 * <ComponentInput
 *   name="layout"
 *   field={{
 *     name: 'layout',
 *     type: 'component',
 *     components: ['hero', 'cta', 'content'],
 *     repeatable: true,
 *     componentSchemas: {
 *       hero: { label: 'Hero', fields: [...] },
 *       cta: { label: 'Call to Action', fields: [...] },
 *       content: { label: 'Content', fields: [...] },
 *     }
 *   }}
 * />
 * ```
 */
export function ComponentInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control: controlProp,
  disabled = false,
  readOnly = false,
  className,
}: ComponentInputProps<TFieldValues>) {
  // Get control from context if not provided
  const formContext = useFormContext<TFieldValues>();
  const control = controlProp ?? formContext?.control;

  if (!control) {
    throw new Error(
      "ComponentInput requires either a `control` prop or to be wrapped in a FormProvider."
    );
  }

  // Determine mode
  const isMultiMode = isMultiComponentMode(field);
  const isRepeatable = field.repeatable === true;

  // Get component data
  const singleSlug = getSingleComponentSlug(field);
  const availableSlugs = isMultiMode
    ? getAvailableComponentSlugs(field)
    : singleSlug
      ? [singleSlug]
      : [];

  // Get enriched schema data
  const componentFields = field.componentFields;
  const componentSchemas = field.componentSchemas;

  // Memoize schemas for stability
  const memoizedSchemas = useMemo(
    () => componentSchemas || {},
    [componentSchemas]
  );

  // =========================================
  // Render based on mode
  // =========================================

  // Single component, non-repeatable
  if (!isMultiMode && !isRepeatable && componentFields) {
    return (
      <div className={className}>
        <SingleComponentNonRepeatable
          name={name}
          field={field}
          componentFields={componentFields}
          disabled={disabled}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // Multi-component, non-repeatable
  if (isMultiMode && !isRepeatable && componentSchemas) {
    return (
      <div className={className}>
        <MultiComponentNonRepeatable
          name={name}
          field={field}
          componentSchemas={componentSchemas}
          availableSlugs={availableSlugs}
          disabled={disabled}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // Repeatable (single or multi)
  if (isRepeatable) {
    return (
      <div className={className}>
        <RepeatableComponent
          name={name}
          field={field}
          control={control}
          isMultiMode={isMultiMode}
          singleComponentFields={componentFields}
          componentSchemas={memoizedSchemas}
          availableSlugs={availableSlugs}
          disabled={disabled}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // Fallback: Missing schema data
  return (
    <div
      className={cn(
        "rounded-none  border border-primary/5 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 p-4",
        className
      )}
    >
      <p className="text-sm text-amber-700 dark:text-amber-300">
        <strong>Component field:</strong> {field.name}
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
        Schema data not available. Ensure the collection schema API returns
        enriched component fields.
      </p>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
