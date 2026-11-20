"use client";

/**
 * "Choose what to publish": the languages of a document, and separately its shared fields, each a
 * choice of its own, with what each will do said beside it before anything goes live.
 *
 * Opens with the language being edited chosen, and the shared fields chosen when they hold
 * unpublished changes. Every change of choice asks the server to describe the request again, so
 * the sentences are the server's, not a guess. A refusal is shown beside each part it names; the
 * request changes nothing until every chosen part may go.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/PublishPartsDialog
 */

import type { JSX, RefObject } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { AlertTriangle, Loader2 } from "@admin/components/icons";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@admin/components/ui";
import {
  usePublishParts,
  usePublishPartsDescription,
  type PartsTarget,
} from "@admin/hooks/queries/usePublishParts";
import {
  editorMainAction,
  useDialogReturnFocus,
} from "@admin/hooks/useDialogReturnFocus";
import type { ShownCopy } from "@admin/lib/document-version";
import type {
  PartsLanguageOutcome,
  PublishPartsDirection,
} from "@admin/services/publishParts";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import type { LanguageLabel } from "../publishAllOutcomes";

import {
  choosesAnything,
  partsOutcomeSentence,
  refusalsByPart,
  sharedSentence,
  SHARED_PATH,
  withLanguage,
  type PartsChoice,
} from "./publish-parts-choice";
import {
  dialogRefusals,
  holdingProblems,
  offersPublishWithoutReview,
  outcomesByLocale,
} from "./publish-parts-dialog-state";
import { ReadyToPublish, WithoutReviewReason } from "./ReadyToPublish";

/**
 * The workflow governing the document, as the dialog reads it: its review state part by part,
 * and whether this person may publish past it. Absent where no workflow is attached.
 */
export interface PublishReview {
  document: ReleaseDocumentRef;
  parts: readonly PartReview[];
  /** Whether the person may publish past the workflow, as the server judges it. */
  mayPublishWithoutReview: boolean;
}

export interface PublishPartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PartsTarget;
  direction: PublishPartsDirection;
  /** The site's languages, in order; none where the document is not translated. */
  languages: readonly string[];
  labelOf: LanguageLabel;
  /** The choice the dialog opens with. */
  initialChoice: PartsChoice;
  /** The editor's copy, so a part changed since it was read is refused. */
  shown?: () => ShownCopy | undefined;
  /** Told what was done, once it is done. */
  onDone?: (summary: string) => void;
  /** The workflow governing the document, where one is attached. */
  review?: PublishReview;
}

const TITLE: Record<PublishPartsDirection, string> = {
  publish: "Choose what to publish",
  unpublish: "Choose what to unpublish",
};

const ACTION: Record<PublishPartsDirection, string> = {
  publish: "Publish",
  unpublish: "Unpublish",
};

/** The sentence after the move, from what the server reports it did. */
function doneSummary(
  direction: PublishPartsDirection,
  languages: readonly PartsLanguageOutcome[],
  shared: boolean,
  labelOf: LanguageLabel
): string {
  const parts = [
    ...languages.map(language => labelOf(language.locale)),
    ...(shared ? ["the shared fields"] : []),
  ];
  const verb = direction === "publish" ? "Published" : "Unpublished";
  return parts.length === 0 ? `${verb}.` : `${verb} ${parts.join(", ")}.`;
}

