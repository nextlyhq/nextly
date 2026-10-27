"use client";

import { toast } from "@nextlyhq/ui";
import * as React from "react";

/**
 * Where a text field's last save stands: nothing to report, under way, done,
 * or refused with the typed text still in the field.
 */
export type MediaFieldSaveState = "idle" | "saving" | "saved" | "failed";

/** How long "Saved" stays under a field before it clears. */
const SAVED_NOTICE_MS = 4000;

export interface UseMediaFieldAutosaveOptions {
  /** The item the field belongs to. A new one resets the field. */
  itemId: string;
  /** What the server holds now. */
  savedValue: string;
  /** Saves one value for one item. Rejects when the server refuses it. */
  save: (itemId: string, value: string) => Promise<void>;
  /** Named in the message when a save on the way out fails. */
  fieldLabel: string;
}

export interface MediaFieldAutosave {
  value: string;
  onChange: (value: string) => void;
  /** Saves what was typed, if it differs from what is stored. */
  onBlur: () => void;
  /** Tries the failed save again with the text still in the field. */
  retry: () => void;
  state: MediaFieldSaveState;
}

/**
 * A text field that saves itself when it loses focus.
 *
 * A failed save keeps the typed text and reports it, so Retry sends the same
 * words again rather than the person retyping them. Moving to another item, or
 * closing the panel, while a change is still unsaved saves it on the way out:
 * an element removed from the page fires no blur, and without this the edit
 * would be dropped without a word.
 */
export function useMediaFieldAutosave({
  itemId,
  savedValue,
  save,
  fieldLabel,
}: UseMediaFieldAutosaveOptions): MediaFieldAutosave {
  const [value, setValue] = React.useState(savedValue);
  const [state, setState] = React.useState<MediaFieldSaveState>("idle");

  // A different item shows its own text at once, in the same render, rather
  // than the previous item's for a frame.
  const [shownItem, setShownItem] = React.useState(itemId);
  if (shownItem !== itemId) {
    setShownItem(itemId);
    setValue(savedValue);
    setState("idle");
  }

  // What is typed and what is stored, written only by events and effects, so
  // the save on the way out reads the item being left rather than the one
  // being rendered.
  const draftRef = React.useRef({ value: savedValue, baseline: savedValue });
  // The item on screen, or null once the field is gone: a save that settles
  // after either changes reports nothing to a field that no longer shows it.
  const activeItemRef = React.useRef<string | null>(itemId);
  // Latest props, read by the effects below without re-running them.
  const savedValueRef = React.useRef(savedValue);
  savedValueRef.current = savedValue;
  const saveRef = React.useRef(save);
  saveRef.current = save;
  const labelRef = React.useRef(fieldLabel);
  labelRef.current = fieldLabel;

  // Each item starts from what is stored. The cleanup is the save on the way
  // out: it runs with the item being left, before the next one's setup.
  React.useEffect(() => {
    activeItemRef.current = itemId;
    draftRef.current = {
      value: savedValueRef.current,
      baseline: savedValueRef.current,
    };
    return () => {
      activeItemRef.current = null;
      const { value: pending, baseline } = draftRef.current;
      if (pending === baseline) return;
      saveRef.current(itemId, pending).catch(() => {
        toast.error(`${labelRef.current} couldn't be saved.`);
      });
    };
  }, [itemId]);

  // A newer stored value for the same item (the refetch after a save, or
  // another person's edit) replaces the field only when nothing is typed over
  // it, so a refetch never discards text that hasn't been saved yet.
  React.useEffect(() => {
    const draft = draftRef.current;
    if (draft.value === draft.baseline) {
      draftRef.current = { value: savedValue, baseline: savedValue };
      setValue(savedValue);
    } else {
      draftRef.current = { ...draft, baseline: savedValue };
    }
  }, [savedValue]);

  // "Saved" clears after a moment; the live region has already announced it.
  React.useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => setState("idle"), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const commit = React.useCallback(() => {
    const pending = draftRef.current.value;
    if (pending === draftRef.current.baseline) return;
    setState("saving");
    saveRef.current(itemId, pending).then(
      () => {
        if (activeItemRef.current !== itemId) return;
        draftRef.current = { ...draftRef.current, baseline: pending };
        setState("saved");
      },
      () => {
        if (activeItemRef.current === itemId) setState("failed");
      }
    );
  }, [itemId]);

  const onChange = React.useCallback((next: string) => {
    draftRef.current = { ...draftRef.current, value: next };
    setValue(next);
    setState(current => (current === "saved" ? "idle" : current));
  }, []);

  return { value, onChange, onBlur: commit, retry: commit, state };
}
