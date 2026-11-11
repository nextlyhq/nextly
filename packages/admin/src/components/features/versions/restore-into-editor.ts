/**
 * Put a version's chosen fields into the editor, and say so with an Undo.
 *
 * One answer for "Restore…" in the history and "Restore this field" on a
 * changed field: only fields that may be restored go in, as unsaved edits,
 * and the toast names how many and the version's date, with Undo.
 *
 * @module components/features/versions/restore-into-editor
 */

import { toast } from "@admin/components/ui";
import { formatDateTime } from "@admin/lib/dates/format";

import type { EditorRestoreSurface } from "./document-history-context";
import type { RestoreRow } from "./restore-plan";

export function restoreIntoEditor(args: {
  editor: EditorRestoreSurface;
  rows: readonly RestoreRow[];
  /** The fields chosen; a disabled one is never restored. */
  names: readonly string[];
  versionNo: number;
  /** When the version was saved, for the toast; its number when unknown. */
  savedAt?: string | null;
}): void {
  const chosen = new Set(args.names);
  const values = Object.fromEntries(
    args.rows
      .filter(row => chosen.has(row.name) && !row.disabled)
      .map(row => [row.name, row.value])
  );
  const count = Object.keys(values).length;
  if (count === 0) return;
  const applied = args.editor.restore.apply(values, args.versionNo);
  const when = args.savedAt
    ? formatDateTime(args.savedAt)
    : `version ${args.versionNo}`;
  toast.success(
    `${count === 1 ? "1 field" : `${count} fields`} restored from ${when}`,
    { action: { label: "Undo", onClick: () => applied.undo() } }
  );
}
