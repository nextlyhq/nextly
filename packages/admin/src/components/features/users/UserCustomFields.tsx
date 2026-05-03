"use client";

/**
 * UserCustomFields Component
 *
 * Dynamic field renderer for custom user fields defined via `defineConfig()`
 * or the admin Settings > User Fields UI. Fetches merged field definitions
 * from the server and renders the appropriate input component for each field
 * type, integrated with react-hook-form.
 *
 * Fields are registered under a `customFields.{name}` path prefix to avoid
 * collisions with standard user fields (name, email, password, etc.).
 *
 * Reuses existing entry field input components (TextInput, SelectInput, etc.)
 * via a `toFieldConfig()` adapter for consistent look & feel.
 *
 * @module components/users/UserCustomFields
 */

import type {
  CheckboxFieldConfig,
  DateFieldConfig,
  EmailFieldConfig,
  FieldConfig,
  NumberFieldConfig,
  RadioFieldConfig,
  SelectFieldConfig,
  TextareaFieldConfig,
  TextFieldConfig,
} from "@revnixhq/nextly/config";
import { Skeleton } from "@revnixhq/ui";
import { useMemo } from "react";
import type { Control, FieldErrors, FieldValues } from "react-hook-form";

import { FieldWrapper } from "@admin/components/features/entries/fields/FieldWrapper";
import { NumberInput } from "@admin/components/features/entries/fields/number/NumberInput";
import { CheckboxInput } from "@admin/components/features/entries/fields/selection/CheckboxInput";
import { DateInput } from "@admin/components/features/entries/fields/selection/DateInput";
import { RadioInput } from "@admin/components/features/entries/fields/selection/RadioInput";
import { SelectInput } from "@admin/components/features/entries/fields/selection/SelectInput";
import { EmailInput } from "@admin/components/features/entries/fields/text/EmailInput";
import { TextareaInput } from "@admin/components/features/entries/fields/text/TextareaInput";
import { TextInput } from "@admin/components/features/entries/fields/text/TextInput";
import { useUserFields } from "@admin/hooks/queries/useUserFields";
import type { UserFieldDefinitionRecord } from "@admin/services/userFieldsApi";

// ============================================================================
// Constants
// ============================================================================

/** Prefix for custom field form paths to avoid collisions with standard fields */
const CUSTOM_FIELD_PREFIX = "customFields";

// ============================================================================
// Types
// ============================================================================

