"use client";

/**
 * "Save changes to <title> first?": asked when a new page is made from the
 * builder while the page on screen holds unsaved work, before anything is
 * created, so backing out never leaves an extra page.
 *
 * Save runs the page's own save and answers "saved" only once it succeeded;
 * a save that fails answers "keep", leaving the author where they were with
 * the editor's own message. Discard answers "discard": the caller makes the
 * page and only then lets the move go without the leave guard asking again.
 * Keep editing, Escape or a click outside answers "keep".
 *
 * @module admin/new-page/new-page-unsaved
 */
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import { useCallback, useRef, useState, type JSX } from "react";

import type { UnsavedAnswer } from "./new-page-form";
import {
  NEW_PAGE_WORDS,
  SAVE_FIRST_DETAIL,
  saveFirstQuestion,
} from "./new-page-words";

/** The question's state, and the way to ask it. */
export interface UnsavedQuestion {
  /** The page's title while asked, or null. */
  readonly asking: string | null;
  readonly saving: boolean;
  readonly ask: (title: string) => Promise<UnsavedAnswer>;
  readonly answer: (answer: "save" | "discard" | "keep") => void;
}

/** The question, with `save` run when the author picks Save. */
export function useUnsavedQuestion(
  save: () => Promise<boolean>
): UnsavedQuestion {
  const [asking, setAsking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<((answer: UnsavedAnswer) => void) | null>(null);
  const settle = (answer: UnsavedAnswer) => {
    pending.current?.(answer);
    pending.current = null;
    setAsking(null);
  };
  const ask = useCallback(
    (title: string) =>
      new Promise<UnsavedAnswer>(resolve => {
        pending.current = resolve;
        setAsking(title);
      }),
    []
  );
  const answer = (choice: "save" | "discard" | "keep") => {
    if (choice !== "save") {
      settle(choice);
      return;
    }
    setSaving(true);
    void save()
      .catch(() => false)
      .then(saved => {
        setSaving(false);
        settle(saved ? "saved" : "keep");
      });
  };
  return { asking, saving, ask, answer };
}

export function UnsavedWorkQuestion({
  question,
}: {
  question: UnsavedQuestion;
}): JSX.Element {
  return (
    <AlertDialog
      open={question.asking !== null}
      onOpenChange={open => {
        if (!open && !question.saving) question.answer("keep");
      }}
    >
      <AlertDialogContent data-slot="new-page-save-first">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {saveFirstQuestion(question.asking ?? "")}
          </AlertDialogTitle>
          <AlertDialogDescription>{SAVE_FIRST_DETAIL}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={question.saving}>
            {NEW_PAGE_WORDS.keepEditing}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={question.saving}
            onClick={() => question.answer("discard")}
          >
            {NEW_PAGE_WORDS.discard}
          </Button>
          <Button
            type="button"
            disabled={question.saving}
            onClick={() => question.answer("save")}
          >
            {NEW_PAGE_WORDS.save}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
