/**
 * Entry Form Content Component
 *
 * Renders all collection fields using the FieldRenderer component.
 * Handles the main content area of the entry form, mapping over
 * collection schema fields and rendering appropriate inputs.
 *
 * @module components/entries/EntryForm/EntryFormContent
 * @since 1.0.0
 */

import type { FieldConfig } from "@revnixhq/nextly/config";
import { Card, CardContent } from "@revnixhq/ui";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { cn } from "@admin/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormContentProps {
  /** Array of field configurations from collection schema */
  fields: FieldConfig[];
  /** Whether all fields should be disabled */
  disabled?: boolean;
  /** Whether all fields should be read-only */
  readOnly?: boolean;
  /** Whether to wrap content in a card (standalone mode) */
  withCard?: boolean;
  /** Optional custom CSS classes for the container */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormContent - Renders collection fields
 *
 * Maps over the collection's field schema and renders each field
 * using the FieldRenderer component. FieldRenderer handles:
 * - Type-based input component selection
 * - Field wrapping with labels and errors
 * - Nested field path computation
 * - Layout field rendering (tabs, rows, collapsibles)
 *
 * @example Basic usage
 * ```tsx
 * <EntryFormContent
 *   fields={collection.schemaDefinition.fields}
 * />
 * ```
 *
 * @example With card wrapper (standalone page)
 * ```tsx
 * <EntryFormContent
 *   fields={collection.schemaDefinition.fields}
 *   withCard
 * />
 * ```
 *
 * @example Disabled state
 * ```tsx
 * <EntryFormContent
 *   fields={collection.schemaDefinition.fields}
 *   disabled={isSubmitting}
 * />
 * ```
 */
export function EntryFormContent({
  fields,
  disabled = false,
  readOnly = false,
  withCard = false,
  className,
}: EntryFormContentProps) {
  const content = (
    <div className={cn("space-y-6", className)}>
      {fields.map((field, index) => (
        <FieldRenderer
          key={getFieldKey(field, index)}
          field={field}
          disabled={disabled}
          readOnly={readOnly}
        />
      ))}
    </div>
  );

  if (withCard) {
    return (
      <Card>
        <CardContent className="pt-6">{content}</CardContent>
      </Card>
    );
  }

  return content;
}

/**
 * Generates a stable key for a field
 */
function getFieldKey(field: FieldConfig, index: number): string {
  // Use field name if available, otherwise fall back to index
  if ("name" in field && field.name) {
    return field.name as string;
  }
  // For layout fields without names, use type + index
  return `${field.type}-${index}`;
}
