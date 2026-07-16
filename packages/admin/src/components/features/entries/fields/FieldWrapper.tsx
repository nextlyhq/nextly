"use client";

/**
 * Field Wrapper Component
 *
 * Common wrapper for all data field inputs providing consistent
 * label, description, error display, and layout.
 *
 * @module components/entries/fields/FieldWrapper
 * @since 1.0.0
 */

import { Label } from "@nextlyhq/ui";
import { Globe } from "lucide-react";
import { isFieldLocalized, type FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";

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
  // i18n M7: active content-language direction (RTL for Arabic/Hebrew/…).
  const entryLocale = useEntryLocale();
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
    localized?: boolean;
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
  const _fieldType = field.type as string;

  // i18n M7: is this field translatable (a per-language value) or shared across all languages?
  // Uses the same classifier as storage generation (nextly/config) so the editor and the DB
  // agree. For non-localized collections this is always false and everything below is inert.
  const isLocalizedField = isFieldLocalized(
    { type: _fieldType, name: fieldName ?? "", localized: fieldWithCommonProps.localized },
    entryLocale.collectionLocalized
  );
  // Flip inputs right-to-left only for translatable fields in an RTL language — a shared field's
  // value is language-neutral and stays LTR.
  const rtlField = entryLocale.rtl && isLocalizedField;
  // Subtle marker on shared fields in a multilingual collection: their value applies to every
  // language and has no per-language draft state (spec §7), so editing one changes all — surface
  // it so editors aren't surprised. Only meaningful for real (named) data fields.
  const sharedHint =
    entryLocale.collectionLocalized && !isLocalizedField && fieldName != null ? (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/70"
        title="Shared across languages — editing this field changes it for every language."
      >
        <Globe className="size-3" aria-hidden="true" />
        Shared
      </span>
    ) : null;

  // i18n M7: while translating a non-default language, show the default-language value inline on
  // a translatable field so the translator always has the source text (spec §10 — the validated,
  // cheap alternative to a full side-by-side editor). Only primitive (text/number) sources render;
  // structural values (relationships, richText objects) are skipped.
  const rawSource =
    isLocalizedField && entryLocale.isNonDefaultLocale && fieldName != null
      ? entryLocale.sourceValues?.[fieldName]
      : undefined;
  const sourceText =
    typeof rawSource === "string" && rawSource.trim() !== ""
      ? rawSource
      : typeof rawSource === "number"
        ? String(rawSource)
        : null;
  const sourceHint = sourceText ? (
    <p
      dir="auto"
      className="text-xs leading-relaxed text-muted-foreground/80 border-l-2 border-muted pl-2"
    >
      <span className="font-medium">Default:</span> {sourceText}
    </p>
  ) : null;

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
        style={fieldWithCommonProps.admin?.style}
        data-field={fieldName}
        data-field-type={field.type}
        // i18n M7: render the field right-to-left when a translatable field is edited in an RTL language.
        {...(rtlField ? { dir: "rtl" as const } : {})}
      >
        <div className="pt-0.5">{children}</div>
        <div className="grid gap-1.5 leading-none">
          <Label
            htmlFor={fieldId}
            className={cn(
              "flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-muted-foreground",
              error && "text-destructive"
            )}
          >
            {label}
            {isRequired && (
              <span className="text-destructive-500 ml-1" aria-hidden="true">
                *
              </span>
            )}
            {sharedHint}
          </Label>
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              className="text-sm text-destructive-500! font-medium"
              role="alert"
            >
              {error}
            </p>
          )}
          {/* i18n L16: show the default-language source hint in the horizontal
              (checkbox) layout too — it was only rendered in the vertical layout. */}
          {sourceHint}
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
      style={fieldWithCommonProps.admin?.style}
      data-field={fieldName}
      data-field-type={field.type}
      // i18n M7: render the field right-to-left when a translatable field is edited in an RTL
      // language (Arabic, Hebrew, …). Shared / non-localized editors are unaffected.
      {...(rtlField ? { dir: "rtl" as const } : {})}
    >
      {/* Label */}
      <Label
        htmlFor={fieldId}
        className={cn(
          "flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-muted-foreground mb-1",
          error && "text-destructive"
        )}
      >
        {label}
        {isRequired && (
          <span className="text-destructive-500 ml-1" aria-hidden="true">
            *
          </span>
        )}
        {sharedHint}
      </Label>

      {/* Input (children) */}
      {children}

      {/* i18n M7: default-language source text, shown while translating another language. */}
      {sourceHint}

      {/* Description / helper text — always visible below the input. Replaces
          the previous tooltip-on-info-icon pattern (Task 5 PR 5 design D3). */}
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}

      {/* Error message */}
      {error && (
        <p
          id={errorId}
          className="text-sm text-destructive-500! font-medium"
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
