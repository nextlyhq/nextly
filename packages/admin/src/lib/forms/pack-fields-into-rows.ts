import type { FieldConfig } from "@revnixhq/nextly/config";

/**
 * Field types that always render as their own row, regardless of admin.width.
 * They contain nested sub-content (group, array, etc.) or are layout primitives
 * (tabs, row, collapsible) that introduce their own visual structure. RichText
 * is included because it's a tall content surface that doesn't compose well
 * side-by-side with other fields.
 */
const BLOCK_FIELD_TYPES = new Set([
  "tabs",
  "row",
  "collapsible",
  "group",
  "array",
  "blocks",
  "component",
  "richText",
]);

/**
 * Parses an `admin.width` string ("50%", "33%", "100%", etc.) into a number 0-100.
 * Returns 100 when the value is missing, malformed, or out of range — full
 * width is the safe default since it never overflows a row's running sum.
 */
function parseWidth(width: string | undefined): number {
  if (!width) return 100;
  const match = /^(\d+(?:\.\d+)?)%$/.exec(width.trim());
  if (!match) return 100;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return 100;
  return n;
}

function isBlockField(field: FieldConfig): boolean {
  return BLOCK_FIELD_TYPES.has(field.type);
}

/**
 * Packs a flat list of fields into rows, respecting admin.width and block-field
 * rules. Consecutive non-block fields whose widths sum to ≤100 share a row;
 * a block field, a full-width field, or a field that would overflow the running
 * row starts a new row.
 *
 * Pure function — no side effects, no React, easy to unit-test. Consumed by
 * EntryFormContent which renders each row inside a flex container.
 */
export function packFieldsIntoRows(fields: FieldConfig[]): FieldConfig[][] {
  const rows: FieldConfig[][] = [];
  let current: FieldConfig[] = [];
  let runningSum = 0;

  const flush = () => {
    if (current.length > 0) {
      rows.push(current);
      current = [];
      runningSum = 0;
    }
  };

  for (const field of fields) {
    if (isBlockField(field)) {
      flush();
      rows.push([field]);
      continue;
    }

    const widthValue = (field as { admin?: { width?: string } }).admin?.width;
    const w = parseWidth(widthValue);

    if (w >= 100) {
      flush();
      rows.push([field]);
      continue;
    }

    if (runningSum + w > 100) {
      flush();
    }
    current.push(field);
    runningSum += w;
  }

  flush();
  return rows;
}
