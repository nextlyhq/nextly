/**
 * Reading a registry record as the resolved draft-split question's input.
 *
 * `ctx.services.collections.getCollection()` is declared to return `Collection`,
 * which exposes its fields under `schemaDefinition` and promises no `status`,
 * `versions` or `localized` at the root. The record it actually returns carries
 * all three: the metadata service spreads the stored row before adding its
 * presentation keys, and the service then relabels the result.
 *
 * So the declared type and the returned object disagree, and neither can be
 * trusted alone. A cast would assert a promise the type does not make, and
 * reading `schemaDefinition.fields` alone would drop the properties the question
 * needs. This projects DEFENSIVELY instead — every property read as unknown and
 * checked — which is the only honest description of a value whose type
 * under-states it.
 *
 * It is published rather than left to each caller because the alternative is
 * every plugin writing this same projection, and a projection restated per
 * caller drifts from the type it feeds while all of them still compile.
 *
 * @module domains/versions/resolved-collection-view
 */
import type { FieldConfig } from "../../collections/fields/types";

import type { SchemaEligibilityCollection } from "./draft-split-eligibility";

/**
 * Project a registry record onto the shape the resolved question accepts.
 *
 * Takes `unknown` deliberately. The producer's declared type does not describe
 * what it returns, so a parameter naming that type would be documenting the
 * disagreement rather than handling it.
 *
 * `fields` is taken from the root and falls back to `schemaDefinition.fields`,
 * because the record carries both and only the second is in the declared type.
 */
export function resolvedCollectionView(
  value: unknown
): SchemaEligibilityCollection {
  const record = asRecord(value);
  return {
    ...(typeof record.status === "boolean" ? { status: record.status } : {}),
    ...(isVersions(record.versions) ? { versions: record.versions } : {}),
    fields: fieldsOf(record),
    ...(typeof record.slug === "string" ? { slug: record.slug } : {}),
  };
}

/** The record's own view of itself, or an empty one. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether a value is shaped like the RESOLVED versions config, or absent. */
function isVersions(
  value: unknown
): value is { drafts?: { enabled?: boolean } } | null {
  if (value === null || value === undefined) return true;
  return typeof value === "object";
}

/**
 * Top-level fields, from the root or from the declared `schemaDefinition`.
 *
 * The one place a registry value crosses into a typed shape, and the assertion
 * is confined to it deliberately. The registry stores field definitions and the
 * question needs them typed; nothing available here can check each member
 * without reimplementing the schema, which would be a second definition of what
 * a field is. So the trust is stated once, where it is taken, rather than
 * spread across every read.
 *
 * What IS checked is the only thing that can be: that there is an array at all.
 * An absent or non-array value answers an empty list rather than throwing — a
 * collection whose fields cannot be read declares no field the caller can act
 * on, which is the same conclusion by a safer route.
 */
function fieldsOf(record: Record<string, unknown>): FieldConfig[] {
  const own = Array.isArray(record.fields) ? record.fields : null;
  const schema = asRecord(record.schemaDefinition);
  const nested = Array.isArray(schema.fields) ? schema.fields : null;
  return (own ?? nested ?? []) as FieldConfig[];
}
