/**
 * Date Input Component
 *
 * A controlled date input that integrates with React Hook Form.
 * Uses native HTML date input with styling to match the design system.
 *
 * Note: This is a basic implementation using native date input.
 * A more advanced implementation with react-day-picker and
 * popover calendar can be added in a future enhancement.
 *
 * @module components/entries/fields/selection/DateInput
 * @since 1.0.0
 */

import type { DateFieldConfig } from "@revnixhq/nextly/config";
import { Input } from "@revnixhq/ui";
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

export interface DateInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Used as the unique identifier for the input.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   * Provides date picker options and admin settings.
   */
  field: DateFieldConfig;

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
// Helpers
// ============================================================

/**
 * Extracts local date parts and formats them for HTML input types.
 */
function toLocalInputValue(
  value: string | Date | null | undefined,
  format: "date" | "datetime" | "time" | "month"
): string {
  if (!value) return "";

  try {
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "";

    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, "0");
    const D = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");

    switch (format) {
      case "datetime":
        return `${Y}-${M}-${D}T${h}:${m}`;
      case "time":
        return `${h}:${m}`;
      case "month":
        return `${Y}-${M}`;
      case "date":
      default:
        return `${Y}-${M}-${D}`;
    }
  } catch {
    return "";
  }
}

/**
 * Converts a date value to YYYY-MM-DD format for HTML date input using local time.
 */
function toDateInputValue(value: string | Date | null | undefined): string {
  return toLocalInputValue(value, "date");
}

/**
 * Converts a date value to YYYY-MM-DDTHH:MM format for HTML datetime-local input using local time.
 */
function toDateTimeInputValue(value: string | Date | null | undefined): string {
  return toLocalInputValue(value, "datetime");
}

/**
 * Converts a date value to HH:MM format for HTML time input using local time.
 */
function toTimeInputValue(value: string | Date | null | undefined): string {
  return toLocalInputValue(value, "time");
}

/**
 * Converts a date value to YYYY-MM format for HTML month input using local time.
 */
function toMonthInputValue(value: string | Date | null | undefined): string {
  return toLocalInputValue(value, "month");
}

// ============================================================
// Component
// ============================================================

/**
 * DateInput provides a controlled date picker.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Supports dayOnly, dayAndTime, timeOnly, monthOnly appearances
 * - Min/max date constraints
 * - Stores values as ISO 8601 strings
 * - Accessibility: proper id, aria-invalid
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component renders only the date input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={publishDateField} error={errors.publishDate?.message}>
 *   <DateInput
 *     name="publishDate"
 *     field={publishDateField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With datetime picker
 * ```tsx
 * <DateInput
 *   name="eventStart"
 *   field={{
 *     type: 'date',
 *     name: 'eventStart',
 *     admin: { date: { pickerAppearance: 'dayAndTime' } },
 *   }}
 *   control={control}
 * />
 * ```
 */
export function DateInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: DateInputProps<TFieldValues>) {
  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return null; // Functions are evaluated at form level, not here
    }
    return field.defaultValue ?? null;
  };

  const {
    field: { value, onChange, onBlur, ref },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  // Determine input type based on picker appearance
  const pickerAppearance = field.admin?.date?.pickerAppearance ?? "dayOnly";

  let inputType: string;
  let formatValue: (v: string | Date | null | undefined) => string;

  switch (pickerAppearance) {
    case "dayAndTime":
      inputType = "datetime-local";
      formatValue = toDateTimeInputValue;
      break;
    case "timeOnly":
      inputType = "time";
      formatValue = toTimeInputValue;
      break;
    case "monthOnly":
      inputType = "month";
      formatValue = toMonthInputValue;
      break;
    case "dayOnly":
    default:
      inputType = "date";
      formatValue = toDateInputValue;
      break;
  }

  // Handle change - convert to ISO string
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    if (!inputValue) {
      onChange(null);
      return;
    }

    // Convert input value to ISO string
    // IMPORTANT: For date-only inputs, we must treat the value as UTC to avoid
    // timezone issues where selecting "2025-01-01" in local time could become
    // "2024-12-31" in UTC (and vice versa when displaying)
    try {
      let date: Date;

      switch (pickerAppearance) {
        case "timeOnly":
          // For time-only, create a date with today's date and the selected time
          date = new Date(`1970-01-01T${inputValue}:00Z`);
          break;
        case "monthOnly":
          // For month-only, create a date for the first day of the month (UTC)
          date = new Date(`${inputValue}-01T00:00:00Z`);
          break;
        case "dayOnly":
          // For date-only, treat as UTC midnight to prevent timezone drift
          date = new Date(`${inputValue}T00:00:00Z`);
          break;
        case "dayAndTime":
          // For datetime-local, the input is in local time, convert properly
          date = new Date(inputValue);
          break;
        default:
          // Default: treat as UTC for date-only behavior
          date = new Date(`${inputValue}T00:00:00Z`);
          break;
      }

      if (!Number.isNaN(date.getTime())) {
        onChange(date.toISOString());
      } else {
        onChange(null);
      }
    } catch {
      onChange(null);
    }
  };

  // Format min/max dates for input constraints
  const getMinMax = () => {
    const dateOptions = field.admin?.date;
    const result: { min?: string; max?: string } = {};

    if (dateOptions?.minDate) {
      result.min = formatValue(dateOptions.minDate);
    }
    if (dateOptions?.maxDate) {
      result.max = formatValue(dateOptions.maxDate);
    }

    return result;
  };

  const { min, max } = getMinMax();

  return (
    <Input
      ref={ref}
      id={name}
      type={inputType}
      value={formatValue(value)}
      onChange={handleChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      min={min}
      max={max}
      aria-invalid={invalid || undefined}
      className={cn(readOnly && "bg-muted cursor-not-allowed", className)}
    />
  );
}

// ============================================================
// Exports
// ============================================================
