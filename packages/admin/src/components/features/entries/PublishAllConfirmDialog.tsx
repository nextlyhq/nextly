/**
 * Publish All Languages Confirm Dialog
 *
 * A confirm before publishing every language of a document at once.
 *
 * The step exists because of what this action can do that its label does not
 * say: a language holding a saved, unpublished change goes live with the rest.
 * An author thinking about the language in front of them can put four other
 * people's held work on the public site with one click, and publishing cannot
 * be undone by pressing it again. So the count of languages carrying pending
 * changes is stated before the action, not after it.
 *
 * Built on the same AlertDialog primitives as the discard and unpublish
 * confirms, so the three destructive-ish actions in this editor read alike.
 *
 * @module components/features/entries/PublishAllConfirmDialog
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { Loader2 } from "@admin/components/icons";

export interface PublishAllConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many languages this will publish. */
  languageCount: number;
  /**
   * How many of those hold a saved change nobody has published yet, or null
   * where that is not known (the languages' states were not read).
   */
  pendingCount: number | null;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

/** What publishing every language puts live, as the confirmation says it. */
function publishAllWarning(pendingCount: number | null): string {
  // Not knowing which languages hold a change is not knowing there are none:
  // the warning then covers any of them.
  if (pendingCount === null) {
    return "Any language holding unpublished changes goes live too. This cannot be undone by publishing again.";
  }
  // The number is the point of the sentence, so it leads. Naming the languages
  // instead would be better still, but this dialog is reached from surfaces
  // that know the count and not always the labels.
  if (pendingCount > 0) {
    return `${pendingCount} of them ${
      pendingCount === 1 ? "has" : "have"
    } unpublished changes that will go live too. This cannot be undone by publishing again.`;
  }
  return "Every language goes live together. This cannot be undone by publishing again.";
}

export function PublishAllConfirmDialog({
  open,
  onOpenChange,
  languageCount,
  pendingCount,
  onConfirm,
  isLoading = false,
}: PublishAllConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Publish all {languageCount} languages?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {publishAllWarning(pendingCount)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isLoading}
            onClick={() => {
              // `onConfirm` may be async; the click handler must not return its
              // promise. The caller owns awaiting it and closing the dialog, so
              // the loading state stays visible while the publish is in flight.
              void onConfirm();
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Publishing…
              </>
            ) : (
              "Publish all"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
