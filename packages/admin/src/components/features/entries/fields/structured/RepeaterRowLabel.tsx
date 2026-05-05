/**
 * Array Row Label Component
 *
 * Renders the label for each row in an array field.
 * Supports custom label components and smart label extraction from row data.
 *
 * @module components/entries/fields/structured/RepeaterRowLabel
 * @since 1.0.0
 */

import type {
  RepeaterFieldConfig,
  RepeaterRowLabelProps,
} from "@revnixhq/nextly/config";

// ============================================================
// Types
// ============================================================

export interface RepeaterRowLabelComponentProps {
  /**
   * Zero-based index of this row in the array.
   */
  index: number;

  /**
   * The array field configuration.
   */
  field: RepeaterFieldConfig;

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
 * RepeaterRowLabel renders the label for each row in a Repeater field.
 *
 * Label Resolution Priority:
 * 1. Custom RowLabel component from `field.admin.components.RowLabel`
 * 2. Value from the field explicitly chosen via `field.rowLabelField` (the
 *    Builder's "Collapsed row title" dropdown)
 * 3. Value from a conventional title-like field in the row data
 *    (title, name, label, heading, subject)
 * 4. Value from any sub-field marked `admin.useAsTitle: true`
 * 5. Fallback to "{labels.singular} {index + 1}"
 *
 * @example Default behavior with a `title` sub-field
 * ```tsx
 * <RepeaterRowLabel index={0} field={slidesField} data={{ title: "Hero Slide" }} />
 * // Renders: "Hero Slide"
 * ```
 *
 * @example Explicit rowLabelField
 * ```ts
 * repeater({
 *   name: "faqs",
 *   labels: { singular: "FAQ", plural: "FAQs" },
 *   rowLabelField: "question",
 *   fields: [text({ name: "question" }), textarea({ name: "answer" })],
 * })
 * // Collapsed rows show each FAQ's question text instead of "FAQ 1, FAQ 2".
 * ```
 *
 * @example Custom RowLabel component (highest priority)
 * ```tsx
 * admin: {
 *   components: {
 *     RowLabel: ({ data, index }) => <span>{data.question || `Q${index + 1}`}</span>
 *   }
 * }
 * ```
 */
export function RepeaterRowLabel({
  index,
  field,
  data,
}: RepeaterRowLabelComponentProps) {
  // 1. Custom RowLabel component overrides everything else.
  const CustomRowLabel = field.admin?.components?.RowLabel;
  if (CustomRowLabel) {
    const labelProps: RepeaterRowLabelProps = {
      data,
      index,
      path: field.name ? `${field.name}.${index}` : String(index),
    };
    return <CustomRowLabel {...labelProps} />;
  }

  // 2. Explicit rowLabelField from the Builder's "Collapsed row title"
  //    dropdown. Read the named sub-field's value from the row; if it's a
  //    non-empty string-able value, use it.
  const explicitField = (field as { rowLabelField?: string }).rowLabelField;
  if (explicitField) {
    const value = data[explicitField];
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return (
        <span className="font-medium text-foreground truncate">
          {String(value)}
        </span>
      );
    }
  }

  // 3. Auto-detect from common field names.
  for (const fieldName of TITLE_FIELD_NAMES) {
    const value = data[fieldName];
    if (value !== undefined && value !== null && value !== "") {
      return (
        <span className="font-medium text-foreground truncate">
          {/* eslint-disable-next-line @typescript-eslint/no-base-to-string */}
          {String(value)}
        </span>
      );
    }
  }

  // 4. Sub-field marked admin.useAsTitle: true.
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
          {/* eslint-disable-next-line @typescript-eslint/no-base-to-string */}
          {String(value)}
        </span>
      );
    }
  }

  // 5. Generic fallback.
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
