/**
 * Textarea Input Component
 *
 * A controlled multi-line text input that integrates with React Hook Form.
 * Wraps the base Textarea UI component with field-specific configuration.
 *
 * @module components/entries/fields/text/TextareaInput
 * @since 1.0.0
 */

import type { TextareaFieldConfig } from "@revnixhq/nextly/config";
import { Textarea } from "@revnixhq/ui";
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

export interface TextareaInputProps<
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
  field: TextareaFieldConfig;

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
// Resize Styles
// ============================================================

const RESIZE_STYLES: Record<string, string> = {
  vertical: "resize-y",
  horizontal: "resize-x",
  both: "resize",
  none: "resize-none",
};

// ============================================================
// Component
// ============================================================

/**
 * TextareaInput provides a controlled multi-line text input.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Validation constraints from field config (minLength, maxLength)
 * - Configurable rows and resize behavior
 * - Accessibility: proper id, aria-invalid
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component renders only the textarea element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={descriptionField} error={errors.description?.message}>
 *   <TextareaInput
 *     name="description"
 *     field={descriptionField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With custom rows
 * ```tsx
 * <TextareaInput
 *   name="content"
 *   field={{ ...contentField, admin: { rows: 10, resize: 'vertical' } }}
 *   control={control}
 * />
 * ```
 */
export function TextareaInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: TextareaInputProps<TFieldValues>) {
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

  // Get rows from admin config, default to 3
  const rows = field.admin?.rows ?? 3;

  // Get resize style
  const resizeStyle = field.admin?.resize
    ? RESIZE_STYLES[field.admin.resize]
    : "resize-y";

  return (
    <Textarea
      ref={ref}
      id={name}
      value={value ?? ""}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      minLength={minLength}
      maxLength={maxLength}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        resizeStyle,
        readOnly && "bg-muted cursor-not-allowed",
        className
      )}
    />
  );
}

// ============================================================
// Exports
// ============================================================
