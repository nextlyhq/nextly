import type { ResolvedDraftSplitCollection } from "@nextlyhq/plugin-sdk";

/**
 * Reading a registry record as the draft-split question's input.
 *
 * `ctx.services.collections.getCollection()` is declared to return `Collection`,
 * which exposes its fields under `schemaDefinition` and promises no `status`,
 * `versions` or `localized` at the root. The record it actually returns carries
 * all three, because the metadata service spreads the stored row before adding
 * its presentation keys.
 *
 * So the declared type and the returned object disagree, and neither can be
 * trusted alone: a cast would assert a promise the type does not make, and
 * reading `schemaDefinition.fields` alone would drop the properties the
 * question needs. This projects DEFENSIVELY instead — every property read as
 * unknown and checked — which is the only honest description of a value whose
 * type under-states it.
 *
 * @module class-usage-collection-view
 */

/**
 * The shape the resolved-form draft-split question accepts.
 *
 * ALIASED from the published type rather than restated. A restatement compiles
 * happily while drifting from the thing it feeds, and this package has already
 * paid for one: a hand-written Direct API shape described the collection
 * service's inner payload, so every index query read an empty page with a green
 * suite throughout.
 */
export type ResolvedCollectionView = ResolvedDraftSplitCollection;

/**
 * Project a registry record onto that shape.
 *
 * `fields` is taken from the root and falls back to `schemaDefinition.fields`,
 * because the record carries both and only the second is in the declared type.
 * An absent or non-array value answers an empty list rather than throwing: a
 * collection whose fields cannot be read declares no blocks field as far as
 * this index is concerned, which is the same conclusion by a safer route.
 */
export function resolvedCollectionView(value: unknown): ResolvedCollectionView {
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
 * without reimplementing core's schema, which would be a second definition of
 * what a field is. So the trust is stated once, where it is taken, rather than
 * spread across every read.
 *
 * What IS checked is the only thing that can be: that there is an array at all.
 * An absent or non-array value answers an empty list rather than throwing — a
 * collection whose fields cannot be read declares no blocks field as far as
 * this index is concerned, which is the same conclusion by a safer route.
 */
function fieldsOf(
  record: Record<string, unknown>
): ResolvedDraftSplitCollection["fields"] {
  const own = Array.isArray(record.fields) ? record.fields : null;
  const schema = asRecord(record.schemaDefinition);
  const nested = Array.isArray(schema.fields) ? schema.fields : null;
  return (own ?? nested ?? []) as ResolvedDraftSplitCollection["fields"];
}
