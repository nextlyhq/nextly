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

import { packFieldsIntoRows } from "@admin/lib/forms/pack-fields-into-rows";
import { cn } from "@admin/lib/utils";

import { FieldRow } from "./FieldRow";

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
  // Group fields by row (Q-D4=A: smart auto-pack widths). Width-packing rules
  // live in packFieldsIntoRows; FieldRow is the flex container.
  const rows = packFieldsIntoRows(fields);
  const content = (
    <div className={cn("space-y-6", className)}>
      {rows.map((row, i) => (
        <FieldRow
          key={getRowKey(row, i)}
          fields={row}
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
 * Stable key for a row. Prefers the first field's name (rows are
 * deterministic given the same input list), with the row index as fallback
 * for unnamed-layout-field rows.
 */
function getRowKey(row: FieldConfig[], index: number): string {
  const first = row[0];
  if (first && "name" in first && first.name) return `${first.name}-row`;
  return `row-${first?.type ?? "empty"}-${index}`;
}
