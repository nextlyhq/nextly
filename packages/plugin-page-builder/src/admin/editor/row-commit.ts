/**
 * Handing the editor's work to a field inside a repeater's row, and only to
 * that row.
 *
 * The editor is bound to the field's form path, which names the row by its
 * position (`sections.1.body`). The admin finds the row again by its saved id
 * whenever the rows move and rebinds the editor, so while the editor is drawn
 * the two agree. A write made between the rows moving and the editor being
 * drawn again — a document reloaded under it, a hand-over as it unmounts —
 * would land at the old position, in whichever row now stands there. So each
 * write first asks where the row is at that moment, and writes only where the
 * editor is bound and the row still is; otherwise it is refused and nothing
 * is written anywhere.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/row-commit
 */

/** A write into the form refused because its row is not where it was bound. */
export class RowCommitRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowCommitRefused";
  }
}

/** Said when the row the editor was open on is no longer in the entry. */
const ROW_GONE =
  "The row this layout belongs to isn't in the entry any more, so it wasn't saved into another row. Go back to the entry to check its rows.";

/** Said when the row moved and the editor has not caught up with it yet. */
const ROW_MOVED =
  "The row this layout belongs to moved while it was being saved, so nothing was written. Try again.";

/**
 * Why a write bound at `bound` may not go ahead, given where the row's field
 * is now (`now`, from the admin's resolution by row id): `null` when it is
 * still there.
 */
function rowCommitRefusal(
  bound: string,
  now: string | undefined
): string | null {
  if (now === undefined) return ROW_GONE;
  return now === bound ? null : ROW_MOVED;
}

/**
 * `write`, made to refuse — by throwing {@link RowCommitRefused} — unless the
 * row's field is still at `bound` when it is called. `now` answers where the
 * field is at that moment, by its row's id. Without `now` the field sits in
 * no row, its path never moves, and `write` is returned as it is.
 */
export function rowGuardedWrite<T>(
  write: (value: T) => void,
  bound: string,
  now: (() => string | undefined) | undefined
): (value: T) => void {
  if (now === undefined) return write;
  return value => {
    const refusal = rowCommitRefusal(bound, now());
    if (refusal !== null) throw new RowCommitRefused(refusal);
    write(value);
  };
}
