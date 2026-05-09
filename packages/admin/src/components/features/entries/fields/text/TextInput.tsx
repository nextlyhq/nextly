"use client";

/**
 * Text Input Component
 *
 * A controlled text input field that integrates with React Hook Form.
 * Wraps the base Input UI component with field-specific configuration.
 *
 * Slug auto-generation lives at the form level (see `useAutoSlug` hook),
 * not here — the title input was moved out of the field-renderer pipeline
 * watching could no longer reach the title.
 *
 * @module components/entries/fields/text/TextInput
 * @since 1.0.0
 */

import { Input } from "@nextlyhq/ui";
import type { TextFieldConfig } from "nextly/config";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// Helper to get validation value from flat or nested format (for dynamic collections)
function getValidationValue<T>(
  field: Record<string, unknown>,
  key: string
): T | undefined {
  // First check flat format (e.g., field.minLength)
  if (key in field && field[key] !== undefined) {
    return field[key] as T;
  }
  // Then check nested validation object (e.g., field.validation.minLength)
  const validation = field.validation as Record<string, unknown> | undefined;
  if (validation && key in validation && validation[key] !== undefined) {
    return validation[key] as T;
  }
  return undefined;
}

// Helper to get admin option value from field
function getAdminValue<T>(
  field: Record<string, unknown>,
  key: string
): T | undefined {
  const admin = field.admin as Record<string, unknown> | undefined;
  if (admin && key in admin && admin[key] !== undefined) {
    return admin[key] as T;
  }
  return undefined;
}

// ============================================================
// Types
// ============================================================

export interface TextInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Used as the unique identifier for the input.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   * Provides validation constraints and admin options.
   */
  field: TextFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled inputs cannot be focused or edited.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only inputs can be focused but not edited.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the input.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * TextInput provides a controlled text input for single-line text fields.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Validation constraints from field config (minLength, maxLength)
 * - Accessibility: proper id, aria-invalid, autoComplete
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component renders only the input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={titleField} error={errors.title?.message}>
 *   <TextInput
 *     name="title"
 *     field={titleField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With disabled state
 * ```tsx
 * <TextInput
 *   name="slug"
 *   field={slugField}
 *   control={control}
 *   disabled={isSubmitting}
 * />
 * ```
 */
export function TextInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: TextInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const defaultValue =
    typeof field.defaultValue === "function"
      ? "" // Functions are evaluated at form level, not here
      : (field.defaultValue as string) || "";

  const {
    field: { value, onChange, onBlur, ref },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: defaultValue as TFieldValues[Path<TFieldValues>],
  });

  // Get validation values from flat or nested format (supports dynamic collections)
  const minLength = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "minLength"
  );
  const maxLength = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "maxLength"
  );
  const placeholder = getAdminValue<string>(
    field as unknown as Record<string, unknown>,
    "placeholder"
  );
  const autoComplete = getAdminValue<string>(
    field as unknown as Record<string, unknown>,
    "autoComplete"
  );

  return (
    <Input
      ref={ref}
      id={name}
      type="text"
      value={value ?? ""}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      minLength={minLength}
      maxLength={maxLength}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      className={cn(readOnly && "bg-primary/5 cursor-not-allowed", className)}
    />
  );
}

// ============================================================
// Exports
// ============================================================
