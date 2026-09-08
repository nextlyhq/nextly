"use client";

/**
 * Component Input
 *
 * A field component for rendering Component fields (reusable field groups)
 * within Collection and Single entry forms.
 *
 * Supports four modes:
 * - **Single component, non-repeatable:** Renders component fields inline (like GroupInput)
 * - **Single component, repeatable:** List of same component type (like RepeaterInput)
 * - **Multi-component, non-repeatable:** Single instance with type selector
 * - **Multi-component, repeatable:** Dynamic zone - array of mixed component types
 *
 * @module components/entries/fields/structured/ComponentInput
 * @since 1.0.0
 */

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
} from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import {
  extractFieldGroupReferences,
  readFieldGroupType,
} from "nextly/field-group-type";
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
import {
  useSortableFieldArray,
  getFieldArrayConstraints,
  SortableFieldArrayContainer,
  RowLimitNotice,
} from "./field-array-helpers";
import { createDefaultFieldValues } from "./nested-field-defaults";

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
  // Both storage spellings: the one on disk today and the one the storage
  // migration moves to. A definition arriving under the migrated token must
  // still render as a component field, not an unknown type.
  type: "component" | "fieldGroup";
  label?: string;

  /** Single component mode: component slug */
  component?: string;
  /**
   * The migrated spelling of `component`, on definitions rewritten by the
   * storage migration. Read through `extractFieldGroupReferences`, which
   * resolves either spelling.
   */
  fieldGroup?: string;
  /** Multi-component mode: array of component slugs */
  components?: string[];
  /** The migrated spelling of `components`. Read through the same extractor. */
  fieldGroups?: string[];

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
 * Reference keys resolve through the shared extractor, so either spelling —
 * `components` today, `fieldGroups` after the storage migration — is seen.
 */
function isMultiComponentMode(field: EnrichedComponentFieldConfig): boolean {
  const { many } = extractFieldGroupReferences(field);
  return many !== undefined && many.length > 0;
}

/**
 * Gets the component slug for single-component mode.
 */
function getSingleComponentSlug(
  field: EnrichedComponentFieldConfig
): string | undefined {
  return extractFieldGroupReferences(field).single;
}

/**
 * Gets available component slugs for multi-component mode.
 */
function getAvailableComponentSlugs(
  field: EnrichedComponentFieldConfig
): string[] {
  return extractFieldGroupReferences(field).many ?? [];
}

interface ComponentSubFieldListProps {
  fields: FieldConfig[];
  basePath: string;
  disabled?: boolean;
  readOnly?: boolean;
  emptyMessage?: string;
}

/**
 * Centralizes named-field rendering and empty-state display across all component
 * rendering modes (single non-repeatable, single repeatable, multi non-repeatable).
 * Ensures consistent filtering of nameless layout fields and uniform empty state messages.
 */
function ComponentSubFieldList({
  fields,
  basePath,
  disabled,
  readOnly,
  emptyMessage,
}: ComponentSubFieldListProps) {
  return (
    <>
      {fields.map((subField, idx) => {
        if (!("name" in subField) || !subField.name) return null;
        return (
          <FieldRenderer
            key={(subField as { name: string }).name || idx}
            field={subField}
            basePath={basePath}
            disabled={disabled}
            readOnly={readOnly}
          />
        );
      })}
      {fields.length === 0 && emptyMessage && (
        <p className="text-sm text-muted-foreground text-center py-3">
          {emptyMessage}
        </p>
      )}
    </>
  );
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

function getSingleComponentLabel(field: EnrichedComponentFieldConfig): string {
  if (field.label) return field.label;
  const { single } = extractFieldGroupReferences(field);
  const schemaLabel = single
    ? field.componentSchemas?.[single]?.label
    : undefined;
  return schemaLabel || single || "Field Group";
}

function SingleComponentSidebar({
  name,
  field,
  componentFields,
  label,
  disabled,
  readOnly,
}: SingleComponentNonRepeatableProps & { label: string }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div
      className={cn("flex flex-col relative -mt-px", field.admin?.className)}
    >
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className={cn(
          "w-full flex items-center justify-between bg-primary/5 px-8 py-4 transition-all duration-200 cursor-pointer",
          "border-y border-border hover:border-primary relative z-10"
        )}
      >
        <span className="text-xs font-bold tracking-[0.08em] uppercase text-foreground">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-foreground transition-transform duration-200",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
        />
      </button>

      {isOpen && (
        <div className="space-y-4 px-6 pt-4 pb-4 border-b border-border z-0">
          {field.admin?.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {field.admin.description}
            </p>
          )}
          <ComponentSubFieldList
            fields={componentFields}
            basePath={name}
            disabled={disabled}
            readOnly={readOnly}
            emptyMessage="No fields configured."
          />
        </div>
      )}
    </div>
  );
}

