"use client";

/**
 * Form Error Summary Component
 *
 * Displays a summary of all form validation errors at the top of the form.
 * Provides clickable links to scroll to and focus individual error fields.
 *
 * @module components/entries/EntryForm/FormErrorSummary
 * @since 1.0.0
 */

import { toast } from "@revnixhq/ui";
import { useEffect } from "react";
import type { FieldErrors, FieldValues } from "react-hook-form";

import {
  formatFieldPath,
  scrollToField,
} from "@admin/lib/errors/error-mapping";

// ============================================================================
// Component
// ============================================================================

/**
 * FormErrorSummary - Display form validation errors summary
 *
 * Shows a compact list of all form errors with clickable field names
 * that scroll to and focus the corresponding input. Useful for forms
 * with many fields or nested structures where errors might be off-screen.
 *
 * @example Basic usage
 * ```tsx
 * const { formState: { errors } } = useForm();
 *
 * return (
 *   <form>
 *     <FormErrorSummary errors={errors} />
 *     {/* form fields *\/}
 *   </form>
 * );
 * ```
 *
 * @example With custom max errors
 * ```tsx
 * <FormErrorSummary errors={errors} maxErrors={3} />
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export interface FormErrorSummaryProps {
  /** Form errors object from React Hook Form */
  errors: FieldErrors<FieldValues>;
  /** Maximum number of errors to display before showing "+N more" (default: 5) */
  maxErrors?: number;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Flattened error entry with path and message
 */
interface FlattenedError {
  path: string;
  message: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively flatten nested errors object into array of {path, message}
 *
 * Handles:
 * - Simple field errors: { title: { message: "Required" } }
 * - Nested field errors: { metadata: { seo: { title: { message: "..." } } } }
 * - Array field errors: { links: { 0: { url: { message: "..." } } } }
 */
function flattenErrors(
  errors: FieldErrors<FieldValues>,
  prefix = ""
): FlattenedError[] {
  const result: FlattenedError[] = [];

  for (const [key, value] of Object.entries(errors)) {
    // Skip root-level error (form-level error)
    if (key === "root") continue;

    const path = prefix ? `${prefix}.${key}` : key;

    if (!value) continue;

    // Check if this is a leaf error (has message property)
    if (typeof value === "object" && "message" in value && value.message) {
      result.push({ path, message: String((value as { message: unknown }).message) });
    } else if (typeof value === "object") {
      // Recursively process nested errors
      result.push(...flattenErrors(value as FieldErrors<FieldValues>, path));
    }
  }

  return result;
}

export function FormErrorSummary({
  errors,
  maxErrors = 5,
}: FormErrorSummaryProps) {
  const errorList = flattenErrors(errors);

  // Stringify path-list to only re-fire toast when the *set* of errors changes,
  // avoiding infinite re-renders since `errors` object reference changes constantly.
  const errorPathKey = errorList.map(e => e.path).join(",");

  useEffect(() => {
    if (errorList.length === 0) {
      toast.dismiss("form-errors");
      return;
    }

    const displayedErrors = errorList.slice(0, maxErrors);
    const remainingCount = errorList.length - displayedErrors.length;

    toast.error("Please fix the following errors", {
      id: "form-errors",
      duration: 6000,
      description: (
        <div className="mt-1">
          <ul className="space-y-1 list-none p-0">
            {displayedErrors.map(({ path, message }) => (
              <li key={path} className="text-sm">
                <button
                  type="button"
                  className="font-medium underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-red-500 rounded-sm inline-block"
                  onClick={() => scrollToField(path)}
                >
                  {formatFieldPath(path)}
                </button>
                <span className="opacity-90 ml-1">: {message}</span>
              </li>
            ))}
          </ul>
          {remainingCount > 0 && (
            <p className="mt-2 text-sm opacity-80">
              And {remainingCount} more error{remainingCount > 1 ? "s" : ""}...
            </p>
          )}
        </div>
      ),
    });
  }, [errorList, errorPathKey, maxErrors]);

  return null;
}
