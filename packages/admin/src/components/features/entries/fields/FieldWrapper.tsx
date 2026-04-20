/**
 * Field Wrapper Component
 *
 * Common wrapper for all data field inputs providing consistent
 * label, description, error display, and layout.
 *
 * @module components/entries/fields/FieldWrapper
 * @since 1.0.0
 */

import type { FieldConfig } from "@revnixhq/nextly/config";
import type { ReactNode } from "react";
import { useId } from "react";

import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface FieldWrapperProps {
  /**
   * Field configuration from collection schema.
   * Used to extract label, required status, description, and width.
   */
  field: FieldConfig;

  /**
   * Validation error message to display.
   * When present, the field is styled as invalid.
   */
  error?: string;

  /**
   * The input component to wrap.
   */
  children: ReactNode;

  /**
   * Additional CSS classes for the wrapper.
   */
  className?: string;

  /**
   * Override the field name for htmlFor/id association.
   * Useful for nested fields with path prefixes.
   */
  fieldPath?: string;

  /**
   * Whether the field is in a horizontal layout (e.g., checkbox).
   * When true, label and input are side-by-side.
   * @default false
   */
  horizontal?: boolean;
}

// ============================================================
// Width Mapping
// ============================================================

/**
 * Maps admin width percentages to Tailwind classes.
 * Uses CSS width for precise percentage control.
 */
const WIDTH_STYLES: Record<string, string> = {
  "25%": "w-1/4",
  "33%": "w-1/3",
  "50%": "w-1/2",
  "66%": "w-2/3",
  "75%": "w-3/4",
  "100%": "w-full",
};

// ============================================================
// Component
// ============================================================

/**
 * FieldWrapper provides consistent presentation for all data field inputs.
 *
 * Features:
 * - Label with required indicator
 * - Description/help text
 * - Validation error display
 * - Configurable width from field.admin.width
 * - Horizontal layout option for checkboxes
 * - Accessibility: proper label association, aria attributes
 *
 * @example
 * ```tsx
 * <FieldWrapper field={textField} error={errors.title?.message}>
 *   <Input {...register("title")} />
 * </FieldWrapper>
 * ```
 *
 * @example Horizontal layout for checkbox
 * ```tsx
 * <FieldWrapper field={checkboxField} horizontal>
 *   <Checkbox {...register("isActive")} />
 * </FieldWrapper>
 * ```
 */
export function FieldWrapper({
  field,
  error,
  children,
  className,
  fieldPath,
  horizontal = false,
}: FieldWrapperProps) {
  // Generate unique IDs for accessibility
  const generatedId = useId();
  // Use type guard to safely access name property (not all fields have it, e.g., TabsFieldConfig)
  const fieldName = "name" in field ? (field.name as string) : undefined;
  const fieldId = fieldPath || fieldName || generatedId;
  const errorId = `${fieldId}-error`;

  // Extract field properties - cast to common optional properties
  const fieldWithCommonProps = field as {
    label?: string;
    required?: boolean;
    admin?: {
      description?: string;
      width?: string;
      hidden?: boolean;
      className?: string;
      style?: React.CSSProperties;
    };
  };
  const label =
    fieldWithCommonProps.label || (fieldName ? formatFieldName(fieldName) : "");
  const isRequired = fieldWithCommonProps.required ?? false;
  const description = fieldWithCommonProps.admin?.description;
  const width = fieldWithCommonProps.admin?.width || "100%";
  const isHidden = fieldWithCommonProps.admin?.hidden;
  const fieldType = field.type as string;

  // Don't render if hidden
  if (isHidden) {
    return null;
  }

  // Get width class
  const widthClass = WIDTH_STYLES[width] || "w-full";

  // Horizontal layout (for checkboxes)
  if (horizontal) {
    return (
      <div
        className={cn(
          "flex items-start gap-3",
          widthClass,
          fieldWithCommonProps.admin?.className,
          className
        )}
        style={
          fieldWithCommonProps.admin?.style as React.CSSProperties | undefined
        }
        data-field={fieldName}
        data-field-type={field.type}
      >
        <div className="pt-0.5">{children}</div>
        <div className="grid gap-1.5 leading-none">
          <div className="flex items-center gap-2 flex-wrap">
            <FormLabelWithTooltip
              htmlFor={fieldId}
              labelClassName={cn(
                "text-[11px] font-bold tracking-[0.08em] text-slate-500",
                error && "text-destructive"
              )}
              label={
                <>
                  {label}
                  {isRequired && (
                    <span className="text-red-500 ml-1" aria-hidden="true">
                      *
                    </span>
                  )}
                </>
              }
              description={description}
            />
          </div>

          {error && (
            <p
              id={errorId}
              className="text-sm text-red-500! font-medium"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Default vertical layout
  return (
    <div
      className={cn(
        "grid gap-2",
        widthClass,
        fieldWithCommonProps.admin?.className,
        className
      )}
      style={
        fieldWithCommonProps.admin?.style as React.CSSProperties | undefined
      }
      data-field={fieldName}
      data-field-type={field.type}
    >
      {/* Label and Field Type Badge - Inline */}
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <FormLabelWithTooltip
          htmlFor={fieldId}
          labelClassName={cn(
            "text-[11px] font-bold tracking-[0.08em] text-slate-500",
            error && "text-destructive"
          )}
          label={
            <>
              {label}
              {isRequired && (
                <span className="text-red-500 ml-1" aria-hidden="true">
                  *
                </span>
              )}
            </>
          }
          description={description}
        />
      </div>

      {/* Input (children) */}
      {children}

      {/* Error message */}
      {error && (
        <p
          id={errorId}
          className="text-sm text-red-500! font-medium"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Formats a field name into a human-readable label.
 * Converts camelCase and snake_case to Title Case.
 *
 * @example
 * formatFieldName('firstName') // 'First Name'
 * formatFieldName('user_email') // 'User Email'
 * formatFieldName('isActive') // 'Is Active'
 */
function formatFieldName(name: string): string {
  if (!name) return "";

  return (
    name
      // Insert space before capitals (camelCase)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Replace underscores and hyphens with spaces
      .replace(/[_-]/g, " ")
      // Capitalize first letter of each word
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim()
  );
}

// ============================================================
// Exports
// ============================================================
