"use client";

/**
 * Asks before one language is published, saying first what its readers will
 * see: the server's description of exactly this publish, and the fields the
 * language leaves empty. Nothing is sent until the description has answered,
 * so nothing goes live that was not described.
 *
 * A language whose saved changes are behind the published shared fields is
 * refused by the server until it takes the live values, so that step is
 * offered here: no other page writes this language.
 *
 * @module components/features/translations/page/PublishLanguageDialog
 */

import { useState, type JSX, type ReactNode } from "react";

import { AlertTriangle, Loader2 } from "@admin/components/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@admin/components/ui";
import {
  usePublishParts,
  usePublishPartsDescription,
  type PartsTarget,
} from "@admin/hooks/queries/usePublishParts";
import { outOfDateSharedFields } from "@admin/hooks/useSharedFieldsRecovery";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import {
  refusedAsChangedSince,
  type ShownCopy,
} from "@admin/lib/document-version";
import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import {
  behindOn,
  emptyFieldLine,
  goingLiveTooSentence,
  publishes,
  publishSentence,
  refusalMessages,
  sharedGoLive,
  sharedGoLiveSentence,
  type LabelOf,
} from "./publish-language-words";
import type { EmptyField } from "./reader-preview";

export interface PublishLanguageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PartsTarget;
  language: { code: string; label: string };
  labelOf: LabelOf;
  /** The fields the language leaves empty, and what is shown for each. */
  empty: readonly EmptyField[];
  /** The other languages a first publish shows; see `languagesGoingLiveToo`. */
  goingLiveToo: readonly string[] | undefined;
  /** The page's copy, so a change made since it was read is refused. */
  shown: () => ShownCopy;
  /**
   * Take the live values of the shared fields into the language's saved
   * changes; absent for a reader who may not write it.
   */
  takeLiveValues: (() => Promise<void>) | undefined;
  /**
   * Told the publish was refused or its answer was lost, in which case it may
   * be published all the same; the dialog waits for it.
   */
  onFailed: () => Promise<unknown>;
  /** Told once it is published; the dialog stays up until it has settled. */
  onPublished: (result: PublishPartsResult) => Promise<void>;
  /** Where focus goes as the dialog closes; see `useReturnFocus`. */
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * What the language would become: as described, or as a publish refused for
 * the same reason says, since the description and the publish are judged at
 * different moments.
 */
function outcomeOf(
  described: PublishPartsResult | undefined,
  code: string,
  refusal: unknown
): PartsLanguageOutcome | undefined {
  const behind = outOfDateSharedFields(refusal);
  if (behind !== null) {
    return { locale: code, outcome: "out-of-date", ...behind };
  }
  return described?.languages.find(language => language.locale === code);
}

/** What its readers get for the fields it leaves empty. */
function EmptyFields({
  empty,
  language,
  labelOf,
}: {
  empty: readonly EmptyField[];
  language: string;
  labelOf: LabelOf;
}): JSX.Element | null {
  if (empty.length === 0) return null;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground">Empty in {language}</p>
      <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-muted-foreground">
        {empty.map(field => (
          <li key={field.name}>{emptyFieldLine(field, labelOf)}</li>
        ))}
      </ul>
    </div>
  );
}

/** A reason nothing was published. */
function Refusal({ message }: { message: string }): JSX.Element {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger-text">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * The dialog's confirm. Held rather than `disabled`, which would drop focus
 * out of the dialog while it waits for an answer.
 */
function ConfirmButton({
  held,
  onConfirm,
  children,
}: {
  held: boolean;
  onConfirm: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Button
      type="button"
      aria-disabled={held}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!held) onConfirm();
      }}
    >
      {children}
    </Button>
  );
}

