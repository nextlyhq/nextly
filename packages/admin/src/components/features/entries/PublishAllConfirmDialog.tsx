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

import { Loader2 } from "@admin/components/icons";

export interface PublishAllConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many languages this will publish. */
  languageCount: number;
  /** How many of those hold a saved change nobody has published yet. */
  pendingCount: number;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function PublishAllConfirmDialog({
  open,
  onOpenChange,
  languageCount,
  pendingCount,
  onConfirm,
  isLoading = false,
}: PublishAllConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Publish all {languageCount} languages?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingCount > 0
              ? // The number is the point of the sentence, so it leads. Naming
                // the languages instead would be better still, but this dialog
                // is reached from surfaces that know the count and not always
                // the labels.
                `${pendingCount} of them ${
                  pendingCount === 1 ? "has" : "have"
                } unpublished changes that will go live too. This cannot be undone by publishing again.`
              : "Every language goes live together. This cannot be undone by publishing again."}
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
