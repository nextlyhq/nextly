/**
 * The values `nextly_translation_provenance` holds in its closed columns.
 *
 * @module schemas/translation-provenance/types
 */

/** What a provenance row is about: a collection entry or a Single. */
export type ProvenanceScopeKind = "collection" | "single";

/** Whether the row records the live value or the language's working draft. */
export type ProvenancePartState = "live" | "draft";

/**
 * Where a value came from. `original` is written in its own language and has no
 * source; `unknown` is a value whose origin was never recorded.
 */
export type ProvenanceOrigin =
  | "person"
  | "agent"
  | "machine"
  | "integration"
  | "import"
  | "copy"
  | "original"
  | "unknown";

/** Every origin, in the order the type lists them. */
export const PROVENANCE_ORIGINS: readonly ProvenanceOrigin[] = [
  "person",
  "agent",
  "machine",
  "integration",
  "import",
  "copy",
  "original",
  "unknown",
];
