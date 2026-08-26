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
 * ## Why the rehydration is part of the question, not a step callers add
 *
 * A snapshot stores dates as strings; an ordinary live read hands the afterRead
 * hooks Drizzle-decoded `Date` objects. A caller that prunes without
 * rehydrating therefore returns a document whose dates are the wrong TYPE, and
 * a hook calling date methods fails only for a drafted document — which is
 * exactly what was measured on Singles before this function did it
 * (`draft-date-parity.integration.test.ts`).
 *
 * Leaving it to callers is what produced that: two of the three call sites
 * remembered, one did not, and the one that did not was the one reached through
 * an extracted helper whose name claims it shapes the document whole.
 *
 * Pure and DI-free so the shaping can be tested directly, which is the half of
 * an overlay that has no database in it.
 *
 * @module domains/versions/shape-draft-snapshot
 */

import type { FieldConfig } from "../../collections/fields/types";
import {
  SYSTEM_TIMESTAMP_KEYS,
  rehydrateSystemTimestamps,
} from "../../shared/lib/case-conversion";

import { buildRestorePayload } from "./restore-snapshot";
import type { ComponentSchemas } from "./restore-snapshot";
import { rehydrateSnapshotDates } from "./tag-component-types";

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
   *
   * Deliberately a PARAMETER rather than something derived here: the callers
   * answer it differently and both are argued. A Single asks whether the field
   * is declared; a collection treats a non-plugin collection as always having
   * the pair. Folding either rule in would silently change the other.
   */
  hasSlug: boolean;
  hasTitle: boolean;
  /**
   * Whether to restore the SYSTEM timestamps to `Date`.
   *
   * Not universal, and measured rather than assumed: a collection's live read
   * hands back `Date` for `createdAt`/`updatedAt`, and a Single's hands back a
   * STRING — a Single normalizes them on the way out. So rehydrating
   * unconditionally fixes the drafted collection and breaks the drafted Single,
   * which is what `draft-date-parity.integration.test.ts` caught when this was
   * first written as an unconditional step.
   *
   * DECLARED date fields are not affected by this: both document types return
   * those as `Date`, so they are always rehydrated.
   */
  rehydrateSystemTimestampsToDate: boolean;
  /**
   * Whether the document carries the lifecycle column.
   *
   * Defaults to `true`: reaching this at all normally means the draft/published
   * split applied. The collection WRITE-response path shapes a draft for a
   * collection that may not have it, so it passes the answer explicitly.
   */
  hasStatus?: boolean;
}

/**
 * The document a draft read returns, pruned to the current schema.
 */
export function shapeDraftSnapshot(
  input: ShapeDraftSnapshotInput
): Record<string, unknown> {
  const { payload } = buildRestorePayload(input.snapshot, input.fields, {
    hasStatus: input.hasStatus ?? true,
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

  // Rehydrate, so every caller returns the value shapes ITS OWN live read
  // returns. See the module note: this is part of the question, not a step a
  // caller is trusted to remember — but the system-timestamp half differs by
  // document type, so it is declared rather than assumed.
  if (input.rehydrateSystemTimestampsToDate) rehydrateSystemTimestamps(payload);
  rehydrateSnapshotDates(payload, input.fields, input.componentSchemas ?? null);

  return payload;
}
