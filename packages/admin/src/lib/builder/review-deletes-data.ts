/**
 * Whether saving a schema review deletes stored values: the one question the
 * Builder colours a confirming action red for.
 *
 * Read from the preview's own rows, each of which the server has already
 * classed, never judged again here: a removed field or a changed one the
 * server classes `destructive` deletes values (a removal of a field that holds
 * some, a type change that can lose some). Every other row (an add, a type
 * change the server classes as keeping values, a field made required, values
 * moving to the translation archive) deletes nothing.
 *
 * The preview's overall `hasDestructiveChanges` is deliberately not used: it
 * is set for any change that is not `safe`, a change that only needs an answer
 * included, so a colour taken from it was red over changes that delete
 * nothing.
 *
 * A rename's old column is a removed row too, so a rename the person keeps as
 * a rename over a column with values still reads as deleting here. That errs
 * towards red, which is the direction that cannot cost data.
 */
import type { SchemaPreviewChange } from "@admin/services/schemaApi";

export function reviewDeletesData(
  changes: Pick<SchemaPreviewChange, "removed" | "changed">
): boolean {
  return [...changes.removed, ...changes.changed].some(
    row => row.classification === "destructive"
  );
}
