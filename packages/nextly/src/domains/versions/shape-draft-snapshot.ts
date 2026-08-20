/**
 * Shaping a stored working-draft snapshot into the document a read returns.
 *
 * A snapshot is written under one schema and read under whatever the schema is
 * now. Between those two moments a field can be dropped or renamed, leaving a
 * key the snapshot still carries that a live read of the same document no longer
 * returns — so exposing the raw snapshot would show content the collection no
 * longer declares, and hand it to hooks and field-level access that only inspect
 * declared fields.
 *
 * The prune is the one the PROMOTE path applies, so what an editor is shown and
 * what a publish would ship are shaped identically. The identity and timestamp
 * columns it deliberately holds back — a restore must not resubmit them, a read
 * carries them — are copied back afterwards.
 *
 * Pure and DI-free so the shaping can be tested directly, which is the half of
 * an overlay that has no database in it.
 *
 * @module domains/versions/shape-draft-snapshot
 */

import type { FieldConfig } from "../../collections/fields/types";
import { SYSTEM_TIMESTAMP_KEYS } from "../../shared/lib/case-conversion";

import { buildRestorePayload } from "./restore-snapshot";
import type { ComponentSchemas } from "./restore-snapshot";

export interface ShapeDraftSnapshotInput {
  /** The snapshot as stored. */
  snapshot: Record<string, unknown>;
  /** The document's fields, as currently declared. */
  fields: FieldConfig[];
  /** Reachable component schemas, for pruning inside component subtrees. */
  componentSchemas: ComponentSchemas | undefined;
  /**
   * Whether the document synthesizes `slug` and `title` columns.
   *
   * A plugin-contributed collection gets no synthesized pair, so claiming they
   * exist would keep an obsolete snapshot key the current schema never declared.
   */
  hasSlug: boolean;
  hasTitle: boolean;
}

/**
 * The document a draft read returns, pruned to the current schema.
 */
export function shapeDraftSnapshot(
  input: ShapeDraftSnapshotInput
): Record<string, unknown> {
  const { payload } = buildRestorePayload(input.snapshot, input.fields, {
    // Reaching this function at all means the draft/published split applied,
    // which requires the lifecycle column.
    hasStatus: true,
    hasSlug: input.hasSlug,
    hasTitle: input.hasTitle,
    componentSchemas: input.componentSchemas,
    // The snapshot holds exactly one language's values already, so it is shaped
    // as an unlocalized document; which language it belongs to is the sidecar's
    // key, not something the payload re-derives.
    documentLocalized: false,
    localeUnknown: false,
  });

  // Taken from the shared list rather than named here. Naming them is why the
  // first-publication marker was once pruned from this view while an ordinary
  // read of the same document returned it.
  for (const key of ["id", ...SYSTEM_TIMESTAMP_KEYS]) {
    if (key in input.snapshot) {
      payload[key] = input.snapshot[key];
    }
  }

  return payload;
}
