/**
 * Whether saving a schema review deletes stored values: the one question the
 * Builder colours a confirming action red for.
 *
 * Read from the preview's own rows:
 * - a removed field always deletes. Its column goes, and with it any values.
 *   The preview counts those values only as a best effort, reading 0 when
 *   counting fails, so a count of 0 cannot show a removal deletes nothing;
 * - a changed field deletes when the server classes it `destructive` (a type
 *   change that can lose values), and not when it classes it as keeping them;
 * - every other row (an add, a field made required, values moving to the
 *   translation archive) deletes nothing.
 *
 * The preview's overall `hasDestructiveChanges` is deliberately not used: it
 * is set for any change that is not `safe`, a change that only needs an answer
 * included, so a colour taken from it was red over changes that delete
 * nothing.
 *
 * A rename's old column is a removed row too, so a rename the person keeps as
 * a rename still reads as deleting here. That errs towards red, which is the
 * direction that cannot cost data.
 */
import type { SchemaPreviewChange } from "@admin/services/schemaApi";

export function reviewDeletesData(
  changes: Pick<SchemaPreviewChange, "removed" | "changed">
): boolean {
  return (
    changes.removed.length > 0 ||
    changes.changed.some(row => row.classification === "destructive")
  );
}