function SingleComponentCard({
  name,
  field,
  componentFields,
  label,
  disabled,
  readOnly,
}: SingleComponentNonRepeatableProps & { label: string }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div
      className={cn(
        "border border-border dark:border-border shadow-none rounded-md overflow-hidden",
        field.admin?.className
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-primary/5 hover:bg-primary/5 dark:hover:bg-accent transition-colors border-b border-border dark:border-border"
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

      {isOpen && (
        <div className="p-4 space-y-4">
          {field.admin?.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {field.admin.description}
            </p>
          )}
          <ComponentSubFieldList
            fields={componentFields}
            basePath={name}
            disabled={disabled}
            readOnly={readOnly}
            emptyMessage="No fields configured for this field group."
          />
        </div>
      )}
    </div>
  );
}

function SingleComponentNonRepeatable(
  props: SingleComponentNonRepeatableProps
) {
  const label = getSingleComponentLabel(props.field);
  if (props.field.admin?.position === "sidebar") {
    return <SingleComponentSidebar {...props} label={label} />;
  }
  return <SingleComponentCard {...props} label={label} />;
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

function MultiComponentTypeSelector({
  currentType,
  availableSlugs,
  componentSchemas,
  onChange,
  disabled,
}: {
  currentType: string | undefined;
  availableSlugs: string[];
  componentSchemas: Record<string, ComponentSchema>;
  onChange: (type: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Field Group</label>
      <Select
        value={currentType || ""}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a field group..." />
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
  );
}

function MultiComponentHeader({
  label,
  description,
  canClear,
  onClear,
}: {
  label: string;
  description?: string;
  canClear: boolean;
  onClear: () => void;
}) {
  return (
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-muted-foreground" />
          {label}
        </CardTitle>
        {canClear && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClear}
            className="text-muted-foreground hover:text-destructive"
          >
            Clear
          </Button>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {description}
        </p>
      )}
    </CardHeader>
  );
}

function MultiComponentContent({
  currentType,
  currentFields,
  name,
  disabled,
  readOnly,
}: {
  currentType: string | undefined;
  currentFields: FieldConfig[];
  name: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  if (!currentType) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4 border border-border border-dashed rounded-md bg-primary/5">
        Select a field group to add fields.
      </p>
    );
  }
  if (currentFields.length === 0) {
    return null;
  }
  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <ComponentSubFieldList
        fields={currentFields}
        basePath={name}
        disabled={disabled}
        readOnly={readOnly}
      />
    </div>
  );
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

  const currentData = watch(name) as Record<string, unknown> | null;
  const currentType = readFieldGroupType(currentData);
  const currentSchema = currentType ? componentSchemas[currentType] : null;
  const currentFields = currentSchema?.fields || [];

  const handleTypeChange = useCallback(
    (newType: string) => {
      const newSchema = componentSchemas[newType];
      const defaultValues = createDefaultFieldValues(newSchema?.fields, {
        componentType: newType,
      });
      setValue(name, defaultValues, { shouldDirty: true });
    },
    [componentSchemas, name, setValue]
  );

  const handleClear = useCallback(() => {
    setValue(name, null, { shouldDirty: true });
  }, [name, setValue]);

  const label = field.label || "Field Group";
  const isInteractive = !disabled && !readOnly;

  return (
    <Card className={cn("", field.admin?.className)}>
      <MultiComponentHeader
        label={label}
        description={field.admin?.description}
        canClear={Boolean(currentType && isInteractive)}
        onClear={handleClear}
      />
      <CardContent className="space-y-4">
        <MultiComponentTypeSelector
          currentType={currentType}
          availableSlugs={availableSlugs}
          componentSchemas={componentSchemas}
          onChange={handleTypeChange}
          disabled={!isInteractive}
        />
        <MultiComponentContent
          currentType={currentType}
          currentFields={currentFields}
          name={name}
          disabled={disabled}
          readOnly={readOnly}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================
// Repeatable Component (Single or Multi) - Like RepeaterInput
// ============================================================

/**
 * Resolves the field list and display label for a single repeatable-component row.
 *
 * Extracted from the items.map() callback so that each function stays within the
 * project's cyclomatic-complexity threshold.
 */
function resolveRepeatableRowData(
  itemData: Record<string, unknown>,
  isMultiMode: boolean,
  componentSchemas: Record<string, ComponentSchema> | undefined,
  singleComponentFields: FieldConfig[] | undefined,
  singularLabel: string
): {
  rowFields: FieldConfig[];
  rowLabel: string;
  itemComponentType: string | undefined;
} {
  const itemComponentType = readFieldGroupType(itemData);
  if (isMultiMode) {
    const schema =
      itemComponentType && componentSchemas
        ? componentSchemas[itemComponentType]
        : undefined;
    return {
      rowFields: schema ? schema.fields : [],
      rowLabel: schema?.label ?? itemComponentType ?? "Unknown",
      itemComponentType,
    };
  }
  return {
    rowFields: singleComponentFields ?? [],
    rowLabel: singularLabel,
    itemComponentType,
  };
}

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

function RepeatableEmptyState({
  pluralLabel,
  canAdd,
}: {
  pluralLabel: string;
  canAdd: boolean;
}) {
  return (
    <div className="text-center py-8 text-muted-foreground border border-border border-dashed rounded-md bg-primary/5">
      <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p className="mb-1">No {pluralLabel.toLowerCase()} yet.</p>
      {canAdd && <p className="text-sm">Click the button below to add one.</p>}
    </div>
  );
}

/**
 * Repeatable Add Button Component
 *
 * Encapsulates and owns the component-selector popover state, providing a unified
 * add affordance for both single-component (direct append) and multi-component
 * (type selector popover) repeatable flows without duplicating append handlers.
 */
function RepeatableAddButton({
  isMultiMode,
  singularLabel,
  pluralLabel,
  disabled,
  onAdd,
  componentSchemas,
  availableSlugs,
}: {
  isMultiMode: boolean;
  singularLabel: string;
  pluralLabel: string;
  disabled?: boolean;
  onAdd: (type?: string) => void;
  componentSchemas?: Record<string, ComponentSchema>;
  availableSlugs: string[];
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);

  if (isMultiMode) {
    return (
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setSelectorOpen(true)}
          className="w-full"
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
          Add {singularLabel}
        </Button>
        <ComponentSelector
          open={selectorOpen}
          onOpenChange={setSelectorOpen}
          componentSchemas={componentSchemas || {}}
          availableSlugs={availableSlugs}
          onSelect={onAdd}
          title={`Add ${singularLabel}`}
          description={`Choose a field group to add to ${pluralLabel.toLowerCase()}.`}
        />
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => onAdd()}
        className="w-full"
        disabled={disabled}
      >
        <Plus className="h-4 w-4" />
        Add {singularLabel}
      </Button>
    </div>
  );
}

