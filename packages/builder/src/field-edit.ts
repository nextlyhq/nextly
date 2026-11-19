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
 * A draft in a field of the document is also work the page has not saved:
 * the page says so from the draft's first keystroke ({@link
 * useFieldDraftHeld}), and a store of the page writes it first ({@link
 * finishFieldEdit}), so Save pressed from the keyboard, with focus still in
 * the field, saves what the author typed.
 *
 * @module field-edit
 */

import * as React from "react";
import { flushSync } from "react-dom";

/** An edit in progress: where it is, and how to put it back. */
interface FieldEdit {
  /** The field it is in: the element focus was in when it began. */
  readonly element: Element | null;
  /** Put back the value from before the edit, recording nothing. */
  readonly cancel: () => void;
  /**
   * Whether it is a draft of the document's that the field writes only when
   * it is left: unsaved work until then. A field that writes as it is typed
   * has its keystrokes in the document already.
   */
  readonly draft: boolean;
}

/**
 * Whether the fields drawn here edit the document: provided by the block
 * settings panel. A field elsewhere, such as a site variable's, holds a
 * draft the page does not contain, so the page neither waits for it nor
 * counts it.
 */
export const FieldsOfDocument: React.Context<boolean> =
  React.createContext<boolean>(false);

/** The edit in progress, or `null` for none. */
let current: FieldEdit | null = null;

/** Told whenever the edit in progress changes. */
const listeners = new Set<() => void>();

/** Make `next` the edit in progress, telling whoever is listening. */
function setCurrent(next: FieldEdit | null): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Fields an edit has been put back in, which the next Escape leaves. */
const putBack = new WeakSet<Element>();

/** A field's hold on the edit in progress. */
interface FieldEditHandle {
  /** End the edit without putting anything back: stored, or the field gone. */
  readonly end: () => void;
  /** Whether this is still the edit in progress: another field's displaces it. */
  readonly held: () => boolean;
}

/**
 * Begin an edit, displacing any other field's.
 *
 * It also ends when focus leaves the field it began in, by a blur or by
 * {@link finishFieldEdit}: the field has written what it will on the way
 * out. A draft whose commit wrote nothing (`2px ` trimmed back to the `2px`
 * stored, or a value refused) moves no stored value, so without this its
 * record would stay, and the page would report unsaved work it does not have.
 */
function beginFieldEdit(edit: FieldEdit): FieldEditHandle {
  setCurrent(edit);
  const { element } = edit;
  const end = (): void => {
    element?.removeEventListener("focusout", end);
    if (current === edit) setCurrent(null);
  };
  if (element !== null) {
    putBack.delete(element);
    element.addEventListener("focusout", end);
  }
  return { end, held: () => current === edit };
}

/**
 * A draft field's edit in progress, kept with its draft: the one rule every
 * field that holds a draft over a stored value follows, so each has the same
 * Escape.
 *
 * Answers the draft's setter. A draft set away from `stored` begins an edit
 * in the element focus is in (the field being typed into), unless this field
 * already holds the edit in progress; one displaced by another field's begins
 * again. The edit ends when `stored` moves (the draft was written, or an undo
 * or another surface replaced it), when the draft comes back to `stored`, and
 * when the field goes. Escape's put-back sets the draft to `stored`, so the
 * field then writes nothing when it is left.
 */
export function useFieldEdit(
  stored: string,
  setDraft: (next: string) => void
): (next: string) => void {
  const ofDocument = React.useContext(FieldsOfDocument);
  // Read when Escape lands, so the value put back is the one stored now.
  const latestStored = React.useRef(stored);
  latestStored.current = stored;
  const handle = React.useRef<FieldEditHandle | null>(null);
  const end = React.useCallback(() => {
    handle.current?.end();
    handle.current = null;
  }, []);
  React.useEffect(end, [stored, end]);
  React.useEffect(() => end, [end]);
  return React.useCallback(
    (next: string) => {
      setDraft(next);
      if (next === latestStored.current) {
        end();
        return;
      }
      if (handle.current?.held() === true) return;
      handle.current = beginFieldEdit({
        element:
          typeof document === "undefined" ? null : document.activeElement,
        cancel: () => {
          handle.current = null;
          setDraft(latestStored.current);
        },
        draft: ofDocument,
      });
    },
    [setDraft, end, ofDocument]
  );
}

/**
 * The edit of a field that writes as it is typed (`live-draft.ts`), whose own
 * writes move the stored value as it goes, so the edit cannot end when the
 * stored value moves, as a draft's does. Begun at the first keystroke in the
 * element focus is in, unless this field already holds the edit in progress;
 * ended by the field when its edit ends (blur, Enter, the value moved by
 * something else) and when it goes. Escape's put-back runs `cancel`.
 */
export function useTypedFieldEdit(): {
  readonly begin: (cancel: () => void) => void;
  readonly end: () => void;
} {
  const handle = React.useRef<FieldEditHandle | null>(null);
  const end = React.useCallback(() => {
    handle.current?.end();
    handle.current = null;
  }, []);
  React.useEffect(() => end, [end]);
  return React.useMemo(
    () => ({
      begin: (cancel: () => void) => {
        if (handle.current?.held() === true) return;
        handle.current = beginFieldEdit({
          element:
            typeof document === "undefined" ? null : document.activeElement,
          cancel: () => {
            handle.current = null;
            cancel();
          },
          draft: false,
        });
      },
      end,
    }),
    [end]
  );
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
    setCurrent(null);
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

/** Subscribe to the edit in progress. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a field of the document holds a draft it has not written yet. */
function draftHeld(): boolean {
  return current?.draft === true;
}

/**
 * Whether a field of the document holds a draft it has not written yet:
 * work the page has not saved, from the draft's first keystroke.
 *
 * @experimental
 */
export function useFieldDraftHeld(): boolean {
  return React.useSyncExternalStore(subscribe, draftHeld, () => false);
}

/**
 * Write the draft a field of the document holds, as leaving the field would,
 * without the author leaving it: for a store of the page made while focus is
 * still in the field, as Save from the keyboard is. The field's own blur
 * writes it, with every rule that field applies on the way out, and focus
 * and the caret stay where they are. The editor has drawn what it wrote by
 * the time this returns.
 *
 * Nothing for a field that writes as it is typed: its keystrokes are in the
 * document already.
 *
 * @experimental
 */
export function finishFieldEdit(): void {
  const edit = current;
  if (edit === null || !edit.draft) return;
  const { element } = edit;
  if (element === null || !element.isConnected) return;
  flushSync(() => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
