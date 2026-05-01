"use client";

/**
 * Password Input Component
 *
 * A controlled password input field that integrates with React Hook Form.
 * Wraps the base Input UI component with password-specific configuration.
 *
 * @module components/entries/fields/text/PasswordInput
 * @since 1.0.0
 */

import type { PasswordFieldConfig } from "@revnixhq/nextly/config";
import { Input } from "@revnixhq/ui";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
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

export interface PasswordInputProps<
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
  field: PasswordFieldConfig;

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
 * PasswordInput provides a controlled password input with masked text.
 *
 * Features:
 * - React Hook Form integration via useController
 * - HTML5 password input type for masked input
 * - Validation constraints from field config (minLength, maxLength)
 * - Autocomplete support for password managers
 * - Read-only and disabled states with visual feedback
 *
 * Security Notes:
 * - Values are masked in the UI (type="password")
 * - Should be used with beforeChange hooks to hash passwords
 * - Consider setting read access to false in field config
 *
 * Note: This component renders only the input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={passwordField} error={errors.password?.message}>
 *   <PasswordInput
 *     name="password"
 *     field={passwordField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With autocomplete
 * ```tsx
 * <PasswordInput
 *   name="newPassword"
 *   field={{
 *     type: 'password',
 *     name: 'newPassword',
 *     minLength: 8,
 *     admin: {
 *       autoComplete: 'new-password',
 *       placeholder: 'Enter a secure password',
 *     },
 *   }}
 *   control={control}
 * />
 * ```
 */
export function PasswordInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: PasswordInputProps<TFieldValues>) {
  const [showPassword, setShowPassword] = useState(false);

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
    <div className="relative">
      <Input
        ref={ref}
        id={name}
        type={showPassword ? "text" : "password"}
        value={value ?? ""}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={field.admin?.placeholder}
        minLength={field.minLength}
        maxLength={field.maxLength}
        autoComplete={field.admin?.autoComplete || "new-password"}
        aria-invalid={invalid || undefined}
        className={cn(
          readOnly && "bg-muted cursor-not-allowed",
          "pr-10",
          className
        )}
      />
      <button
        type="button"
        className="absolute right-0 top-0 flex h-full items-center justify-center px-3 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setShowPassword(prev => !prev)}
        disabled={disabled || readOnly}
        tabIndex={-1}
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
