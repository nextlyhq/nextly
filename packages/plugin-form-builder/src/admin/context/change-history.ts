/**
 * The form editor's unsaved changes: what each one replaced, so the bar can
 * count them and Undo can take the last one back.
 *
 * One record per change, holding the whole form as it was just before it.
 * The count of records IS the number of unsaved changes, and "unsaved" is a
 * count above zero, so the bar's count, its Undo and the leave guard read one
 * answer rather than three that could disagree.
 *
 * Pure functions over a plain value, so the rules (what counts as one change,
 * what a save keeps) are tested without a React tree.
 *
 * @module admin/context/change-history
 */

/**
 * Typing into one input is one change, not one per keystroke, while the
 * keystrokes keep coming: an edit to the same thing within this long of the
 * last joins it.
 */
export const COALESCE_MS = 2000;

/** The record history keeps: whatever the editor restores on Undo. */
export interface ChangeHistory<Doc> {
  /** The form before each unsaved change, oldest first. */
  readonly entries: readonly Doc[];
  /** What the last change edited, when it may be joined by the next. */
  readonly lastKey: string | null;
  /** When the last change was made, in milliseconds. */
  readonly lastAt: number;
}

/** No unsaved changes. */
export function emptyHistory<Doc>(): ChangeHistory<Doc> {
  return { entries: [], lastKey: null, lastAt: 0 };
}

/**
 * The history after a change made to `before`.
 *
 * - `before` is the very record the last change pushed: the same event made
 *   two writes (a name and the address it suggests), which is one change.
 * - `key` names what was edited (a field's place, a setting); the same key
 *   within `COALESCE_MS` of the last edit joins it. `null` never joins: a
 *   field added, removed or moved, or a status picked, is a change of its own.
 */
export function recordChange<Doc>(
  history: ChangeHistory<Doc>,
  before: Doc,
  key: string | null,
  now: number
): ChangeHistory<Doc> {
  const last = history.entries.at(-1);
  const joins =
    last === before ||
    (key !== null &&
      key === history.lastKey &&
      history.entries.length > 0 &&
      now - history.lastAt < COALESCE_MS);
  return {
    entries: joins ? history.entries : [...history.entries, before],
    lastKey: key,
    lastAt: now,
  };
}

/**
 * The last change taken back: the form to restore, and the history without
 * it. `undefined` when there is nothing unsaved to take back.
 */
export function undoChange<Doc>(
  history: ChangeHistory<Doc>
): { history: ChangeHistory<Doc>; restore: Doc } | undefined {
  const restore = history.entries.at(-1);
  if (restore === undefined) return undefined;
  return {
    history: {
      entries: history.entries.slice(0, -1),
      lastKey: null,
      lastAt: 0,
    },
    restore,
  };
}

/**
 * The history once a save has stored the form as it stood when the save
 * began, `mark` records in. The changes made while the save was under way
 * are not in what it stored, so they stay unsaved; the first of them keeps
 * the stored form as what Undo goes back to. With no mark (a save whose start
 * was not recorded) everything counts as stored.
 */
export function markSaved<Doc>(
  history: ChangeHistory<Doc>,
  mark: number | undefined
): ChangeHistory<Doc> {
  const kept =
    mark === undefined
      ? []
      : history.entries.slice(Math.min(mark, history.entries.length));
  return { entries: kept, lastKey: null, lastAt: 0 };
}

/**
 * The history as a save begins: how many records it stores (`mark`), and a
 * history whose next edit starts a change of its own, so an edit made during
 * the save is never joined to one the save is storing.
 */
export function beginSaving<Doc>(history: ChangeHistory<Doc>): {
  history: ChangeHistory<Doc>;
  mark: number;
} {
  return {
    history: { ...history, lastKey: null },
    mark: history.entries.length,
  };
}

/**
 * The history with every kept record passed through `rebase`: for a fact the
 * records hold but an edit does not decide, such as which fields the server
 * now stores, so that taking an edit back never takes that fact back too.
 */
export function rebaseEntries<Doc>(
  history: ChangeHistory<Doc>,
  rebase: (record: Doc) => Doc
): ChangeHistory<Doc> {
  return { ...history, entries: history.entries.map(rebase) };
}
