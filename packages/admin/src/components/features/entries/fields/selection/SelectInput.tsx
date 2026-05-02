/**
 * Select Input Component
 *
 * A controlled dropdown select input that integrates with React Hook Form.
 * Wraps the Radix UI Select component with field-specific configuration.
 *
 * @module components/entries/fields/selection/SelectInput
 * @since 1.0.0
 */

import type { SelectFieldConfig } from "@revnixhq/nextly/config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface SelectInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Used as the unique identifier for the input.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   * Provides options and admin settings.
   */
  field: SelectFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled selects cannot be opened or changed.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only selects appear disabled visually.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the trigger.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * SelectInput provides a controlled dropdown select.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Options from field config
 * - Placeholder support
 * - Accessibility: proper ARIA from Radix UI
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component handles single-value selects only.
 * For hasMany select fields, a separate MultiSelectInput would be needed.
 *
 * Note: This component renders only the select element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={statusField} error={errors.status?.message}>
 *   <SelectInput
 *     name="status"
 *     field={statusField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With options
 * ```tsx
 * <SelectInput
 *   name="priority"
 *   field={{
 *     type: 'select',
 *     name: 'priority',
 *     options: [
 *       { label: 'Low', value: 'low' },
 *       { label: 'Medium', value: 'medium' },
 *       { label: 'High', value: 'high' },
 *     ],
 *   }}
 *   control={control}
 * />
 * ```
 */
export function SelectInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: SelectInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return ""; // Functions are evaluated at form level, not here
    }
    // For single select, ensure it's a string
    const value = field.defaultValue;
    if (Array.isArray(value)) {
      return value[0] || ""; // Take first value if array provided
    }
    return (value as string) || "";
  };

  const {
    field: { value, onChange },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  // Get placeholder from admin config
  const placeholder = field.admin?.placeholder || "Select...";

  return (
    <Select
      value={value || ""}
      onValueChange={onChange}
      disabled={disabled || readOnly}
    >
      <SelectTrigger
        id={name}
        aria-invalid={invalid || undefined}
        className={cn(readOnly && "bg-primary/5 cursor-not-allowed", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {field.options?.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================================
// Exports
// ============================================================
