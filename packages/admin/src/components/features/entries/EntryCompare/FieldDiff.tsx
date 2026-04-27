/**
 * Field Diff Component
 *
 * Displays side-by-side comparison cards for a single field,
 * highlighting differences between left and right values.
 *
 * @module components/entries/EntryCompare/FieldDiff
 * @since 1.0.0
 */

import { Card, CardContent, CardHeader, CardTitle } from "@revnixhq/ui";

import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { cn } from "@admin/lib/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal field definition for diff display.
 */
export interface FieldForDiff {
  /** Field name (key in entry data) */
  name: string;
  /** Display label for the field */
  label?: string;
  /** Field type for specialized formatting */
  type?: string;
}

/**
 * Props for the FieldDiff component.
 */
export interface FieldDiffProps {
  /** Field definition */
  field: FieldForDiff;
  /** Value from the left entry */
  leftValue: unknown;
  /** Value from the right entry */
  rightValue: unknown;
  /** Whether the values are different */
  isDifferent: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats a value for display in the diff view.
 * Handles null, undefined, objects, arrays, booleans, and primitives.
 *
 * @param value - The value to format
 * @param fieldType - Optional field type for specialized formatting
 * @returns Formatted string representation
 */
function formatValue(value: unknown, fieldType?: string): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return "(empty)";
  }

  // Handle booleans
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  // Handle dates
  if (fieldType === "date" && typeof value === "string") {
    try {
      const formatted = formatDateWithAdminTimezone(
        value,
        {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
        ""
      );
      if (formatted) {
        return formatted;
      }
    } catch {
      // Fall through to default handling
    }
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "(empty array)";
    }
    return JSON.stringify(value, null, 2);
  }

  // Handle objects (including relationship objects)
  if (typeof value === "object") {
    // Try to extract a display label from common fields
    const obj = value as Record<string, unknown>;
    if (obj.title || obj.name || obj.label || obj.email) {
      const label = obj.title || obj.name || obj.label || obj.email;
      return String(label);
    }
    return JSON.stringify(value, null, 2);
  }

  // Handle primitives
  return String(value);
}

/**
 * Checks if a value should use pre-formatted display (multiline).
 *
 * @param value - The value to check
 * @returns Whether to use pre-formatted display
 */
function shouldUsePreFormat(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value) && value.length > 0) return true;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Use pre-format if it's a complex object (not a simple labeled object)
    if (!obj.title && !obj.name && !obj.label && !obj.email) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Component
// ============================================================================

/**
 * FieldDiff - Side-by-side field comparison cards
 *
 * Renders two cards (left and right) showing the field values from
 * each entry. Differences are highlighted with color coding:
 * - Left (original): Red border and background when different
 * - Right (comparison): Green border and background when different
 *
 * @param props - Component props
 * @returns Two Card components for the grid layout
 *
 * @example
 * ```tsx
 * <FieldDiff
 *   field={{ name: "title", label: "Title" }}
 *   leftValue="Original Title"
 *   rightValue="Updated Title"
 *   isDifferent={true}
 * />
 * ```
 */
export function FieldDiff({
  field,
  leftValue,
  rightValue,
  isDifferent,
}: FieldDiffProps) {
  const leftFormatted = formatValue(leftValue, field.type);
  const rightFormatted = formatValue(rightValue, field.type);
  const usePreFormat =
    shouldUsePreFormat(leftValue) || shouldUsePreFormat(rightValue);

  const displayLabel = field.label || field.name;

  return (
    <>
      {/* Left side card */}
      <Card
        className={cn(
          "transition-colors",
          isDifferent &&
            "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
        )}
      >
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {displayLabel}
            {isDifferent && (
              <span className="text-xs font-normal text-red-600 dark:text-red-400">
                modified
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 px-3">
          {usePreFormat ? (
            <pre className="text-sm whitespace-pre-wrap break-words font-mono bg-muted/50 p-2 rounded max-h-48 overflow-auto">
              {leftFormatted}
            </pre>
          ) : (
            <p className="text-sm break-words">{leftFormatted}</p>
          )}
        </CardContent>
      </Card>

      {/* Right side card */}
      <Card
        className={cn(
          "transition-colors",
          isDifferent &&
            "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
        )}
      >
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {displayLabel}
            {isDifferent && (
              <span className="text-xs font-normal text-green-600 dark:text-green-400">
                modified
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 px-3">
          {usePreFormat ? (
            <pre className="text-sm whitespace-pre-wrap break-words font-mono bg-muted/50 p-2 rounded max-h-48 overflow-auto">
              {rightFormatted}
            </pre>
          ) : (
            <p className="text-sm break-words">{rightFormatted}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
