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
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import {
  refusedAsChangedSince,
  type ShownCopy,
} from "@admin/lib/document-version";
import type { PublishPartsResult } from "@admin/services/publishParts";

import {
  behindOn,
  emptyFieldLine,
  type LabelOf,
} from "./publish-language-words";
import { publishView, type PublishView } from "./publish-view";
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

/** What the dialog has asked, and what it can do. */
interface PublishDialog {
  view: PublishView;
  asking: boolean;
  working: "publishing" | "taking" | null;
  takeFailure: string | null;
  publish: () => Promise<void>;
  take: (takeLive: () => Promise<void>) => Promise<void>;
}

function usePublishDialog({
  open,
  onOpenChange,
  target,
  language,
  labelOf,
  goingLiveToo,
  shown,
  onFailed,
  onPublished,
}: PublishLanguageDialogProps): PublishDialog {
  const request = { locales: [language.code] };
  const description = usePublishPartsDescription({
    target,
    direction: "publish",
    request,
    enabled: open,
  });
  const move = usePublishParts({ target, direction: "publish", shown });
  // Publishing lasts until the page has read what it left.
  const [working, setWorking] = useState<PublishDialog["working"]>(null);
  // What was confirmed stays said until it is done: the publish itself makes
  // the description ask again.
  const [confirmed, setConfirmed] = useState<PublishPartsResult | null>(null);
  const [takeFailure, setTakeFailure] = useState<string | null>(null);

  const publishing = working === "publishing";
  const asking = description.isFetching && !publishing;
  const described = confirmed ?? description.data;
  const view = publishView({
    language,
    labelOf,
    goingLiveToo,
    described,
    refusal: publishing ? null : (move.error ?? description.error),
    undescribed: description.error !== null,
    changedSince: move.error !== null && refusedAsChangedSince(move.error),
    asking,
    publishing,
    busy: working !== null,
  });

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
  return { view, asking, working, takeFailure, publish, take };
}

/** What the publish does, said as it becomes known. */
function Described({
  asking,
  says,
}: {
  asking: boolean;
  says: readonly string[];
}): JSX.Element {
  return (
    <div role="status" className="space-y-2 text-sm text-foreground">
      {asking ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking what readers will see…
        </p>
      ) : null}
      {says.map(sentence => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}

/** The dialog's one confirm: the publish, or what has to be done before it. */
function Confirm({
  language,
  dialog,
  takeLiveValues,
}: {
  language: string;
  dialog: PublishDialog;
  takeLiveValues: (() => Promise<void>) | undefined;
}): JSX.Element {
  const { view, asking, working, publish, take } = dialog;
  if (view.behind !== undefined && takeLiveValues !== undefined) {
    return (
      <ConfirmButton
        key="take"
        held={working !== null || asking}
        onConfirm={() => void take(takeLiveValues)}
      >
        {working === "taking"
          ? "Taking the live values…"
          : "Take the live values"}
      </ConfirmButton>
    );
  }
  return (
    <ConfirmButton
      key="publish"
      held={view.held}
      onConfirm={() => void publish()}
    >
      {working === "publishing" ? "Publishing…" : `Publish ${language}`}
    </ConfirmButton>
  );
}

/** Why nothing is published, and who has to act. */
function Refusals({
  language,
  dialog,
  takeLiveValues,
}: {
  language: string;
  dialog: PublishDialog;
  takeLiveValues: (() => Promise<void>) | undefined;
}): JSX.Element {
  const { view, takeFailure } = dialog;
  return (
    <>
      {view.refused.map(message => (
        <Refusal key={message} message={message} />
      ))}
      {takeFailure === null ? null : <Refusal message={takeFailure} />}
      {view.behind !== undefined && takeLiveValues === undefined ? (
        <p className="text-sm text-muted-foreground">
          Someone who may edit {language} has to take the live values of{" "}
          {behindOn(view.behind)}.
        </p>
      ) : null}
    </>
  );
}

export function PublishLanguageDialog(
  props: PublishLanguageDialogProps
): JSX.Element {
  const { open, language, labelOf, empty, takeLiveValues } = props;
  const dialog = usePublishDialog(props);
  const { view, asking, working } = dialog;
  // Held open until what it started is done.
  const change = (next: boolean) => {
    if (working === null) props.onOpenChange(next);
  };
  const about = { language: language.label, dialog, takeLiveValues };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Publish {language.label}?</DialogTitle>
          <DialogDescription>
            What {language.label} readers will see once it is published.
          </DialogDescription>
        </DialogHeader>
        <Described asking={asking} says={view.says} />
        {view.listsEmpty ? (
          <EmptyFields
            empty={empty}
            language={language.label}
            labelOf={labelOf}
          />
        ) : null}
        <Refusals {...about} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => change(false)}>
            Cancel
          </Button>
          <Confirm {...about} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
