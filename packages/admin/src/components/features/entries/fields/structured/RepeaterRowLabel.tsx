/**
 * Repeater Row Label Component
 *
 * Renders the label for each row in a repeater field.
 * Supports custom label components and smart label extraction from row data.
 *
 * @module components/entries/fields/structured/RepeaterRowLabel
 * @since 1.0.0
 */

import type { RepeaterFieldConfig, RepeaterRowLabelProps } from "nextly/config";
import type { JSX } from "react";

import { repeaterRowTitle } from "./repeater-row-title";

// ============================================================
// Types
// ============================================================

export interface RepeaterRowLabelComponentProps {
  /**
   * Zero-based index of this row in the array.
   */
  index: number;

  /**
   * The repeater field configuration.
   */
  field: RepeaterFieldConfig;

  /**
   * The data for this specific array row.
   */
  data: Record<string, unknown>;
}

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
}: RepeaterRowLabelComponentProps): JSX.Element {
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

  // 2-5. The row's title in words, read where every surface that names a row
  //      reads it, so the header and the Page Builder's name for this row
  //      cannot disagree.
  const { title, fromContent } = repeaterRowTitle(field, data, index);
  return (
    <span
      className={
        fromContent
          ? "font-medium text-foreground truncate"
          : "font-medium text-muted-foreground"
      }
    >
      {title}
    </span>
  );
}

// ============================================================
// Exports
// ============================================================
