/**
 * Toggle Input Component
 *
 * A controlled toggle/switch input that integrates with React Hook Form.
 * Wraps the Radix UI Switch component with field-specific configuration.
 *
 * @module components/entries/fields/selection/ToggleInput
 * @since 1.0.0
 */

import type { CheckboxFieldConfig } from "@revnixhq/nextly/config";
import { Switch } from "@revnixhq/ui";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

// ============================================================
// Types
// ============================================================

export interface ToggleInputProps<
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
   * Reuses CheckboxFieldConfig as toggle is functionally the same.
   */
  field: CheckboxFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled toggles cannot be changed.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only toggles appear disabled visually.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the toggle.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * ToggleInput provides a controlled boolean switch/toggle.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Accessibility: proper ARIA from Radix UI
 * - Read-only and disabled states
 * - Switch UI instead of checkbox
 *
 * Note: This component is designed to be used with FieldWrapper
 * in horizontal layout mode for proper label placement.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={publishedField} error={errors.published?.message} horizontal>
 *   <ToggleInput
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
 *   <ToggleInput
 *     name="featured"
 *     field={featuredField}
 *     control={control}
 *   />
 *   <label htmlFor="featured">Featured</label>
 * </div>
 * ```
 */
export function ToggleInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: ToggleInputProps<TFieldValues>) {
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
    <Switch
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
