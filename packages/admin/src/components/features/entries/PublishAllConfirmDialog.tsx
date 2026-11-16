/**
 * Publish All Languages Confirm Dialog
 *
 * A confirm before publishing every language of a document at once, listing
 * each configured language with what the publish does to it.
 *
 * The step exists because of what this action can do that its label does not
 * say: a language holding a saved, unpublished change goes live with the rest.
 * So what happens to
 * each language is stated before the action, read from the server's preview of
 * the publish, which judges the request as the publish would. The dialog never
 * says a language's pending changes go live unless the server says they do,
 * and it offers no publish the server would refuse.
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
import { useEffect, type JSX } from "react";

import { AlertTriangle, Loader2 } from "@admin/components/icons";
import {
  usePublishAllPreview,
  type PublishAllPreviewState,
} from "@admin/hooks/queries/usePublishAllPreview";
import { useLocalization } from "@admin/hooks/useLocalization";

import {
  blockerSentence,
  outcomeSentence,
  publishAllBlocked,
  type LanguageLabel,
} from "./publishAllOutcomes";
import type { usePublishAllLanguages } from "./usePublishAllLanguages";

export interface PublishAllConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many languages this will publish. */
  languageCount: number;
  /**
   * How many of those hold a saved change nobody has published yet, or null
   * where that is not known. Said only when the preview could not be read.
   */
  pendingCount: number | null;
  /** What the server says the publish does to each language. */
  preview: PublishAllPreviewState;
  /** A language's display name for its code. */
  labelOf: LanguageLabel;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

/**
 * What publishing every language puts live, said from the pending count alone:
 * the warning shown when the preview could not be read.
 */
function publishAllWarning(pendingCount: number | null): string {
  // Not knowing which languages hold a change is not knowing there are none:
  // the warning then covers any of them.
  if (pendingCount === null) {
    return "Any language holding unpublished changes goes live too.";
  }
  if (pendingCount > 0) {
    return `${pendingCount} of them ${
      pendingCount === 1 ? "has" : "have"
    } unpublished changes that will go live too.`;
  }
  return "Every language goes live together.";
}

/** Each language with its outcome, and what stops the publish, if anything. */
function PreviewBody({
  preview,
  pendingCount,
  labelOf,
}: {
  preview: PublishAllPreviewState;
  pendingCount: number | null;
  labelOf: LanguageLabel;
}): JSX.Element {
  if (preview.status === "loading") {
    return (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking what publishing does to each language…
      </p>
    );
  }
  // The publish is still judged by the server, so an unread preview only
  // means the dialog says less: the general warning stands in for the list.
  if (preview.status === "failed") {
    return <p>{publishAllWarning(pendingCount)}</p>;
  }
  const { languages, blockers } = preview.preview;
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" aria-label="What happens to each language">
        {languages.map(language => (
          <li
            key={language.locale}
            className={
              language.outcome === "out-of-date"
                ? "flex items-start gap-2 text-destructive"
                : "flex items-start gap-2"
            }
          >
            <span className="font-medium text-foreground">
              {labelOf(language.locale)}
            </span>
            <span>{outcomeSentence(language, labelOf)}</span>
          </li>
        ))}
      </ul>
      {blockers.length > 0 ? (
        <ul className="space-y-1" aria-label="What stops the publish">
          {blockers.map(blocker => (
            <li
              key={blocker.reason}
              className="flex items-start gap-2 text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{blockerSentence(blocker)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PublishAllConfirmDialog({
  open,
  onOpenChange,
  languageCount,
  pendingCount,
  preview,
  labelOf,
  onConfirm,
  isLoading = false,
}: PublishAllConfirmDialogProps): JSX.Element {
  // Pressing publish waits for the preview, and is not offered where the
  // server would refuse it: the list then says why.
  const blocked =
    preview.status === "loading" ||
    (preview.status === "ready" && publishAllBlocked(preview.preview));
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Publish all {languageCount} languages?
          </AlertDialogTitle>
          {/* Left-aligned at every width: a list of languages reads down its
              names, which the dialog's centred narrow-screen text would
              scatter once a line wraps. */}
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm text-muted-foreground">
              <PreviewBody
                preview={preview}
                pendingCount={pendingCount}
                labelOf={labelOf}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isLoading || blocked}
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

/**
 * The publish-all confirmation, open only while publishing is offered, with
 * the server's preview read while it is open. One already open when the
 * actions are held (a language switch's answer on its way, a past version on
 * screen) or publishing every language stops being offered is closed, not
 * hidden, so it does not reopen on its own once the hold ends. Every surface
 * offering the action confirms through this one.
 */
export function PublishAllConfirm({
  open,
  held,
  onOpenChange,
  pendingCount,
  publish,
}: {
  open: boolean;
  held: boolean;
  onOpenChange: (open: boolean) => void;
  // Null where the languages' states were not read, so no count is known.
  pendingCount: number | null;
  publish: ReturnType<typeof usePublishAllLanguages>;
}): JSX.Element {
  const { locales } = useLocalization();
  const offered = !held && publish.available;
  useEffect(() => {
    if (open && !offered) onOpenChange(false);
  }, [open, offered, onOpenChange]);
  const preview = usePublishAllPreview(publish.preview, open && offered);
  const labelOf: LanguageLabel = code =>
    locales.find(locale => locale.code === code)?.label ?? code;
  return (
    <PublishAllConfirmDialog
      open={open && offered}
      onOpenChange={onOpenChange}
      languageCount={locales.length}
      pendingCount={pendingCount}
      preview={preview}
      labelOf={labelOf}
      isLoading={publish.pending}
      onConfirm={() => {
        publish.publishAll();
        onOpenChange(false);
      }}
    />
  );
}
