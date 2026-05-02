/**
 * Email Input Component
 *
 * A controlled email input field that integrates with React Hook Form.
 * Wraps the base Input UI component with email-specific configuration.
 *
 * @module components/entries/fields/text/EmailInput
 * @since 1.0.0
 */

import type { EmailFieldConfig } from "@revnixhq/nextly/config";
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

export interface EmailInputProps<
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
  field: EmailFieldConfig;

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
 * EmailInput provides a controlled email input with browser-native validation.
 *
 * Features:
 * - React Hook Form integration via useController
 * - HTML5 email input type for native validation
 * - Appropriate keyboard on mobile devices
 * - Autocomplete support for email addresses
 * - Read-only and disabled states with visual feedback
 *
 * Note: This component renders only the input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={emailField} error={errors.email?.message}>
 *   <EmailInput
 *     name="email"
 *     field={emailField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With autocomplete
 * ```tsx
 * <EmailInput
 *   name="contactEmail"
 *   field={{
 *     type: 'email',
 *     name: 'contactEmail',
 *     admin: {
 *       autoComplete: 'email',
 *       placeholder: 'you@example.com',
 *     },
 *   }}
 *   control={control}
 * />
 * ```
 */
export function EmailInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: EmailInputProps<TFieldValues>) {
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

  return (
    <Input
      ref={ref}
      id={name}
      type="email"
      value={value ?? ""}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={field.admin?.placeholder}
      autoComplete={field.admin?.autoComplete || "email"}
      aria-invalid={invalid || undefined}
      className={cn(readOnly && "bg-primary/5 cursor-not-allowed", className)}
    />
  );
}

// ============================================================
// Exports
// ============================================================
