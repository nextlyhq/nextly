"use client";

/**
 * Text Input Component
 *
 * A controlled text input field that integrates with React Hook Form.
 * Wraps the base Input UI component with field-specific configuration.
 *
 * Supports automatic slug generation: when this is a "title" or "name" field,
 * it will automatically generate and update a "slug" field in the same form
 * (if one exists and hasn't been manually edited).
 *
 * @module components/entries/fields/text/TextInput
 * @since 1.0.0
 */

import type { TextFieldConfig } from "@revnixhq/nextly/config";
import { Input } from "@revnixhq/ui";
import { useEffect, useRef } from "react";
import {
  useController,
  useFormContext,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn, slugify } from "@admin/lib/utils";

// Helper to get validation value from flat or nested format (for dynamic collections)
function getValidationValue<T>(
  field: Record<string, unknown>,
  key: string
): T | undefined {
  // First check flat format (e.g., field.minLength)
  if (key in field && field[key] !== undefined) {
    return field[key] as T;
  }
  // Then check nested validation object (e.g., field.validation.minLength)
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

// Safely checks whether a dot-notated path exists in an object.
function hasPath(object: unknown, path: string): boolean {
  if (!object || typeof object !== "object" || !path) return false;

  const segments = path.split(".").filter(Boolean);
  let current: unknown = object;

  for (const segment of segments) {
    if (
      !current ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return true;
}

// ============================================================
// Types
// ============================================================

export interface TextInputProps<
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
  field: TextFieldConfig;

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
 * TextInput provides a controlled text input for single-line text fields.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Validation constraints from field config (minLength, maxLength)
 * - Accessibility: proper id, aria-invalid, autoComplete
 * - Read-only and disabled states with visual feedback
 * - **Auto slug generation**: When this is a "title" or "name" field,
 *   automatically generates and updates a "slug" field (if present and
 *   not manually edited by the user).
 *
 * Note: This component renders only the input element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={titleField} error={errors.title?.message}>
 *   <TextInput
 *     name="title"
 *     field={titleField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With disabled state
 * ```tsx
 * <TextInput
 *   name="slug"
 *   field={slugField}
 *   control={control}
 *   disabled={isSubmitting}
 * />
 * ```
 *
 * @example Auto-slug generation
 * ```tsx
 * // When user types "Hello World" in title field,
 * // slug field will automatically become "hello-world"
 * <TextInput name="title" field={titleField} control={control} />
 * <TextInput name="slug" field={slugField} control={control} />
 * ```
 */
export function TextInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: TextInputProps<TFieldValues>) {
  // Get form context for slug generation
  const { setValue, getValues } = useFormContext<TFieldValues>();

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

  // Watch for title/name field changes to auto-generate slug
  // Extract the field name without any path prefixes (e.g., "address.title" -> "title")
  const fieldName = String(name).split(".").pop() || "";
  const shouldAutoGenerateSlug = fieldName === "title" || fieldName === "name";

  // Compute the slug field name (replace "title" or "name" with "slug" in the path)
  const slugFieldName = String(name).replace(
    new RegExp(`${fieldName}$`),
    "slug"
  ) as Path<TFieldValues>;

  // Watch the slug field value to detect manual edits
  const slugValue = useWatch({
    control,
    name: slugFieldName,
    disabled: !shouldAutoGenerateSlug,
  });

  // Track the last auto-generated slug to detect if user manually edited it
  const lastGeneratedSlugRef = useRef<string>("");
  const isInitializedRef = useRef(false);

  // Auto-generate slug from title/name field
  useEffect(() => {
    if (!shouldAutoGenerateSlug) return;

    // Only auto-generate when a sibling slug path actually exists.
    // This avoids creating phantom values for unrelated `title`/`name` fields.
    if (!hasPath(getValues(), String(slugFieldName))) {
      return;
    }

    const currentValue = String(value || "");
    const currentSlug = String(slugValue ?? "");
    const generatedSlug = slugify(currentValue);

    // On first render, initialize the ref with the generated slug from current title
    // This handles the case where Singles have pre-existing data
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      lastGeneratedSlugRef.current = slugify(currentValue);

      // If the current slug matches what would be generated, treat it as auto-generated
      if (currentSlug === generatedSlug) {
        return; // Already in sync, no need to update
      }
      // If slugs don't match, assume it was manually edited, don't override
      if (currentSlug !== "") {
        return;
      }
    }

    // Auto-update slug if:
    // 1. Slug is empty, OR
    // 2. Slug matches the last auto-generated value (hasn't been manually edited)
    const isSlugAutoGenerated =
      currentSlug === "" || currentSlug === lastGeneratedSlugRef.current;

    if (isSlugAutoGenerated && generatedSlug !== currentSlug) {
      const shouldMarkDirty = isInitializedRef.current;
      setValue(
        slugFieldName,
        generatedSlug as TFieldValues[Path<TFieldValues>],
        {
          shouldValidate: false,
          // Initial sync should not trigger unsaved-changes warnings.
          shouldDirty: shouldMarkDirty,
        }
      );
      lastGeneratedSlugRef.current = generatedSlug;
    }
  }, [
    shouldAutoGenerateSlug,
    value,
    slugValue,
    slugFieldName,
    setValue,
    getValues,
  ]);

  // Get validation values from flat or nested format (supports dynamic collections)
  const minLength = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "minLength"
  );
  const maxLength = getValidationValue<number>(
    field as unknown as Record<string, unknown>,
    "maxLength"
  );
  const placeholder = getAdminValue<string>(
    field as unknown as Record<string, unknown>,
    "placeholder"
  );
  const autoComplete = getAdminValue<string>(
    field as unknown as Record<string, unknown>,
    "autoComplete"
  );

  return (
    <Input
      ref={ref}
      id={name}
      type="text"
      value={value ?? ""}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      minLength={minLength}
      maxLength={maxLength}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      className={cn(readOnly && "bg-primary/5 cursor-not-allowed", className)}
    />
  );
}

// ============================================================
// Exports
// ============================================================
