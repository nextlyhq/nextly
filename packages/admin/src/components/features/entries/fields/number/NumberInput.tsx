/**
 * Number Input Component
 *
 * A controlled numeric input that integrates with React Hook Form.
 * Wraps the base Input UI component with number-specific configuration.
 *
 * @module components/entries/fields/number/NumberInput
 * @since 1.0.0
 */

import type { NumberFieldConfig } from "@revnixhq/nextly/config";
import { Input } from "@revnixhq/ui";
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
  // First check flat format (e.g., field.min)
  if (key in field && field[key] !== undefined) {
    return field[key] as T;
  }
  // Then check nested validation object (e.g., field.validation.min)
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

export interface NumberInputProps<
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
  field: NumberFieldConfig;

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
 * NumberInput provides a controlled numeric input.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Validation constraints from field config (min, max)
 * - Configurable step increment
 * - Converts empty string to null for proper handling
 * - Accessibility: proper id, aria-invalid
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component handles single numeric values only.
 * For hasMany number fields, a separate ArrayNumberInput would be needed.
 *
 * Note: This component renders only the input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={priceField} error={errors.price?.message}>
 *   <NumberInput
 *     name="price"
 *     field={priceField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With min/max constraints
 * ```tsx
 * <NumberInput
 *   name="rating"
 *   field={{ ...ratingField, min: 1, max: 5, admin: { step: 1 } }}
 *   control={control}
 * />
 * ```
 */
export function NumberInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: NumberInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return null; // Functions are evaluated at form level, not here
    }
    const value = field.defaultValue;
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  };

  const {
    field: { value, onChange, onBlur, ref },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  // Handle change - convert to number or null
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    if (inputValue === "") {
      onChange(null);
    } else {
      const numValue = Number(inputValue);
      onChange(Number.isNaN(numValue) ? null : numValue);
    }
  };

  // Get validation values from flat or nested format (supports dynamic collections)
  const min = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "min"
  );
  const max = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "max"
  );
  const placeholder = getAdminValue<string>(
    field as unknown as Record<string, unknown>,
    "placeholder"
  );

  // Get step from admin config, default to 1
  const step = field.admin?.step ?? 1;

  return (
    <Input
      ref={ref}
      id={name}
      type="number"
      value={value ?? ""}
      onChange={handleChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      aria-invalid={invalid || undefined}
      className={cn(
        // Remove spinner buttons on some browsers for cleaner look
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        readOnly && "bg-muted cursor-not-allowed",
        className
      )}
    />
  );
}

// ============================================================
// Exports
// ============================================================