export function PublishLanguageDialog({
  open,
  onOpenChange,
  target,
  language,
  labelOf,
  empty,
  goingLiveToo,
  shown,
  takeLiveValues,
  onFailed,
  onPublished,
  onCloseAutoFocus,
}: PublishLanguageDialogProps): JSX.Element {
  const request = { locales: [language.code] };
  const description = usePublishPartsDescription({
    target,
    direction: "publish",
    request,
    enabled: open,
  });
  const move = usePublishParts({ target, direction: "publish", shown });
  // Publishing lasts until the page has read what it left.
  const [working, setWorking] = useState<"publishing" | "taking" | null>(null);
  // What was confirmed stays said until it is done: the publish itself makes
  // the description ask again.
  const [confirmed, setConfirmed] = useState<PublishPartsResult | null>(null);
  const [takeFailure, setTakeFailure] = useState<string | null>(null);

  const publishing = working === "publishing";
  const asking = description.isFetching && !publishing;
  const described = confirmed ?? description.data;
  const refusal = publishing ? null : (move.error ?? description.error);
  const outcome = outcomeOf(described, language.code, refusal);
  const withShared = sharedGoLive(described);
  const behind = outcome?.outcome === "out-of-date";
  const known =
    publishing ||
    (!asking && description.error === null && outcome !== undefined && !behind);
  // A publish that failed may be pressed again, unless it was refused because
  // the document changed: what is described is then another document.
  const held =
    !known ||
    working !== null ||
    !publishes(outcome, withShared) ||
    (move.error !== null && refusedAsChangedSince(move.error));
  const refused =
    asking || behind
      ? []
      : refusalMessages(
          refusal,
          language.label,
          `${language.label} couldn't be published.`
        );
  const alsoLive =
    known && withShared
      ? goingLiveTooSentence(goingLiveToo, labelOf)
      : undefined;

  const publish = async (): Promise<void> => {
    if (described === undefined) return;
    setConfirmed(described);
    setWorking("publishing");
    try {
      await onPublished(await move.mutateAsync(request));
      onOpenChange(false);
    } catch {
      // Said in the dialog, which stays open and is described again.
      await onFailed();
      await description.refetch();
    } finally {
      setConfirmed(null);
      setWorking(null);
    }
  };
  const take = async (takeLive: () => Promise<void>): Promise<void> => {
    setWorking("taking");
    setTakeFailure(null);
    try {
      await takeLive();
    } catch (error) {
      setTakeFailure(
        apiErrorMessage(error, "The live values couldn't be taken.")
      );
    } finally {
      move.reset();
      await description.refetch();
      setWorking(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (working === null) onOpenChange(next);
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Publish {language.label}?</DialogTitle>
          <DialogDescription>
            What {language.label} readers will see once it is published.
          </DialogDescription>
        </DialogHeader>
        <div role="status" className="space-y-2 text-sm text-foreground">
          {asking ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Checking what readers will see…
            </p>
          ) : null}
          {known || (behind && !asking) ? (
            <p>{publishSentence(outcome, language.label, withShared)}</p>
          ) : null}
          {known && withShared ? (
            <p>{sharedGoLiveSentence(language.label)}</p>
          ) : null}
          {alsoLive === undefined ? null : <p>{alsoLive}</p>}
        </div>
        {known && publishes(outcome, withShared) ? (
          <EmptyFields
            empty={empty}
            language={language.label}
            labelOf={labelOf}
          />
        ) : null}
        {refused.map(message => (
          <Refusal key={message} message={message} />
        ))}
        {takeFailure === null ? null : <Refusal message={takeFailure} />}
        {behind && takeLiveValues === undefined ? (
          <p className="text-sm text-muted-foreground">
            Someone who may edit {language.label} has to take the live values of{" "}
            {behindOn(outcome)}.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (working === null) onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {behind && takeLiveValues !== undefined ? (
            <ConfirmButton
              key="take"
              held={working !== null || asking}
              onConfirm={() => void take(takeLiveValues)}
            >
              {working === "taking"
                ? "Taking the live values…"
                : "Take the live values"}
            </ConfirmButton>
          ) : (
            <ConfirmButton
              key="publish"
              held={held}
              onConfirm={() => void publish()}
            >
              {publishing ? "Publishing…" : `Publish ${language.label}`}
            </ConfirmButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
