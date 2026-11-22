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

import { toast } from "@nextlyhq/ui";
import { useEffect } from "react";
import type { FieldErrors, FieldValues } from "react-hook-form";

import {
  formatFieldPath,
  scrollToField,
} from "@admin/lib/errors/error-mapping";

import { useFieldReveal, type FieldReveal } from "./field-reveal";

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
  /**
   * `formState.submitCount` from React Hook Form — the toast only fires once
   * the user has actually attempted to submit at least once, so mid-edit
   * field-level blurs don't surface a top-level "Please fix" toast for an
   * empty required field the user hasn't tried to save yet. Inline field
   * errors (next to each input) still appear on blur the moment validation
   * fails; only the consolidating toast is gated.
   *
   * Default 0 (suppresses toast) keeps the historical contract for any
   * caller that hasn't started passing this in yet.
   */
  submitCount?: number;
  /** Maximum number of errors to display before showing "+N more" (default: 5) */
  maxErrors?: number;
  /** Optional CSS class name */
  className?: string;
  /**
   * Where the surface draws some fields out of sight (a document view's
   * dialog), how it shows one: a field it can show is named, with "Show me",
   * rather than linked to a place on screen that may not hold it. Left out,
   * the one the surrounding scope's surface registered (`FieldRevealScope`).
   */
  reveal?: FieldReveal;
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
      result.push({
        path,
        message: String((value as { message: unknown }).message),
      });
    } else if (typeof value === "object") {
      // Recursively process nested errors
      result.push(...flattenErrors(value as FieldErrors<FieldValues>, path));
    }
  }

  return result;
}

export function FormErrorSummary({
  errors,
  submitCount = 0,
  maxErrors = 5,
  reveal: given,
}: FormErrorSummaryProps) {
  const scoped = useFieldReveal();
  const reveal = given ?? scoped ?? undefined;
  const errorList = flattenErrors(errors);

  // Stringify path-list to only re-fire toast when the *set* of errors changes,
  // avoiding infinite re-renders since `errors` object reference changes constantly.
  const errorPathKey = errorList.map(e => e.path).join(",");

  useEffect(() => {
    // Why: gate the toast behind an actual submit attempt. With RHF
    // `mode: "onBlur"`, validation also fires when a user clears a
    // required field and tabs away mid-edit — without this gate the
    // top-level toast would yell "Please fix the following errors"
    // before they've tried to save anything. Inline field-level
    // errors below each input are unaffected and still light up on
    // blur, which is the right place for that feedback. Once the
    // user actually clicks Save / Publish (`submitCount` increments),
    // the toast turns on and stays in sync with subsequent edits.
    if (submitCount === 0) {
      toast.dismiss("form-errors");
      return;
    }
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
              <ErrorRow
                key={path}
                path={path}
                message={message}
                show={reveal?.(path) ?? null}
              />
            ))}
          </ul>
          {remainingCount > 0 && (
            <p className="mt-2 text-sm">
              And {remainingCount} more error{remainingCount > 1 ? "s" : ""}...
            </p>
          )}
        </div>
      ),
    });
  }, [errorList, errorPathKey, maxErrors, submitCount, reveal]);

  return null;
}

/** The underlined, focusable look the message's buttons share. */
const ROW_BUTTON =
  "font-medium underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-danger-solid rounded-md inline-block";

/**
 * One field's line: its name and what is wrong. Where the surface can show
 * the field (`show`), the name is plain and "Show me" opens it, closing the
 * message; otherwise the name scrolls to the field on screen.
 */
function ErrorRow({
  path,
  message,
  show,
}: {
  path: string;
  message: string;
  show: (() => void) | null;
}) {
  const name = formatFieldPath(path);
  if (show === null) {
    return (
      <li className="text-sm">
        <button
          type="button"
          className={ROW_BUTTON}
          onClick={() => scrollToField(path)}
        >
          {name}
        </button>
        <span className="ml-1">: {message}</span>
      </li>
    );
  }
  return (
    <li className="text-sm">
      <span className="font-medium">{name}</span>
      <span className="ml-1">: {message}</span>{" "}
      <button
        type="button"
        className={ROW_BUTTON}
        aria-label={`Show me ${name}`}
        onClick={() => {
          toast.dismiss("form-errors");
          show();
        }}
      >
        Show me
      </button>
    </li>
  );
}
