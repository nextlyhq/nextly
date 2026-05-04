"use client";

/**
 * JSON Input Component
 *
 * A textarea-based JSON editor that integrates with React Hook Form.
 * Provides JSON validation, formatting, and clear error display.
 *
 * @module components/entries/fields/structured/JsonInput
 * @since 1.0.0
 */

import type { JSONFieldConfig } from "@revnixhq/nextly/config";
import { Button, Textarea } from "@revnixhq/ui";
import { useState, useCallback, useEffect } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { Braces, Check, AlertCircle } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface JsonInputProps<
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
  field: JSONFieldConfig;

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
   * Additional CSS classes for the container.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Attempts to parse JSON string and returns the parsed value or an error.
 */
function tryParseJSON(
  value: string
): { success: true; data: unknown } | { success: false; error: string } {
  if (!value.trim()) {
    return { success: true, data: null };
  }

  try {
    const parsed = JSON.parse(value);
    return { success: true, data: parsed };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Invalid JSON";
    return { success: false, error };
  }
}

/**
 * Converts a value to a formatted JSON string.
 */
function toJsonString(value: unknown, tabSize: number = 2): string {
  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value, null, tabSize);
  } catch {
    return "";
  }
}

// ============================================================
// Component
// ============================================================

/**
 * JsonInput provides a textarea-based JSON editor with validation.
 *
 * Features:
 * - React Hook Form integration via useController
 * - JSON validation on blur with clear error messages
 * - Format/prettify button
 * - Monospace font for code readability
 * - Read-only and disabled states
 * - Stores parsed JSON object (not string) in form
 *
 * Note: This component renders the textarea and format button.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example Basic usage
 * ```tsx
 * <FieldWrapper field={metadataField} error={errors.metadata?.message}>
 *   <JsonInput
 *     name="metadata"
 *     field={metadataField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example Read-only mode
 * ```tsx
 * <JsonInput
 *   name="config"
 *   field={configField}
 *   control={control}
 *   readOnly
 * />
 * ```
 */
export function JsonInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: JsonInputProps<TFieldValues>) {
  // Get editor options from field config
  const editorOptions = field.admin?.editorOptions ?? {};
  const tabSize = editorOptions.tabSize ?? 2;
  const formatOnBlur = editorOptions.formatOnBlur ?? true;
  const validateOnChange = editorOptions.validateOnChange ?? true;
  const height = editorOptions.height ?? 200;

  // Get default value - handle function default values
  const getDefaultValue = () => {
    if (typeof field.defaultValue === "function") {
      return field.defaultValue({});
    }
    return field.defaultValue ?? null;
  };

  // React Hook Form controller
  const {
    field: { value, onChange },
    fieldState: { invalid },
  } = useController({
    name,
    control,
    defaultValue: getDefaultValue() as TFieldValues[Path<TFieldValues>],
  });

  // Local state for the text representation
  const [textValue, setTextValue] = useState<string>(() =>
    toJsonString(value, tabSize)
  );

  // Parse error state (separate from form validation)
  const [parseError, setParseError] = useState<string | null>(null);

  // Track if JSON was just formatted
  const [justFormatted, setJustFormatted] = useState(false);

  // Sync text value when form value changes externally
  useEffect(() => {
    const newTextValue = toJsonString(value, tabSize);
    // Only update if the parsed values are different (avoid cursor jumps)
    const currentParsed = tryParseJSON(textValue);
    if (currentParsed.success) {
      const currentJson = JSON.stringify(currentParsed.data);
      const newJson = JSON.stringify(value);
      if (currentJson !== newJson) {
        setTextValue(newTextValue);
      }
    } else {
      // If current text is invalid, update to the valid form value
      setTextValue(newTextValue);
      setParseError(null);
    }
    // Reason: textValue is intentionally excluded — including it would cause a
    // feedback loop since this effect updates textValue based on external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tabSize]);

  // Handle text changes
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setTextValue(newText);
      setJustFormatted(false);

      // Validate on change if enabled
      if (validateOnChange) {
        const result = tryParseJSON(newText);
        if (result.success) {
          setParseError(null);
          onChange(result.data);
        } else {
          setParseError(result.error);
          // Don't update form value for invalid JSON
        }
      }
    },
    [onChange, validateOnChange]
  );

  // Handle blur - validate and optionally format
  const handleBlur = useCallback(() => {
    const result = tryParseJSON(textValue);

    if (result.success) {
      setParseError(null);
      onChange(result.data);

      // Format on blur if enabled
      if (formatOnBlur && result.data !== null) {
        const formatted = toJsonString(result.data, tabSize);
        if (formatted !== textValue) {
          setTextValue(formatted);
        }
      }
    } else {
      setParseError(result.error);
    }
  }, [textValue, onChange, formatOnBlur, tabSize]);

  // Format button handler
  const handleFormat = useCallback(() => {
    const result = tryParseJSON(textValue);

    if (result.success && result.data !== null) {
      const formatted = toJsonString(result.data, tabSize);
      setTextValue(formatted);
      setParseError(null);
      setJustFormatted(true);

      // Clear the "just formatted" indicator after a moment
      setTimeout(() => setJustFormatted(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    }
  }, [textValue, tabSize]);

  // Check if format button should be enabled
  const canFormat = !disabled && !readOnly && textValue.trim().length > 0;
  const isValidJson = parseError === null && textValue.trim().length > 0;

  // Compute height style
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Textarea */}
      <div className="relative">
        <Textarea
          id={name}
          value={textValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={field.admin?.placeholder ?? "{\n  \n}"}
          aria-invalid={invalid || parseError !== null || undefined}
          aria-describedby={parseError ? `${name}-error` : undefined}
          className={cn(
            "font-mono text-sm resize-y",
            "min-h-[100px]",
            readOnly && "bg-primary/5 cursor-not-allowed",
            parseError && "border-destructive focus:border-destructive focus:outline-none"
          )}
          style={{ height: heightStyle }}
        />
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between gap-2">
        {/* Parse error message */}
        {parseError && (
          <div
            id={`${name}-error`}
            className="flex items-center gap-1.5 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{parseError}</span>
          </div>
        )}

        {/* Success indicator when valid */}
        {!parseError && isValidJson && !justFormatted && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            <span>Valid JSON</span>
          </div>
        )}

        {/* Just formatted indicator */}
        {justFormatted && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            <span>Formatted</span>
          </div>
        )}

        {/* Empty state */}
        {!parseError && !isValidJson && !justFormatted && (
          <div className="text-sm text-muted-foreground">Enter valid JSON</div>
        )}

        {/* Format button */}
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={handleFormat}
          disabled={!canFormat || !!parseError}
          className="flex-shrink-0"
        >
          <Braces className="h-4 w-4" />
          Format
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