function getFieldsForDefaults(
  isMultiMode: boolean,
  componentType: string | undefined,
  componentSchemas: Record<string, ComponentSchema> | undefined,
  singleComponentFields: FieldConfig[] | undefined
): FieldConfig[] | undefined {
  if (isMultiMode) {
    return componentType && componentSchemas
      ? componentSchemas[componentType]?.fields
      : undefined;
  }
  return singleComponentFields;
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
  const { sensors, handleDragEnd } = useSortableFieldArray(items, move);

  // Handle adding a new row
  const handleAdd = useCallback(
    (componentType?: string) => {
      const fieldsForDefaults = getFieldsForDefaults(
        isMultiMode,
        componentType,
        componentSchemas,
        singleComponentFields
      );

      const defaultValues = createDefaultFieldValues(
        fieldsForDefaults,
        isMultiMode && componentType ? { componentType } : undefined
      );

      append(
        defaultValues as TFieldValues[FieldArrayPath<TFieldValues>][number]
      );
    },
    [append, isMultiMode, singleComponentFields, componentSchemas]
  );

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
  const singularLabel = field.label || "Field Group";
  const pluralLabel = field.label ? `${field.label}s` : "Field Groups";

  return (
    <div className={cn("space-y-3", field.admin?.className)}>
      {/* Sortable List */}
      <SortableFieldArrayContainer
        items={items}
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        isSortable={isSortable}
        disabled={disabled}
        readOnly={readOnly}
      >
        {items.map((item, index) => {
          const itemData = item as Record<string, unknown>;
          const { rowFields, rowLabel, itemComponentType } =
            resolveRepeatableRowData(
              itemData,
              isMultiMode,
              componentSchemas,
              singleComponentFields,
              singularLabel
            );

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
      </SortableFieldArrayContainer>

      {/* Empty State */}
      {items.length === 0 && (
        <RepeatableEmptyState pluralLabel={pluralLabel} canAdd={canAdd} />
      )}

      {/* Add Button(s) */}
      {canAdd && (
        <RepeatableAddButton
          isMultiMode={isMultiMode}
          singularLabel={singularLabel}
          pluralLabel={pluralLabel}
          disabled={disabled}
          onAdd={handleAdd}
          componentSchemas={componentSchemas}
          availableSlugs={availableSlugs}
        />
      )}

      {/* Min / Max Rows Notices */}
      <RowLimitNotice
        count={items.length}
        minRows={field.minRows}
        maxRows={field.maxRows}
        label={pluralLabel}
      />
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
        "rounded-lg  border border-border border-warning-200 bg-warning-50 dark:border-warning-900 dark:bg-warning-950 p-4",
        className
      )}
    >
      <p className="text-sm text-warning-700 dark:text-warning-300">
        <strong>Field group field:</strong> {field.name}
      </p>
      <p className="text-xs text-warning-600 dark:text-warning-400 mt-1">
        Schema data not available. Ensure the collection schema API returns
        enriched field-group fields.
      </p>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
