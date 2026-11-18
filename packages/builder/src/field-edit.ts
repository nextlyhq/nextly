/**
 * An edit in progress in one field, and what Escape does with it.
 *
 * A field being edited holds a value the author has not finished with: a
 * draft it writes when it is left, or a run of typing it has already written
 * (`typing-run.ts`), which the history keeps as one step. Either way, Escape
 * in that field puts back the value from before the edit, in the field and
 * on the canvas, and records nothing. That is the innermost thing Escape can
 * close, so it closes that alone; with nothing left to put back, the next
 * Escape leaves the field.
 *
 * One edit at a time, the field's: focus is in one field, and a field's edit
 * ends when its value is stored, when it is put back, or when it unmounts.
 * The edit names the element it is in, so Escape pressed anywhere else never
 * puts back a field the author is not in.
 *
 * Module state rather than context, as `typing-run.ts` is: every field in
 * the inspectors passes through `useStoredDraft`, which is called with a value
 * and nothing else, and the keyboard layer that answers Escape is mounted
 * apart from every panel.
 *
 * @module field-edit
 */

/** An edit in progress: where it is, and how to put it back. */
interface FieldEdit {
  /** The field it is in: the element focus was in when it began. */
  readonly element: Element | null;
  /** Put back the value from before the edit, recording nothing. */
  readonly cancel: () => void;
}

/** The edit in progress, or `null` for none. */
let current: FieldEdit | null = null;

/** Fields an edit has been put back in, which the next Escape leaves. */
const putBack = new WeakSet<Element>();

/**
 * Begin an edit, answering the function that ends it without putting
 * anything back: the field's value was stored, or the field is gone.
 */
export function beginFieldEdit(edit: FieldEdit): () => void {
  current = edit;
  if (edit.element !== null) putBack.delete(edit.element);
  return () => {
    if (current === edit) current = null;
  };
}

/** Whether `edit` was begun in `origin`, or in a field holding it. */
function inField(edit: FieldEdit, origin: Element): boolean {
  return edit.element !== null && edit.element.contains(origin);
}

/** What Escape pressed in a field does. */
type FieldEscape =
  /** The field's edit was put back; the field keeps focus. */
  | "put-back"
  /** Nothing to put back in a field whose edit just was: leave the field. */
  | "leave-field"
  /** Not a field with an edit: the key does what it did before. */
  | "none";

/**
 * Escape pressed in `origin`: put back the edit in progress there, or, in a
 * field whose edit Escape has just put back, leave it.
 */
export function escapeFieldEdit(origin: Element | null): FieldEscape {
  if (origin === null) return "none";
  const edit = current;
  if (edit !== null && inField(edit, origin)) {
    current = null;
    edit.cancel();
    if (edit.element !== null) putBack.add(edit.element);
    return "put-back";
  }
  for (let at: Element | null = origin; at !== null; at = at.parentElement) {
    if (putBack.has(at)) {
      putBack.delete(at);
      return "leave-field";
    }
  }
  return "none";
}
