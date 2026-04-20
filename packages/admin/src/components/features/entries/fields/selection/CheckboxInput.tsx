/**
 * Checkbox Input Component
 *
 * A controlled checkbox input that integrates with React Hook Form.
 * Wraps the Radix UI Checkbox component with field-specific configuration.
 *
 * @module components/entries/fields/selection/CheckboxInput
 * @since 1.0.0
 */

import type { CheckboxFieldConfig } from "@revnixhq/nextly/config";
import { Checkbox } from "@revnixhq/ui";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

// ============================================================
// Types
// ============================================================

export interface CheckboxInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Used as the unique identifier for the input.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   * Provides default value and admin settings.
   */
  field: CheckboxFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled checkboxes cannot be changed.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only checkboxes appear disabled visually.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the checkbox.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * CheckboxInput provides a controlled boolean checkbox.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Accessibility: proper ARIA from Radix UI
 * - Read-only and disabled states
 *
 * Note: This component is designed to be used with FieldWrapper
 * in horizontal layout mode for proper label placement.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={publishedField} error={errors.published?.message} horizontal>
 *   <CheckboxInput
 *     name="published"
 *     field={publishedField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example Simple usage
 * ```tsx
 * <div className="flex items-center gap-2">
 *   <CheckboxInput
 *     name="featured"
 *     field={featuredField}
 *     control={control}
 *   />
 *   <label htmlFor="featured">Featured</label>
 * </div>
 * ```
 */
export function CheckboxInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: CheckboxInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return false; // Functions are evaluated at form level, not here
    }
    return field.defaultValue ?? false;
  };

  const {
    field: { value, onChange },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  return (
    <Checkbox
      id={name}
      checked={!!value}
      onCheckedChange={onChange}
      disabled={disabled || readOnly}
      className={className}
    />
  );
}

// ============================================================
// Exports
// ============================================================
