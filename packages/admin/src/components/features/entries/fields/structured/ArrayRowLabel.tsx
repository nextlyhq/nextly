/**
 * Array Row Label Component
 *
 * Renders the label for each row in an array field.
 * Supports custom label components and smart label extraction from row data.
 *
 * @module components/entries/fields/structured/ArrayRowLabel
 * @since 1.0.0
 */

import type {
  ArrayFieldConfig,
  ArrayRowLabelProps,
} from "@revnixhq/nextly/config";

// ============================================================
// Types
// ============================================================

export interface ArrayRowLabelComponentProps {
  /**
   * Zero-based index of this row in the array.
   */
  index: number;

  /**
   * The array field configuration.
   */
  field: ArrayFieldConfig;

  /**
   * The data for this specific array row.
   */
  data: Record<string, unknown>;
}

// ============================================================
// Constants
// ============================================================

/**
 * Field names to check for extracting a display title from row data.
 * Checked in order of priority.
 */
const TITLE_FIELD_NAMES = [
  "title",
  "name",
  "label",
  "heading",
  "subject",
] as const;

// ============================================================
// Component
// ============================================================

/**
 * ArrayRowLabel renders the label for each row in an array field.
 *
 * Label Resolution Priority:
 * 1. Custom RowLabel component from field.admin.components.RowLabel
 * 2. Value from a title-like field in the row data (title, name, label, etc.)
 * 3. Fallback to "{singular} {index + 1}" pattern
 *
 * @example Default behavior
 * ```tsx
 * <ArrayRowLabel index={0} field={faqField} data={{ question: "What is...?" }} />
 * // Renders: "Question 1" (using labels.singular)
 * ```
 *
 * @example With title field in data
 * ```tsx
 * <ArrayRowLabel index={0} field={slidesField} data={{ title: "Hero Slide" }} />
 * // Renders: "Hero Slide"
 * ```
 *
 * @example With custom RowLabel component
 * ```tsx
 * // In field config:
 * admin: {
 *   components: {
 *     RowLabel: ({ data, index }) => <span>{data.question || `Q${index + 1}`}</span>
 *   }
 * }
 * ```
 */
export function ArrayRowLabel({
  index,
  field,
  data,
}: ArrayRowLabelComponentProps) {
  // 1. Check for custom RowLabel component
  const CustomRowLabel = field.admin?.components?.RowLabel;
  if (CustomRowLabel) {
    // Build props matching ArrayRowLabelProps interface
    const labelProps: ArrayRowLabelProps = {
      data,
      index,
      path: field.name ? `${field.name}.${index}` : String(index),
    };
    return <CustomRowLabel {...labelProps} />;
  }

  // 2. Try to extract a title from common field names
  for (const fieldName of TITLE_FIELD_NAMES) {
    const value = data[fieldName];
    if (value !== undefined && value !== null && value !== "") {
      return (
        <span className="font-medium text-foreground truncate">
          {String(value)}
        </span>
      );
    }
  }

  // 3. Also check if any sub-field is marked as useAsTitle
  // (useAsTitle pattern for array row labels)
  const titleField = field.fields?.find(
    f =>
      "name" in f &&
      (f.admin as { useAsTitle?: boolean } | undefined)?.useAsTitle
  );
  if (titleField && "name" in titleField && titleField.name) {
    const value = data[titleField.name];
    if (value !== undefined && value !== null && value !== "") {
      return (
        <span className="font-medium text-foreground truncate">
          {String(value)}
        </span>
      );
    }
  }

  // 4. Fallback to generic label with index
  const singularLabel = field.labels?.singular || "Item";
  return (
    <span className="font-medium text-muted-foreground">
      {singularLabel} {index + 1}
    </span>
  );
}

// ============================================================
// Exports
// ============================================================
