// Why: WYSIWYG builder packs fields into auto-flow rows by width.
// Insertion-order-preserving greedy pack — each field joins the current row if
// it fits (sum <= 100), otherwise starts a new row. No backfilling.
//
// Called after every drag-drop and after Apply that changes a field's width,
// so the visual layout always reflects the current widths without manual fixup.

/**
 * Numeric width as a percentage of the row (1-100).
 * Existing data uses 25/33/50/66/75/100; the algorithm itself is value-agnostic
 * and works for any number — the type is `number` for forward compatibility.
 */
export type RowWidth = number;

export type WidthField = {
  id: string;
  width: RowWidth;
  // Callers attach their own field shape via extra props; reflow only reads id+width.
  [key: string]: unknown;
};

/**
 * Parse the legacy string width form (`"50%"`, `"33%"`) into a number.
 * Falls back to 100 for missing or unparseable input so layout never crashes.
 */
export function parseWidth(
  input: string | number | undefined | null
): RowWidth {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return 100;
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 100;
}

export function packIntoRows<T extends WidthField>(fields: T[]): T[][] {
  const rows: T[][] = [];
  let current: T[] = [];
  let sum = 0;

  for (const field of fields) {
    if (sum + field.width > 100) {
      if (current.length > 0) rows.push(current);
      current = [field];
      sum = field.width;
    } else {
      current.push(field);
      sum += field.width;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}
