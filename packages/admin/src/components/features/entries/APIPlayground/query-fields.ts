/**
 * Turning a collection's schema into the choices its query params allow.
 *
 * The playground already knows every field the collection has, so nothing here
 * should have to be typed from memory. These are the rules for which fields a
 * given parameter can name, and how each parameter's wire format maps to and
 * from the controls.
 *
 * Pure on purpose: the wire formats are the part worth testing, and they are
 * easier to trust without a DOM around them.
 *
 * @module components/entries/APIPlayground/query-fields
 */

/** The parts of a field definition the playground needs. */
export interface PlaygroundField {
  name: string;
  type: string;
  label?: string;
}

/**
 * Field types that never reach the database as a column of their own — they
 * arrange other fields rather than hold a value.
 */
const LAYOUT_ONLY_TYPES = new Set(["row", "tabs", "ui", "collapsible"]);

/**
 * Types that occupy a column but hold something structured.
 *
 * Selectable (you can ask for them), never sortable: ordering rows by a JSON
 * blob or a foreign key sorts by its serialisation, which is not an order
 * anyone means to ask for.
 */
const NON_SCALAR_TYPES = new Set([
  "richText",
  "json",
  "relationship",
  "upload",
  "array",
  "blocks",
  "group",
  "component",
  "repeater",
]);

/**
 * Columns every collection has, which are absent from its field list because
 * nobody declared them.
 */
const SYSTEM_SORTABLE = ["id", "createdAt", "updatedAt"] as const;

/**
 * Columns the API returns whether or not they were asked for.
 *
 * Verified against the running API: `select={"title":true}` comes back with
 * `id`, `title`, `createdAt` and `updatedAt`.
 */
export const ALWAYS_RETURNED = ["id", "createdAt", "updatedAt"] as const;

/** Fields that can be named by `sort` or by a `where` condition. */
export function sortableFields(
  fields: PlaygroundField[] = [],
  hasStatus = false
): string[] {
  const declared = fields
    .filter(
      f => !LAYOUT_ONLY_TYPES.has(f.type) && !NON_SCALAR_TYPES.has(f.type)
    )
    .map(f => f.name);

  return [...SYSTEM_SORTABLE, ...(hasStatus ? ["status"] : []), ...declared];
}

/** Fields that can be named by `select`. */
export function selectableFields(fields: PlaygroundField[] = []): string[] {
  return fields.filter(f => !LAYOUT_ONLY_TYPES.has(f.type)).map(f => f.name);
}

/** A field's human label, falling back to the name the API uses. */
export function fieldLabel(
  name: string,
  fields: PlaygroundField[] = []
): string {
  return fields.find(f => f.name === name)?.label ?? name;
}

// ── sort ────────────────────────────────────────────────────────────────────

export interface SortValue {
  field: string;
  descending: boolean;
}

/** Read the API's `sort` format, where a leading `-` means descending. */
export function parseSort(value?: string): SortValue | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("-")
    ? { field: trimmed.slice(1), descending: true }
    : { field: trimmed, descending: false };
}

/** Write the API's `sort` format. */
export function formatSort(sort: SortValue | null): string {
  if (!sort?.field) return "";
  return sort.descending ? `-${sort.field}` : sort.field;
}

// ── select ──────────────────────────────────────────────────────────────────

/**
 * Read the API's `select` format.
 *
 * Only the object form does anything — a bare `select=title` is accepted and
 * then ignored by the API, so anything that is not an object of truthy keys
 * reads as "no selection".
 */
export function parseSelect(value?: string): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

/** Write the API's `select` format. Nothing chosen means the param is dropped. */
export function formatSelect(names: string[]): string {
  if (names.length === 0) return "";
  return JSON.stringify(Object.fromEntries(names.map(n => [n, true])));
}

// ── where ───────────────────────────────────────────────────────────────────

/** One row of the where builder. */
export interface WhereCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

/** Operators whose value is a list rather than a single term. */
export const LIST_OPERATORS = new Set(["in", "not_in"]);

/**
 * Write the API's `where` format from the rows on screen.
 *
 * A row that is still being written is skipped rather than sent: the API
 * ignores a condition it cannot read and returns everything, so sending one
 * would quietly answer a different question than the screen is asking.
 *
 * This is one-way on purpose. The rows are the state; `where` is derived from
 * them at the edge. Deriving the rows back out of `where` cannot work — an
 * empty row has no representation in the wire format, so a newly added
 * condition would round-trip straight back to nothing.
 */
export function formatWhere(conditions: WhereCondition[]): string {
  const where: Record<string, Record<string, unknown>> = {};

  for (const condition of conditions) {
    const needsValue = condition.operator !== "exists";
    if (!condition.field || (needsValue && !condition.value)) continue;

    let value: unknown = condition.value;
    if (LIST_OPERATORS.has(condition.operator)) {
      value = condition.value
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
      if ((value as string[]).length === 0) continue;
    } else if (condition.operator === "exists") {
      value = condition.value.toLowerCase() !== "false";
    }

    // Merged, not assigned: a field holds an object of operators, and two
    // conditions on one field is the ordinary way to write a range —
    // `createdAt` after X and before Y. Overwriting dropped the earlier one
    // and sent half the question with no sign that it had.
    where[condition.field] = {
      ...where[condition.field],
      [condition.operator]: value,
    };
  }

  return Object.keys(where).length > 0 ? JSON.stringify(where) : "";
}
