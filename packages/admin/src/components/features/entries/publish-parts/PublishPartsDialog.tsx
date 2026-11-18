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

import type { JSX } from "react";
import { useId, useState } from "react";

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
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { refusedAsChangedSince } from "@admin/lib/document-version";
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
import { readyProblems } from "./ready-to-publish";
import { ReadyToPublish } from "./ReadyToPublish";

/**
 * The workflow governing the document, as the dialog reads it: its review state part by part,
 * and whether this person may publish past it. Absent where no workflow is attached.
 */
export interface PublishReview {
  document: ReleaseDocumentRef;
  parts: readonly PartReview[];
  /** Whether the person holds `publish-without-review-<slug>`. */
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
  const sharedId = useId();
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
  const problems =
    review === undefined || direction !== "publish"
      ? []
      : readyProblems({
          choice,
          parts: review.parts,
          refusal,
          translated: languages.length > 0,
          labelOf,
        });
  const general = (refused.get("") ?? []).filter(
    message => !problems.some(problem => problem.text === message)
  );

  const outcomes = new Map(
    (description.data?.languages ?? []).map(language => [
      language.locale,
      language,
    ])
  );

  const confirm = async (): Promise<void> => {
    try {
      const done = await move.mutateAsync({
        locales: choice.locales,
        shared: choice.shared,
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
      // Shown in the dialog beside the parts it names; the dialog stays open.
    }
  };

  const changedSince = refusal !== null && refusedAsChangedSince(refusal);
  const otherRefusal =
    refusal !== null && refused.size === 0 && !changedSince
      ? apiErrorMessage(refusal, "This could not be done.")
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-publish-parts-dialog="">
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

        {description.isFetching ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking what this does to each part…
          </p>
        ) : null}
        {[...general, ...(otherRefusal ? [otherRefusal] : [])].map(message => (
          <p
            key={message}
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
          </p>
        ))}
        {changedSince ? (
          <p role="alert" className="text-sm text-destructive">
            This document changed since you opened it. Review the latest
            version, then try again.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={direction === "unpublish" ? "destructive" : "default"}
            disabled={
              !choosesAnything(choice) || move.isPending || problems.length > 0
            }
            onClick={() => void confirm()}
          >
            {move.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {ACTION[direction]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          {refusals.map(message => (
            <p key={message} className="text-destructive">
              {message}
            </p>
          ))}
        </div>
      </div>
    </li>
  );
}
