/**
 * A field's draft that writes as it is typed, so the canvas follows the
 * author's keystrokes instead of waiting for them to leave the field.
 *
 * Each keystroke is handed to the field's own write inside one run of typing
 * (`typing-run.ts`), so the history keeps the whole stretch as ONE step: undo
 * takes it back to the value from before the author started, not a letter at
 * a time. The run ends when the edit does, on blur or Enter, and the next
 * keystroke starts a new step.
 *
 * Two rules make it safe to write while the value is still being typed:
 *
 * - **The last valid value stays on the canvas.** A keystroke whose text is
 *   not a value yet (`12p`, half a hex colour, an emptied field) writes
 *   nothing, so the document and the canvas keep the last value that was one.
 *   The field shows its own message as it does on blur, and leaving the field
 *   settles the text as before.
 * - **The field's own writes leave its text alone.** The document answers a
 *   write in its own spelling (`24` is stored as `24px`), and a draft that
 *   followed it would move the caret and the text under the author's fingers.
 *   A value moved by anything else, such as an undo or an edit from the
 *   canvas, still replaces the draft.
 *
 * @module live-draft
 */

import { trimCssWhitespace } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useFieldEdit, useTypedFieldEdit } from "./field-edit";
import { joinTyping, typingEpoch } from "./typing-run";

/** A field's draft over the stored value, written as it is typed. */
export interface LiveDraft {
  /** The text the field shows. */
  readonly draft: string;
  /** Show `next`, writing nothing: a step, a reset or a pick. */
  readonly setDraft: (next: string) => void;
  /**
   * The author typed `next`: shown at once, and handed to `write` inside this
   * edit's run of typing. `write` answers whether it moved the document:
   * `false` for a value it did not write (not one yet, refused, the same).
   */
  readonly type: (next: string, write: (text: string) => boolean) => void;
  /**
   * Run `write` in this edit's run of typing, while one is open, so a write
   * that finishes the edit (a unit picked after the number, the tidy-up on
   * blur) is part of the same step.
   */
  readonly join: <T>(write: () => T) => T;
  /**
   * Whether `text` is what the last keystroke wrote, so the edit ending on it
   * has nothing left to write.
   */
  readonly written: (text: string) => boolean;
  /**
   * The edit is over: the next keystroke starts a new step, and a draft the
   * last keystroke wrote takes the stored spelling ("24" shows as stored).
   */
  readonly end: () => void;
}

/**
 * Put back what a run of typing wrote, recording nothing: the editor's
 * `cancelTyping`, provided where the fields are drawn over an editor. Escape
 * in a field being typed uses it; without it, Escape puts back the field's
 * text alone.
 */
export const TypingCancel: React.Context<
  ((run: object) => boolean) | undefined
> = React.createContext<((run: object) => boolean) | undefined>(undefined);

/** What one stretch of typing holds between its keystrokes. */
interface Stretch {
  /** The run it writes in, from its first keystroke. */
  run: object | null;
  /** The stretch of typing the run began in (`typingEpoch`). */
  epoch: number;
  /** The stored text before its first keystroke, which Escape puts back. */
  before: string;
  /** Whether the stored value is about to move for a keystroke's own write. */
  own: boolean;
  /** The text the last keystroke wrote, while the document still holds it. */
  wrote: string | null;
  /** The stored spelling that text came back as, once it has. */
  answered: string | null;
}

/** A stretch with nothing typed. */
function idle(stretch: Stretch): void {
  stretch.run = null;
  stretch.own = false;
  stretch.wrote = null;
  stretch.answered = null;
}

/**
 * @param stored - the value the document holds, as the field shows it
 * @param putBackDone - told after Escape puts the draft back, for a field
 *   that keeps state of its own about the typing
 * @returns the draft, reset whenever `stored` moves for any reason but the
 *   field's own typing. A draft set away from `stored` without typing, and a
 *   stretch of typing, are both an edit Escape puts back (`field-edit.ts`).
 */
export function useLiveDraft(
  stored: string,
  putBackDone?: () => void
): LiveDraft {
  const [draft, show] = React.useState(stored);
  // Read when Escape puts the draft back, so a field showing typing as typed
  // (a unit kept in the text) shows the value as stored again.
  const onPutBack = React.useRef(putBackDone);
  onPutBack.current = putBackDone;
  // Escape runs the put-back registered by the first keystroke's render, so
  // the stored value it falls back on is read from here, never from then.
  const storedNow = React.useRef(stored);
  storedNow.current = stored;
  // Set without typing: a draft over the stored value, as every field's is.
  const setDraft = useFieldEdit(stored, show);
  const edit = useTypedFieldEdit();
  const cancelTyping = React.useContext(TypingCancel);
  const stretch = React.useRef<Stretch>({
    run: null,
    epoch: typingEpoch(),
    before: stored,
    own: false,
    wrote: null,
    answered: null,
  }).current;
  React.useEffect(() => {
    if (stretch.own) {
      stretch.own = false;
      stretch.answered = stored;
      return;
    }
    // Moved underneath the field, so what it was typing no longer applies.
    idle(stretch);
    edit.end();
    show(stored);
  }, [stored, stretch, edit]);
  return React.useMemo(() => {
    // Escape mid-stretch: the document as it was before the first keystroke,
    // with nothing recorded, and the field showing it again.
    const putBack = () => {
      const { run, before } = stretch;
      idle(stretch);
      // The text from before only where the canvas went back to it too. A run
      // another edit has since followed, or one with no editor to cancel it,
      // stays on the canvas, and the field shows what the document holds.
      const cancelled = run === null || cancelTyping?.(run) === true;
      show(cancelled ? before : storedNow.current);
      onPutBack.current?.();
    };
    return {
      draft,
      setDraft,
      type: (next, write) => {
        show(next);
        // A new run from the first keystroke, and again after a save ended
        // every run (`endTypingRuns`): what was saved is its own step, and
        // Escape puts back the saved text, not the text before the save.
        if (stretch.run === null || stretch.epoch !== typingEpoch()) {
          stretch.run = {};
          stretch.epoch = typingEpoch();
          stretch.before = stored;
        }
        edit.begin(putBack);
        if (joinTyping(stretch.run, () => write(next))) {
          stretch.own = true;
          stretch.wrote = next;
          stretch.answered = null;
        }
      },
      join: write =>
        stretch.run === null ? write() : joinTyping(stretch.run, write),
      written: text => stretch.wrote === text,
      end: () => {
        if (stretch.wrote === draft && stretch.answered !== null) {
          show(stretch.answered);
        }
        idle(stretch);
        edit.end();
      },
    };
  }, [draft, setDraft, stored, stretch, edit, cancelTyping]);
}

/**
 * A number typed so far, or `undefined` while the text is not one yet: empty,
 * a lone sign, an exponent or a unit on its way in.
 */
export function typedNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A style field's text as typed, or `undefined` for an emptied field, which
 * clears the value only when the field is left: mid-edit, emptied is the
 * author deleting on the way to the next value.
 */
export function typedStyleText(text: string): string | undefined {
  return trimCssWhitespace(text) === "" ? undefined : text;
}
