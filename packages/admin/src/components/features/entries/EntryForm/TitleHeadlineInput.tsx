"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";
import type React from "react";
import { useFormContext } from "react-hook-form";

import { cn } from "@admin/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface TitleHeadlineInputProps {
  /** The collection's title field config — used to read `required` for
   *  validation registration and `label` (only as the placeholder fallback). */
  titleField?: FieldConfig;
  /** Disabled while the form is submitting. */
  disabled?: boolean;
  /** Placeholder shown when the title is empty. Defaults to "Untitled". */
  placeholder?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TitleHeadlineInput — large borderless text input wired to the form's
 * `title` field (Q-D5=iv in the redesign spec). Renders above the main
 * column instead of inside the field grid; replaces the previous
 * Title + Slug Card.
 *
 * Validation errors render as a thin red line below the input rather than
 * a normal field-error block — this keeps the headline visually clean
 * while still surfacing the error.
 */
export function TitleHeadlineInput({
  titleField,
  disabled,
  placeholder = "Untitled",
}: TitleHeadlineInputProps): React.ReactElement | null {
  const form = useFormContext();
  if (!titleField || !form) return null;

  const titleName =
    "name" in titleField ? (titleField.name as string) : "title";
  const required = (titleField as { required?: boolean }).required === true;
  const error = form.formState.errors[titleName] as
    | { message?: string }
    | undefined;

  return (
    <div className="px-6 lg:px-8 pt-7 pb-5">
      <input
        type="text"
        disabled={disabled}
        placeholder={placeholder}
        aria-label={(titleField as { label?: string }).label ?? "Title"}
        aria-invalid={!!error}
        className={cn(
          "w-full text-[28px] font-semibold tracking-tight text-foreground",
          "bg-transparent outline-none placeholder:text-muted-foreground/50",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        {...form.register(titleName, {
          required: required ? "Title is required" : false,
        })}
      />
      {error?.message && (
        <p className="mt-1.5 text-xs text-red-600" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
