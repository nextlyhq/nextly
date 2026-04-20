/**
 * Radio Input Component
 *
 * A radio button group that integrates with React Hook Form.
 * Wraps the Radix UI RadioGroup component with field-specific configuration.
 *
 * @module components/entries/fields/selection/RadioInput
 * @since 1.0.0
 */

import type { RadioFieldConfig } from "@revnixhq/nextly/config";
import { Label, RadioGroup, RadioGroupItem } from "@revnixhq/ui";
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

export interface RadioInputProps<
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
  field: RadioFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled radio groups cannot be changed.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only radio groups appear disabled visually.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the radio group container.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * RadioInput provides a controlled radio button group.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Options from field config
 * - Horizontal or vertical layout
 * - Accessibility: proper ARIA from Radix UI
 * - Read-only and disabled states with visual feedback
 *
 * Note: Unlike select fields, all options are visible at once.
 * This makes radio groups ideal for small sets of mutually exclusive choices.
 *
 * Note: This component renders only the radio group element.
 * Use FieldWrapper for field labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={statusField} error={errors.status?.message}>
 *   <RadioInput
 *     name="status"
 *     field={statusField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With options
 * ```tsx
 * <RadioInput
 *   name="size"
 *   field={{
 *     type: 'radio',
 *     name: 'size',
 *     options: [
 *       { label: 'Small', value: 'small' },
 *       { label: 'Medium', value: 'medium' },
 *       { label: 'Large', value: 'large' },
 *     ],
 *     admin: {
 *       layout: 'horizontal',
 *     },
 *   }}
 *   control={control}
 * />
 * ```
 */
export function RadioInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: RadioInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return ""; // Functions are evaluated at form level, not here
    }
    return (field.defaultValue as string) || "";
  };

  const {
    field: { value, onChange },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  // Get layout from admin config
  const layout = field.admin?.layout || "horizontal";
  const isHorizontal = layout === "horizontal";

  return (
    <RadioGroup
      value={value || ""}
      onValueChange={onChange}
      disabled={disabled || readOnly}
      className={cn(
        isHorizontal ? "flex flex-wrap gap-4" : "flex flex-col gap-3",
        readOnly && "opacity-60 cursor-not-allowed",
        className
      )}
      aria-invalid={invalid || undefined}
    >
      {field.options?.map(option => (
        <div key={option.value} className="flex items-center space-x-2">
          <RadioGroupItem
            value={option.value}
            id={`${name}-${option.value}`}
            disabled={disabled || readOnly}
          />
          <Label
            htmlFor={`${name}-${option.value}`}
            className={cn(
              "cursor-pointer",
              (disabled || readOnly) && "cursor-not-allowed opacity-60"
            )}
          >
            {option.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}

// ============================================================
// Exports
// ============================================================
