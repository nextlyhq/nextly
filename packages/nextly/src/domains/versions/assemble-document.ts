/**
 * Builds the canonical snapshot object stored in `nextly_versions.snapshot`.
 *
 * Composes an assembled document from the in-memory parts a write already holds
 * (the persisted parent row, component field values, and many-to-many id
 * arrays), so capture needs zero extra reads. The SAME shape is what the read
 * path returns, so a restored snapshot equals a normal read. Pure: inputs are
 * never mutated.
 *
 * @module domains/versions/assemble-document
 */

/** The in-memory pieces of a just-written document. */
export interface AssembleDocumentParts {
  /** The persisted parent row (adapter-returned, camelCase keys). */
  parentRow: Record<string, unknown>;
  /** Component field values keyed by field name (comp_ subtrees). */
  components?: Record<string, unknown>;
  /** Many-to-many related ids keyed by field name. */
  manyToMany?: Record<string, string[]>;
}

/**
 * Merge parent columns, component subtrees, and m2m id arrays into one plain
 * object. Component and m2m values are keyed by field name and overlay the
 * parent object (a parent placeholder column is never produced for those
 * fields, so there is nothing to clobber).
 */
export function assembleDocument(
  parts: AssembleDocumentParts
): Record<string, unknown> {
  return {
    ...parts.parentRow,
    ...(parts.components ?? {}),
    ...(parts.manyToMany ?? {}),
  };
}
