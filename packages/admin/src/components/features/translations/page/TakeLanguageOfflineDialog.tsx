"use client";

/**
 * Asks before one live language is taken offline, saying what its readers get
 * instead. Only that language moves: the other languages and the shared fields
 * stay as they are.
 *
 * @module components/features/translations/page/TakeLanguageOfflineDialog
 */

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { AlertTriangle } from "@admin/components/icons";
import { Button } from "@admin/components/ui";
import {
  usePublishParts,
  type PartsTarget,
} from "@admin/hooks/queries/usePublishParts";
import type { ShownCopy } from "@admin/lib/document-version";
import type { PublishPartsResult } from "@admin/services/publishParts";

import { offlineSentence, refusalMessages } from "./publish-language-words";

export interface TakeLanguageOfflineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PartsTarget;
  language: { code: string; label: string };
  /** The page's copy, so a change made since it was read is refused. */
  shown: () => ShownCopy;
  /**
   * Told it was refused or its answer was lost, in which case it may be
   * offline all the same; the dialog waits for it.
   */
  onFailed: () => Promise<unknown>;
  /** Told once it is offline; the dialog stays up until it has settled. */
  onTakenOffline: (result: PublishPartsResult) => Promise<void>;
  /** Where focus goes as the dialog closes; see `useReturnFocus`. */
  onCloseAutoFocus: (event: Event) => void;
}

export function TakeLanguageOfflineDialog({
  open,
  onOpenChange,
  target,
  language,
  shown,
  onFailed,
  onTakenOffline,
  onCloseAutoFocus,
}: TakeLanguageOfflineDialogProps): JSX.Element {
  const move = usePublishParts({ target, direction: "unpublish", shown });
  // It lasts until the page has read what it left.
  const [working, setWorking] = useState(false);
  const refused = refusalMessages(
    move.error,
    language.label,
    `${language.label} couldn't be taken offline.`
  );

  const takeOffline = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    try {
      await onTakenOffline(
        await move.mutateAsync({ locales: [language.code] })
      );
      onOpenChange(false);
    } catch {
      // Said in the dialog, which stays open.
      await onFailed();
    } finally {
      setWorking(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!working) onOpenChange(next);
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Take {language.label} offline?</AlertDialogTitle>
          <AlertDialogDescription>
            {offlineSentence(language.label)} You can publish it again at any
            time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refused.map(message => (
          <p
            key={message}
            role="alert"
            className="flex items-start gap-2 text-sm text-danger-text"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {message}
          </p>
        ))}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* A button rather than the dialog's own action, which closes it
              before the answer is in; and not `disabled`, which would drop
              focus out of the dialog meanwhile. */}
          <Button
            type="button"
            aria-disabled={working}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => void takeOffline()}
          >
            {working ? "Taking offline…" : `Take ${language.label} offline`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
