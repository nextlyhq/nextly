/**
 * Select Input Component
 *
 * A controlled dropdown select input that integrates with React Hook Form.
 * Wraps the Radix UI Select component with field-specific configuration.
 *
 * @module components/entries/fields/selection/SelectInput
 * @since 1.0.0
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { SelectFieldConfig } from "nextly/config";
import type { JSX } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { useFieldElementId } from "../field-id-scope";

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
 * Note: This component handles single-value selects only. hasMany select
 * fields are rendered by MultiSelectInput (see FieldRenderer).
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
}: SelectInputProps<TFieldValues>): JSX.Element {
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

  // Scoped, so a second rendering of the same document on one page cannot

  // duplicate this id and steal the first rendering's label.

  const elementId = useFieldElementId(name);

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

  // A clearable field with a value (and not disabled or read-only) offers a
  // × button that resets it to an empty string. The button sits BESIDE the
  // trigger, not on it: drawn over the trigger it crowded the chevron into
  // "⌄×", and it could not be reached from the keyboard. The form value, not
  // radix's open state, decides whether it shows.
  const isClearable = field.admin?.isClearable === true;
  const showClear =
    isClearable && !disabled && !readOnly && value !== "" && value != null;

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange("");
  };

  const trigger = (
    <SelectTrigger
      id={elementId}
      aria-invalid={invalid || undefined}
      className={cn(
        // The row's width, less the clear button's when it shows.
        "min-w-0 flex-1",
        readOnly && "bg-primary/5 cursor-not-allowed",
        className
      )}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
  );

  return (
    <div className="flex items-center gap-1">
      <Select
        value={value || ""}
        onValueChange={onChange}
        disabled={disabled || readOnly}
      >
        {trigger}
        <SelectContent>
          {field.options?.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showClear && (
        <button
          type="button"
          onClick={handleClear}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