export interface UserCustomFieldsProps {
  /** react-hook-form control from the parent form */
  control: Control<FieldValues>;
  /** react-hook-form errors from the parent form */
  errors: FieldErrors<FieldValues>;
  /** Whether all fields should be disabled */
  disabled?: boolean;
  /** Section title override (defaults to "Additional Information") */
  groupLabel?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a flat `UserFieldDefinitionRecord` to a `FieldConfig`-compatible
 * object that the existing entry field input components can consume.
 *
 * Maps flat properties (placeholder, description, options) into the nested
 * `admin` structure expected by collection field components.
 */
function toFieldConfig(def: UserFieldDefinitionRecord): FieldConfig {
  const base = {
    name: def.name,
    label: def.label,
    type: def.type,
    required: def.required,
    defaultValue: def.defaultValue ?? undefined,
    admin: {
      placeholder: def.placeholder ?? undefined,
      description: def.description ?? undefined,
    },
  };

  // Add options for select/radio fields
  if ((def.type === "select" || def.type === "radio") && def.options) {
    return { ...base, options: def.options } as unknown as FieldConfig;
  }

  return base as unknown as FieldConfig;
}

/**
 * Retrieves a nested error from React Hook Form errors object.
 * Handles dot-notation paths like "customFields.phone".
 */
function getNestedError(
  errors: FieldErrors<FieldValues>,
  path: string
): string | undefined {
  const keys = path.split(".");
  let current: unknown = errors;

  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  if (
    current &&
    typeof current === "object" &&
    "message" in current &&
    typeof (current as { message?: string }).message === "string"
  ) {
    return (current as { message: string }).message;
  }

  return undefined;
}

// ============================================================================
// Component
// ============================================================================

/**
 * UserCustomFields renders dynamic form inputs for each custom user field.
 *
 * Features:
 * - Fetches merged field definitions from `GET /admin/api/user-fields`
 * - Filters to active fields only, sorted by `sortOrder`
 * - Renders appropriate input for each field type (text, textarea, email,
 *   number, select, radio, checkbox, date)
 * - Integrates with react-hook-form via `control` prop
 * - Uses `customFields.{name}` path prefix to avoid name collisions
 * - Reuses existing entry field input components via adapter pattern
 * - Responsive grid layout matching user form style
 * - Loading skeleton while fetching
 * - Graceful empty state when no custom fields configured
 *
 * @example
 * ```tsx
 * <UserCustomFields
 *   control={control}
 *   errors={errors}
 *   disabled={isSubmitting}
 * />
 * ```
 */
export function UserCustomFields({
  control,
  errors,
  disabled = false,
  groupLabel = "Additional Information",
}: UserCustomFieldsProps) {
  const { data, isLoading, isError } = useUserFields();

  // Filter to active fields and sort by sortOrder
  const activeFields = useMemo(() => {
    if (!data?.fields) return [];
    return data.fields
      .filter(f => f.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data]);

  // Loading state — skeleton placeholder
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // Error or no data — silently return nothing
  if (isError || !data) {
    return null;
  }

  // No active custom fields — render nothing
  if (activeFields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">{groupLabel}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeFields.map(def => {
          const fieldConfig = toFieldConfig(def);
          const fieldPath = `${CUSTOM_FIELD_PREFIX}.${def.name}`;

          return (
            <UserFieldInput
              key={def.id}
              fieldConfig={fieldConfig}
              fieldPath={fieldPath}
              control={control}
              error={getNestedError(errors, fieldPath)}
              disabled={disabled}
            />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Field Input Dispatcher
// ============================================================================

interface UserFieldInputProps {
  /** FieldConfig-compatible object from toFieldConfig() */
  fieldConfig: FieldConfig;
  /** Full form path including prefix, e.g. "customFields.phone" */
  fieldPath: string;
  /** react-hook-form control */
  control: Control<FieldValues>;
  /** Error message for this field */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
}

/**
 * Renders the appropriate input component for a single user custom field.
 * Uses FieldWrapper for consistent label/error/description presentation.
 */
function UserFieldInput({
  fieldConfig,
  fieldPath,
  control,
  error,
  disabled,
}: UserFieldInputProps) {
  const isCheckbox =
    fieldConfig.type === "checkbox" || fieldConfig.type === "boolean";

  return (
    <FieldWrapper
      field={fieldConfig}
      error={error}
      fieldPath={fieldPath}
      horizontal={isCheckbox}
    >
      {renderInput()}
    </FieldWrapper>
  );

  function renderInput() {
    const fieldType = fieldConfig.type as string;
    const commonProps = {
      name: fieldPath,
      control,
      disabled,
    };

    switch (fieldType) {
      case "text":
      case "string":
        return (
          <TextInput {...commonProps} field={fieldConfig as TextFieldConfig} />
        );

      case "textarea":
        return (
          <TextareaInput
            {...commonProps}
            field={fieldConfig as TextareaFieldConfig}
          />
        );

      case "email":
        return (
          <EmailInput
            {...commonProps}
            field={fieldConfig as EmailFieldConfig}
          />
        );

      case "number":
        return (
          <NumberInput
            {...commonProps}
            field={fieldConfig as NumberFieldConfig}
          />
        );

      case "select":
        return (
          <SelectInput
            {...commonProps}
            field={fieldConfig as SelectFieldConfig}
          />
        );

      case "radio":
        return (
          <RadioInput
            {...commonProps}
            field={fieldConfig as RadioFieldConfig}
          />
        );

      case "checkbox":
      case "boolean":
        return (
          <CheckboxInput
            {...commonProps}
            field={fieldConfig as CheckboxFieldConfig}
          />
        );

      case "date":
        return (
          <DateInput {...commonProps} field={fieldConfig as DateFieldConfig} />
        );

      default:
        return (
          <div className="rounded-none  border border-primary/5 border-destructive/50 bg-destructive/10 p-3 text-center">
            <p className="text-sm text-destructive">
              Unsupported field type: {fieldType}
            </p>
          </div>
        );
    }
  }
}
