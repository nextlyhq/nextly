"use client";

import { toast } from "@nextlyhq/ui";
import * as React from "react";

/**
 * Where a text field's last save stands: nothing to report, under way, done,
 * refused with the typed text still in the field, or not sent because the
 * text is longer than the field allows.
 */
export type MediaFieldSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "too-long";

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
  /** The longest text saved; longer is kept in the field and not sent. */
  maxLength: number;
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
  maxLength,
}: UseMediaFieldAutosaveOptions): MediaFieldAutosave {
  const [value, setValue] = React.useState(savedValue);
  const [state, setState] = React.useState<MediaFieldSaveState>("idle");

  // The latest text handed to the save queue below for each item, until its
  // save settles. An item opened again while its save is still under way
  // (A, then B, then back to A) shows that text and its outcome: the list
  // still holds the item's old text until the save's refetch, and showing
  // that would let leaving the item again send it back over the edit.
  const pendingByItemRef = React.useRef(new Map<string, string>());

  // A different item shows its own text at once, in the same render, rather
  // than the previous item's for a frame.
  const [shownItem, setShownItem] = React.useState(itemId);
  if (shownItem !== itemId) {
    const pendingText = pendingByItemRef.current.get(itemId);
    setShownItem(itemId);
    setValue(pendingText ?? savedValue);
    setState(pendingText === undefined ? "idle" : "saving");
  }

  // What is typed, what is stored, and the latest value handed to the save
  // queue below (null when none is waiting or under way), written only by
  // events and effects, so the save on the way out reads the item being left
  // rather than the one being rendered, and no value is queued twice.
  const draftRef = React.useRef<{
    value: string;
    baseline: string;
    queued: string | null;
  }>({ value: savedValue, baseline: savedValue, queued: null });
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
  const maxLengthRef = React.useRef(maxLength);
  maxLengthRef.current = maxLength;

  // One save at a time for this field. Two requests under way at once can
  // settle in either order, and an older text landing last would overwrite a
  // newer one while the field said "Saved". A save asked for while another
  // is under way waits, and only the latest text for an item waits: the
  // texts typed in between were never what the person ended with.
  const queueRef = React.useRef<Array<{ item: string; value: string }>>([]);
  const sendingRef = React.useRef(false);

  const pump = React.useCallback(() => {
    if (sendingRef.current) return;
    const job = queueRef.current.shift();
    if (!job) return;
    sendingRef.current = true;
    const stillWaiting = () =>
      queueRef.current.some(waiting => waiting.item === job.item);
    saveRef
      .current(job.item, job.value)
      .then(
        () => {
          if (activeItemRef.current !== job.item) return;
          const draft = draftRef.current;
          draftRef.current = {
            ...draft,
            baseline: job.value,
            queued: draft.queued === job.value ? null : draft.queued,
          };
          // "Saved" only once the last text sent for this item is stored.
          if (!stillWaiting()) setState("saved");
        },
        () => {
          if (activeItemRef.current !== job.item) {
            // The person has moved on, so the field that would show Retry
            // is gone; say so here instead.
            toast.error(`${labelRef.current} couldn't be saved.`);
            return;
          }
          // A newer text waiting for this item decides the field's state.
          if (stillWaiting()) return;
          draftRef.current = { ...draftRef.current, queued: null };
          setState("failed");
        }
      )
      .finally(() => {
        // Settled, so an item opened from now on starts from what is stored,
        // unless a newer text for it is still waiting.
        const pending = pendingByItemRef.current;
        if (pending.get(job.item) === job.value && !stillWaiting()) {
          pending.delete(job.item);
        }
        sendingRef.current = false;
        pump();
      });
  }, []);

  /** Queues `value` for `item`, replacing a text still waiting for it. */
  const enqueue = React.useCallback(
    (item: string, value: string) => {
      const queue = queueRef.current.filter(waiting => waiting.item !== item);
      queue.push({ item, value });
      queueRef.current = queue;
      pendingByItemRef.current.set(item, value);
      pump();
    },
    [pump]
  );

  // Each item starts from what is stored. The cleanup is the save on the way
  // out: it runs with the item being left, before the next one's setup.
  React.useEffect(() => {
    activeItemRef.current = itemId;
    // Opened while a save of its own is under way: that text is the field's,
    // and the save's outcome lands on this field like any other.
    const pendingText = pendingByItemRef.current.get(itemId);
    draftRef.current = {
      value: pendingText ?? savedValueRef.current,
      baseline: savedValueRef.current,
      queued: pendingText ?? null,
    };
    return () => {
      activeItemRef.current = null;
      const { value: pending, baseline, queued } = draftRef.current;
      // A save already queued carries this text; its outcome is reported
      // even though the field is gone.
      if (pending === baseline || pending === queued) return;
      if (pending.length > maxLengthRef.current) {
        toast.error(
          `${labelRef.current} wasn't saved: it's longer than ${maxLengthRef.current} characters.`
        );
        return;
      }
      enqueue(itemId, pending);
    };
  }, [itemId, enqueue]);

  // A newer stored value for the same item (the refetch after a save, or
  // another person's edit) replaces the field only when nothing is typed over
  // it, so a refetch never discards text that hasn't been saved yet.
  React.useEffect(() => {
    const draft = draftRef.current;
    if (draft.value === draft.baseline) {
      draftRef.current = { ...draft, value: savedValue, baseline: savedValue };
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
    const { value: pending, baseline, queued } = draftRef.current;
    if (pending === baseline || pending === queued) return;
    if (pending.length > maxLengthRef.current) {
      setState("too-long");
      return;
    }
    draftRef.current = { ...draftRef.current, queued: pending };
    setState("saving");
    enqueue(itemId, pending);
  }, [itemId, enqueue]);

  const onChange = React.useCallback((next: string) => {
    draftRef.current = { ...draftRef.current, value: next };
    setValue(next);
    setState(current =>
      current === "saved" || current === "too-long" ? "idle" : current
    );
  }, []);

  return { value, onChange, onBlur: commit, retry: commit, state };
}
