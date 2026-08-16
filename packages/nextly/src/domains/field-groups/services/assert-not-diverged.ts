/**
 * The one place a `diverged` field group refuses a storage-moving edit.
 *
 * `diverged` means the tables were changed and the row recording it was not, so the stored
 * definition describes the previous shape. An editor opened after that mark reads the bumped
 * `schema_version` alongside the STALE fields, satisfies the version check, and plans its next
 * transition from a shape the database no longer has — the exact retry the state exists to declare
 * unsafe. A status nothing enforces is a note, not a control.
 *
 * 🔴 Shared rather than written per handler, because these transports have already diverged once.
 * `updateFieldGroup` and the builder's `applyComponentSchemaChanges` both move storage and reach
 * the registry by different routes; a guard living in one of them means an operator refused in the
 * admin walks straight through the builder and compounds exactly the edit that was refused. The
 * count that proved it: `grep -c diverged` over the apply route was ZERO while the service's own
 * refusal read as complete.
 *
 * Metadata-only edits are deliberately still permitted by the CALLER deciding not to ask — a label
 * or a description moves no storage, and locking an operator out of renaming the thing they are
 * trying to reconcile would make the state harder to escape rather than safer. That is why this
 * takes an explicit "is this edit moving storage" decision instead of inspecting an input shape it
 * would have to understand differently for each transport.
 *
 * @module domains/field-groups/services/assert-not-diverged
 */

import { NextlyError } from "../../../errors/nextly-error";

/** What this needs to know about a field group, so any caller's record shape fits. */
export interface DivergenceCandidate {
  readonly migrationStatus?: string | null;
}

/**
 * Refuse a storage-moving edit to a diverged field group.
 *
 * Does nothing when the group is not diverged, so a caller may invoke it unconditionally on the
 * paths that move storage.
 */
export function assertNotDiverged(
  slug: string,
  record: DivergenceCandidate | null | undefined
): void {
  if (record?.migrationStatus !== "diverged") return;

  throw NextlyError.conflict({
    // `state`, not `version`: the generic version message tells the caller to refresh and retry,
    // which is precisely the action this refusal exists to prevent.
    reason: "state",
    message: `"${slug}" is marked as diverged: its tables were changed and its stored definition still describes the previous shape. Reconcile the definition against the tables before editing its schema again. Repeating the edit would plan the next change from a shape the database no longer has.`,
    logContext: { slug, migrationStatus: record.migrationStatus },
  });
}