export function PublishPartsDialog({
  open,
  onOpenChange,
  target,
  direction,
  languages,
  labelOf,
  initialChoice,
  shown,
  onDone,
  review,
}: PublishPartsDialogProps): JSX.Element {
  const [choice, setChoice] = useState<PartsChoice>(initialChoice);
  // The reason being written to publish without review; null while not asked.
  const [reason, setReason] = useState<string | null>(null);
  const sharedId = useId();
  // Opened from state (a menu row, or a held Publish), so focus is handed back
  // by hand when it closes: to what opened it, or, where that is gone (a menu
  // row is), to the editor's main action.
  const returnFocus = useDialogReturnFocus(open, editorMainAction);
  // Back from the reason, focus returns to the button that asked for it,
  // which the reason step had taken off the page.
  const offerWithoutReview = useRef<HTMLButtonElement>(null);
  const [backFromReason, setBackFromReason] = useState(false);
  useEffect(() => {
    if (!backFromReason || reason !== null) return;
    offerWithoutReview.current?.focus();
    setBackFromReason(false);
  }, [backFromReason, reason]);
  const description = usePublishPartsDescription({
    target,
    direction,
    request: { locales: choice.locales, shared: choice.shared },
    enabled: open,
  });
  const move = usePublishParts({ target, direction, shown });
  // What the server refuses, by part: from the move when it was refused, else from the
  // description, which is refused for the same reasons the move would be.
  const refusal = move.error ?? description.error ?? null;
  const refused = refusalsByPart(refusal, [...languages, SHARED_PATH]);
  // What holds Publish where a workflow governs the document, each with its fix. A field it
  // lists is said there, and not again among the general refusals.
  const problems = holdingProblems({
    parts: review?.parts,
    direction,
    choice,
    refusal,
    languages,
    labelOf,
  });
  // Offered only to a person who may, and only while a chosen part waits for approval.
  const offersWithoutReview = offersPublishWithoutReview(
    review?.mayPublishWithoutReview,
    problems
  );
  const outcomes = outcomesByLocale(description.data);

  const confirm = async (withoutReview?: string): Promise<void> => {
    try {
      const done = await move.mutateAsync({
        locales: choice.locales,
        shared: choice.shared,
        ...(withoutReview === undefined
          ? {}
          : { withoutReview: { reason: withoutReview } }),
      });
      onDone?.(
        doneSummary(
          direction,
          done.languages,
          done.shared.changes || done.shared.added,
          labelOf
        )
      );
      onOpenChange(false);
    } catch {
      // Shown in the dialog beside the parts it names; the dialog stays open, back on the parts.
      setReason(null);
    }
  };

  // Asked again of the parts chosen now: a selection changed while the reason was written may no
  // longer need the bypass, and then it is left and the publish made as usual, never sent past a
  // review it does not need. Anything else still holding Publish keeps it held.
  const confirmWithoutReview = async (why: string): Promise<void> => {
    if (offersWithoutReview) {
      await confirm(why);
      return;
    }
    setReason(null);
    if (problems.length === 0) await confirm();
  };

  const { messages, changedSince } = dialogRefusals(refusal, refused, problems);
  const canMove = choosesAnything(choice) && !move.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-publish-parts-dialog=""
        onCloseAutoFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>{TITLE[direction]}</DialogTitle>
          <DialogDescription>
            {direction === "publish"
              ? "Each language, and the fields every language shares, is a choice of its own."
              : "Take down the languages you choose, or the whole document with every language and the shared fields."}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-3" aria-describedby={undefined}>
          {languages.length > 0 ? (
            <legend className="text-sm font-medium text-foreground">
              Languages
            </legend>
          ) : null}
          <ul className="space-y-2">
            {languages.map(locale => (
              <PartRow
                key={locale}
                id={`${sharedId}-${locale}`}
                label={labelOf(locale)}
                checked={choice.locales.includes(locale)}
                onChecked={checked =>
                  setChoice(current =>
                    withLanguage(current, languages, locale, checked)
                  )
                }
                sentence={
                  choice.locales.includes(locale) && outcomes.has(locale)
                    ? partsOutcomeSentence(outcomes.get(locale)!, labelOf)
                    : undefined
                }
                refusals={refused.get(locale) ?? []}
              />
            ))}
            <PartRow
              id={sharedId}
              label="Shared fields"
              hint="The fields every language shares."
              checked={choice.shared}
              onChecked={checked =>
                setChoice(current => ({ ...current, shared: checked }))
              }
              sentence={
                description.data
                  ? sharedSentence(direction, description.data.shared)
                  : undefined
              }
              refusals={refused.get(SHARED_PATH) ?? []}
            />
          </ul>
        </fieldset>

        {review === undefined ? null : (
          <ReadyToPublish document={review.document} problems={problems} />
        )}
        {reason === null ? null : (
          <WithoutReviewReason
            value={reason}
            onChange={setReason}
            disabled={move.isPending}
          />
        )}

        <DialogNotices
          checking={description.isFetching}
          messages={messages}
          changedSince={changedSince}
        />

        {reason !== null ? (
          <ReasonFooter
            reason={reason}
            pending={move.isPending}
            canMove={canMove}
            onBack={() => {
              setReason(null);
              setBackFromReason(true);
            }}
            onConfirm={why => void confirmWithoutReview(why)}
          />
        ) : (
          <PartsFooter
            direction={direction}
            pending={move.isPending}
            canMove={canMove}
            held={problems.length > 0}
            offersWithoutReview={offersWithoutReview}
            offerRef={offerWithoutReview}
            onCancel={() => onOpenChange(false)}
            onOffer={() => setReason("")}
            onConfirm={() => void confirm()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the dialog says below its parts: that it is asking the server, the refusals read on its
 * surface, and that the document changed since it was opened.
 */
function DialogNotices({
  checking,
  messages,
  changedSince,
}: {
  checking: boolean;
  messages: readonly string[];
  changedSince: boolean;
}): JSX.Element {
  return (
    <>
      {checking ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking what this does to each part…
        </p>
      ) : null}
      {/* Refusals are read on the dialog's surface, so they take the danger text token, which
          reaches 4.5:1 there in light and dark; the destructive red is a fill's colour. */}
      {messages.map(message => (
        <p
          key={message}
          role="alert"
          className="flex items-start gap-2 text-sm text-danger-text"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {message}
        </p>
      ))}
      {changedSince ? (
        <p role="alert" className="text-sm text-danger-text">
          This document changed since you opened it. Review the latest version,
          then try again.
        </p>
      ) : null}
    </>
  );
}

/**
 * The footer while the reason to publish without review is written: back to the parts, or
 * publish with the reason, which is refused while it is blank.
 */
function ReasonFooter({
  reason,
  pending,
  canMove,
  onBack,
  onConfirm,
}: {
  reason: string;
  pending: boolean;
  /** Whether anything is chosen and no move is under way. */
  canMove: boolean;
  onBack: () => void;
  onConfirm: (why: string) => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={onBack}
      >
        Back
      </Button>
      <Button
        type="button"
        disabled={!canMove || reason.trim() === ""}
        onClick={() => onConfirm(reason.trim())}
      >
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Publish without review
      </Button>
    </DialogFooter>
  );
}

/**
 * The footer on the parts: Cancel, the offer to publish without review where it is made, and the
 * move itself, refused while anything holds it.
 */
function PartsFooter({
  direction,
  pending,
  canMove,
  held,
  offersWithoutReview,
  offerRef,
  onCancel,
  onOffer,
  onConfirm,
}: {
  direction: PublishPartsDirection;
  pending: boolean;
  /** Whether anything is chosen and no move is under way. */
  canMove: boolean;
  /** Whether anything holds Publish. */
  held: boolean;
  offersWithoutReview: boolean;
  /** The offer's button, which focus returns to back from the reason. */
  offerRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onOffer: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      {offersWithoutReview ? (
        <Button
          ref={offerRef}
          type="button"
          variant="outline"
          disabled={!canMove}
          onClick={onOffer}
        >
          Publish without review…
        </Button>
      ) : null}
      <Button
        type="button"
        variant={direction === "unpublish" ? "destructive" : "default"}
        disabled={!canMove || held}
        onClick={onConfirm}
      >
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {ACTION[direction]}
      </Button>
    </DialogFooter>
  );
}

/** One part: its checkbox, what it will do, and why it is refused. */
function PartRow({
  id,
  label,
  hint,
  checked,
  onChecked,
  sentence,
  refusals,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChecked: (checked: boolean) => void;
  sentence: string | undefined;
  refusals: readonly string[];
}): JSX.Element {
  const describedBy = `${id}-about`;
  return (
    <li className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={next => onChecked(next === true)}
        aria-describedby={describedBy}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-medium text-foreground">
          {label}
        </Label>
        <div id={describedBy} className="text-sm text-muted-foreground">
          {hint ? <p>{hint}</p> : null}
          {sentence ? <p>{sentence}</p> : null}
          {/* The danger text token: readable at 4.5:1 on the dialog in light and dark. */}
          {refusals.map(message => (
            <p key={message} className="text-danger-text">
              {message}
            </p>
          ))}
        </div>
      </div>
    </li>
  );
}
