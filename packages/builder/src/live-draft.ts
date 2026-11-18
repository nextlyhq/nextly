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

import { joinTyping } from "./typing-run";

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
 * @param stored - the value the document holds, as the field shows it
 * @returns the draft, reset whenever `stored` moves for any reason but the
 *   field's own typing
 */
export function useLiveDraft(stored: string): LiveDraft {
  const [draft, setDraft] = React.useState(stored);
  // The run this stretch of typing writes in, from its first keystroke.
  const run = React.useRef<object | null>(null);
  // Whether the stored value is about to move for a keystroke's own write.
  const own = React.useRef(false);
  // The text the last keystroke wrote, while the document still holds it,
  // and the stored spelling it came back as, once it has.
  const wrote = React.useRef<string | null>(null);
  const answered = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (own.current) {
      own.current = false;
      answered.current = stored;
      return;
    }
    // Moved underneath the field, so what it was typing no longer applies.
    run.current = null;
    wrote.current = null;
    answered.current = null;
    setDraft(stored);
  }, [stored]);
  return React.useMemo(
    () => ({
      draft,
      setDraft,
      type: (next, write) => {
        setDraft(next);
        run.current ??= {};
        if (joinTyping(run.current, () => write(next))) {
          own.current = true;
          wrote.current = next;
          answered.current = null;
        }
      },
      join: write =>
        run.current === null ? write() : joinTyping(run.current, write),
      written: text => wrote.current === text,
      end: () => {
        if (wrote.current === draft && answered.current !== null) {
          setDraft(answered.current);
        }
        run.current = null;
        own.current = false;
        wrote.current = null;
        answered.current = null;
      },
    }),
    [draft]
  );
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
