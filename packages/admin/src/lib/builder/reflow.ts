// Why: WYSIWYG builder packs fields into auto-flow rows by width.
// Insertion-order-preserving greedy pack — each field joins the current row if
// it fits (sum <= 100), otherwise starts a new row. No backfilling.
//
// Called after every drag-drop and after Apply that changes a field's width,
// so the visual layout always reflects the current widths without manual fixup.

export type FieldWidth = 25 | 50 | 75 | 100;

export type WidthField = {
  id: string;
  width: FieldWidth;
  // Callers attach their own field shape via extra props; reflow only reads id+width.
  [key: string]: unknown;
};

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
