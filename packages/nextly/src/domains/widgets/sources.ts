/**
 * What a widget may read FROM.
 *
 * A source is addressed by a stable string id -- `collection:posts`,
 * `system:users`, `plugin:stripe/revenue` -- and declares the fields and
 * operations it exposes. A widget query names a source id and declared field
 * names; it never names a table or a column, which is what keeps caller input
 * away from the compiler.
 *
 * Validation lives at registration, the same pattern Task 2's widget
 * registry uses for `registerWidget`/`validateWidgetDefinition`: a malformed
 * source fails loudly at boot rather than quietly admitting, say, an empty
 * `fields` list that would make every query against it fail "undeclared
 * field" for every field name a caller could possibly send.
 *
 * @module domains/widgets/sources
 */

import { NextlyError } from "../../errors/nextly-error";

export const WIDGET_OPS = ["count", "list", "groupBy", "timeseries"] as const;
export type WidgetOp = (typeof WIDGET_OPS)[number];

export const WIDGET_SOURCE_KINDS = [
  "collection",
  "single",
  "system",
  "plugin",
] as const;
export type WidgetSourceKind = (typeof WIDGET_SOURCE_KINDS)[number];

export const WIDGET_SOURCE_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
] as const;
export type WidgetSourceFieldType = (typeof WIDGET_SOURCE_FIELD_TYPES)[number];

export interface WidgetSourceField {
  name: string;
  type: WidgetSourceFieldType;
}

export interface WidgetSource {
  /** e.g. "collection:posts", "system:users", "plugin:stripe/revenue". */
  id: string;
  label: string;
  kind: WidgetSourceKind;
  /** Gates who may SELECT this source when configuring a widget. */
  requiredPermission?: string;
  supports: readonly WidgetOp[];
  /** The only field names a query may reference. */
  fields: readonly WidgetSourceField[];
}

// A malformed widget source is a plugin/core author's mistake, not end-user
// input, so this uses `invalidInput` (developer-facing, safe to surface
// verbatim) -- mirrors `definition.ts`'s `fail`.
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget source: ${message}`,
  });
}

/** Confirms `id` is present and non-blank. */
function validateSourceId(s: Partial<WidgetSource>): void {
  if (typeof s.id !== "string" || s.id.trim() === "") {
    fail(`id is required and must be a non-empty string, got ${String(s.id)}`);
  }
}

/** Confirms `label` carries real, non-whitespace text. */
function validateSourceLabel(s: Partial<WidgetSource>): void {
  if (typeof s.label !== "string" || s.label.trim() === "") {
    fail(`${s.id}: label is required`);
  }
}

/** Confirms `kind` is one of the known values. */
function validateSourceKind(s: Partial<WidgetSource>): void {
  if (!WIDGET_SOURCE_KINDS.includes(s.kind as WidgetSourceKind)) {
    fail(`${s.id}: kind must be one of ${WIDGET_SOURCE_KINDS.join(", ")}`);
  }
}

/**
 * Confirms `supports` is a non-empty array of known ops. Empty `supports`
 * would register a source no query could ever validate against -- every
 * `validateWidgetQuery` call would fail at the op check, which is a startup
 * mistake worth catching here rather than at first use.
 */
function validateSourceSupports(s: Partial<WidgetSource>): void {
  if (!Array.isArray(s.supports) || s.supports.length === 0) {
    fail(`${s.id}: supports must be a non-empty array of ops`);
  }
  for (const op of s.supports as unknown[]) {
    if (!WIDGET_OPS.includes(op as WidgetOp)) {
      fail(`${s.id}: supports names an unknown op "${String(op)}"`);
    }
  }
}

/**
 * Confirms `fields` is a non-empty array of well-formed, uniquely-named
 * fields. A duplicate field name would make `validateWidgetQuery`'s
 * declared-field set silently collapse two fields into one entry, so it is
 * refused here rather than discovered later as a query that mysteriously
 * reads the wrong column.
 */
function validateSourceFields(s: Partial<WidgetSource>): void {
  if (!Array.isArray(s.fields) || s.fields.length === 0) {
    fail(`${s.id}: fields must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const raw of s.fields as unknown[]) {
    const field = raw as Partial<WidgetSourceField> | null | undefined;
    if (typeof field?.name !== "string" || field.name.trim() === "") {
      fail(`${s.id}: every field requires a non-empty name`);
    }
    if (
      !WIDGET_SOURCE_FIELD_TYPES.includes(field.type as WidgetSourceFieldType)
    ) {
      fail(
        `${s.id}: field "${field.name}" has an unknown type "${String(field.type)}"`
      );
    }
    if (seen.has(field.name)) {
      fail(`${s.id}: field "${field.name}" is declared more than once`);
    }
    seen.add(field.name);
  }
}

/** Throws with a named reason if `source` is not a usable widget source. */
export function validateWidgetSource(
  source: unknown
): asserts source is WidgetSource {
  if (typeof source !== "object" || source === null) fail("expected an object");
  const s = source as Partial<WidgetSource>;

  validateSourceId(s);
  validateSourceLabel(s);
  validateSourceKind(s);
  validateSourceSupports(s);
  validateSourceFields(s);
}

const globalForSources = globalThis as unknown as {
  __nextly_widget_sources?: Map<string, WidgetSource>;
};

function store(): Map<string, WidgetSource> {
  globalForSources.__nextly_widget_sources ??= new Map();
  return globalForSources.__nextly_widget_sources;
}

/** Register a source. Throws if it is malformed, or if the id is already taken. */
export function registerSource(source: WidgetSource): void {
  validateWidgetSource(source);
  const existing = store().get(source.id);
  if (existing) {
    throw NextlyError.conflict({
      message: `Widget source "${source.id}" is already registered.`,
    });
  }
  store().set(source.id, source);
}

export function getSource(id: string): WidgetSource | undefined {
  return store().get(id);
}

export function listSources(): WidgetSource[] {
  return [...store().values()];
}

export function clearSources(): void {
  store().clear();
}
