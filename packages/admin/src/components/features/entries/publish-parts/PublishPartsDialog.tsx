"use client";

/**
 * "Choose what to publish": the languages of a document, and separately its shared fields, each a
 * choice of its own, with what each will do said beside it before anything goes live. The same
 * dialog opens from the editor's Publish, where publishing changes more than the language on
 * screen, and takes down the parts a person chooses.
 *
 * Opens with the choice it is given: from the editor, the language being edited, and the shared
 * fields when they hold unpublished changes. Every change of choice asks the server to describe
 * the request again, so the sentences are the server's, not a guess. A publish also asks what
 * publishing every language would do, which is what the parts not chosen say and which parts have
 * anything to publish: one that has nothing is not offered, and neither described nor sent. The
 * confirm waits for the description of the parts as chosen, so nothing undescribed is sent. A
 * refusal is shown beside each part it names; the request changes nothing until every chosen part
 * may go.
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
  useDescribePartsAgain,
  usePublishParts,
  usePublishPartsDescription,
  type PartsRequest,
  type PartsTarget,
} from "@admin/hooks/queries/usePublishParts";
import {
  apiErrorMessage,
  validationIssues,
} from "@admin/lib/api/parseApiError";
import { refusedAsChangedSince } from "@admin/lib/document-version";
import type { ShownCopy } from "@admin/lib/document-version";
import type {
  PartsLanguageOutcome,
  PublishPartsDirection,
  PublishPartsResult,
} from "@admin/services/publishParts";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import { useReturnFocusOnClose } from "../../releases/dialog-opener";
import type { LanguageLabel } from "../publishAllOutcomes";

import type { TranslationOverview } from "./out-of-date";
import {
  movedParts,
  offeredChoice,
  publishChoices,
  type PublishChoiceRow,
} from "./publish-choices";
import {
  choosesAnything,
  partsOutcomeSentence,
  refusalsByPart,
  sameParts,
  sharedSentence,
  SHARED_PATH,
  withLanguage,
  type PartsChoice,
} from "./publish-parts-choice";
import {
  readyProblems,
  refusedForApprovalAlone,
  type ReadyProblem,
} from "./ready-to-publish";
import { ReadyToPublish, WithoutReviewReason } from "./ReadyToPublish";
import { usePredictedOutOfDate } from "./usePredictedOutOfDate";

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

/** What opens the dialog to publish: its own row on the menu, or the editor's Publish. */
export type PartsDialogOpener = "menu" | "publish";

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
  /** The language on screen. */
  currentLocale?: string;
  /** Whether the shared fields hold changes nobody has published; none where absent. */
  sharedPending?: boolean;
  /** What opened it to publish; the menu where absent. */
  openedBy?: PartsDialogOpener;
  /** The document's translation overview, where the person may read it. */
  overview?: TranslationOverview;
  /** The editor's copy, so a part changed since it was read is refused. */
  shown?: () => ShownCopy | undefined;
  /** Told what was done, once it is done. */
  onDone?: (summary: string) => void;
  /** Told, once a publish is done, which languages the server says went live. */
  onPublished?: (result: { published: readonly string[] }) => void;
  /** The workflow governing the document, where one is attached. */
  review?: PublishReview;
  /**
   * Whether the dialog opens asking the reason to publish without review, as
   * it does when opened from "Publish without review…" on the main button's
   * menu, rather than at the choice of parts.
   */
  asksReason?: boolean;
}

/** The request that asks what publishing every language would do. */
const EVERY_LANGUAGE_REQUEST: PartsRequest = { locales: "all" };

/** The code of a publish refused because a chosen language's change also edits shared fields. */
const SHARED_EDITS_PENDING = "SHARED_EDITS_PENDING";

/** The editor header's main button, on the page while the dialog is open. */
const MAIN_BUTTON = '[data-primary="true"]';

const DESCRIPTION: Record<PublishPartsDirection, string> = {
  publish:
    "Each language, and the fields every language shares, is a choice of its own.",
  unpublish:
    "Take down the languages you choose, or the whole document with every language and the shared fields.",
};

function titleOf(
  direction: PublishPartsDirection,
  openedBy: PartsDialogOpener | undefined
): string {
  if (direction === "unpublish") return "Choose what to unpublish";
  return openedBy === "publish" ? "Publish changes" : "Choose what to publish";
}

/** What the confirm says: "selected" wherever there are languages to select. */
function confirmLabelOf(
  direction: PublishPartsDirection,
  translated: boolean
): string {
  if (direction === "unpublish") return "Unpublish";
  return translated ? "Publish selected" : "Publish";
}

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

/** The languages of `answer` with one of `outcomes`. */
function languagesWith(
  answer: PublishPartsResult | undefined,
  ...outcomes: readonly PartsLanguageOutcome["outcome"][]
): string[] {
  return (answer?.languages ?? [])
    .filter(language => outcomes.includes(language.outcome))
    .map(language => language.locale);
}

/** A query's answer, or none once the latest ask of it failed. */
function answerOf(query: {
  isError: boolean;
  data: PublishPartsResult | undefined;
}): PublishPartsResult | undefined {
  return query.isError ? undefined : query.data;
}

/** Whether the server refuses to publish a chosen language without the shared fields. */
function needsShared(refusal: unknown): boolean {
  return validationIssues(refusal).some(
    issue => issue.code === SHARED_EDITS_PENDING
  );
}

/** The parts as chosen, and as the server describes them. */
interface DescribedParts {
  /** What is described and sent: the choice, less what is not offered. */
  request: PartsChoice;
  chosenAnswer: PublishPartsResult | undefined;
  everyLanguageAnswer: PublishPartsResult | undefined;
  /** Whether the shared fields hold changes, as the editor's read or the server says. */
  sharedPending: boolean;
  /** What publishing every language does is being asked, so the request may yet shrink. */
  settling: boolean;
  /** Either description is being asked. */
  checking: boolean;
  /** The server has described the request as it stands: neither asking, refused nor failed. */
  described: boolean;
  /**
   * The server has described the request, or refused it for want of approval alone, which
   * publishing without review goes past.
   */
  describedPastReview: boolean;
  /** Why the server refuses the request, if it does. */
  error: Error | null;
}

/** Whether what publishing every language would do is asked: for a publish among languages. */
function asksOfEveryLanguage({
  open,
  direction,
  languages,
}: Pick<PublishPartsDialogProps, "open" | "direction" | "languages">): boolean {
  return open && direction === "publish" && languages.length > 0;
}

/** Whether a query asked has no answer yet, or is asking again. */
function beingAsked(query: { isPending: boolean; isFetching: boolean }) {
  return query.isPending || query.isFetching;
}

/**
 * The request the choice makes, and what the server says of it. For a publish, what publishing
 * every language does is asked first, since it says which parts have anything to publish; where
 * that is refused or fails, every part is offered and the server judges the request itself.
 */
function useDescribedParts({
  open,
  target,
  direction,
  languages,
  choice,
  sharedPending,
}: {
  open: boolean;
  target: PartsTarget;
  direction: PublishPartsDirection;
  languages: readonly string[];
  choice: PartsChoice;
  sharedPending: boolean | undefined;
}): DescribedParts {
  const publishing = direction === "publish";
  const asksEvery = asksOfEveryLanguage({ open, direction, languages });
  const every = usePublishPartsDescription({
    target,
    direction,
    request: EVERY_LANGUAGE_REQUEST,
    enabled: asksEvery,
  });
  const settling = asksEvery && beingAsked(every);
  // Where a language's change holds the shared values too, the editor's read does not say they
  // changed; the server does, refusing the language without them. From then on they are a choice
  // to make for as long as the dialog is open.
  const [editsShared, setEditsShared] = useState(false);
  const known = {
    languages,
    everyLanguageAnswer: answerOf(every),
    sharedPending: sharedPending === true || editsShared,
  };
  const request = publishing ? offeredChoice(choice, known) : choice;
  const description = usePublishPartsDescription({
    target,
    direction,
    request: { locales: request.locales, shared: request.shared },
    enabled: open && !settling,
  });
  if (!editsShared && needsShared(description.error)) setEditsShared(true);
  const answered = !settling && !beingAsked(description);
  return {
    request,
    chosenAnswer: answerOf(description),
    everyLanguageAnswer: known.everyLanguageAnswer,
    sharedPending: known.sharedPending,
    settling,
    checking: settling || description.isFetching,
    described: answered && !description.isError,
    describedPastReview:
      answered &&
      (!description.isError || refusedForApprovalAlone(description.error)),
    error: description.error,
  };
}

/** The rows of an unpublish: what each chosen part does, in the server's words. */
function unpublishRows(args: {
  languages: readonly string[];
  labelOf: LanguageLabel;
  choice: PartsChoice;
  answer: PublishPartsResult | undefined;
}): PublishChoiceRow[] {
  const outcomes = new Map(
    (args.answer?.languages ?? []).map(language => [language.locale, language])
  );
  const languageRows = args.languages.map((locale): PublishChoiceRow => {
    const chosen = args.choice.locales.includes(locale);
    const outcome = chosen ? outcomes.get(locale) : undefined;
    return {
      part: locale,
      label: args.labelOf(locale),
      current: false,
      chosen,
      offered: true,
      says: outcome && partsOutcomeSentence(outcome, args.labelOf),
    };
  });
  return [
    ...languageRows,
    {
      part: SHARED_PATH,
      label: "Shared fields",
      current: false,
      chosen: args.choice.shared,
      offered: true,
      says: args.answer && sharedSentence("unpublish", args.answer.shared),
    },
  ];
}

/** The rows as drawn, and the lines after them: what a publish lists, or an unpublish. */
function useDrawnParts({
  open,
  target,
  direction,
  languages,
  labelOf,
  currentLocale,
  choice,
  overview,
  parts,
}: Pick<
  PublishPartsDialogProps,
  | "open"
  | "target"
  | "direction"
  | "languages"
  | "labelOf"
  | "currentLocale"
  | "overview"
> & { choice: PartsChoice; parts: DescribedParts }): {
  rows: readonly PublishChoiceRow[];
  facts: readonly string[];
} {
  const changing = languagesWith(
    parts.chosenAnswer ?? parts.everyLanguageAnswer,
    "goes-live-with-pending-change"
  );
  const outOfDate = usePredictedOutOfDate({
    target,
    languages,
    chosen: parts.request.locales.filter(locale => changing.includes(locale)),
    overview,
    enabled: open && direction === "publish",
  });
  if (direction === "unpublish") {
    const answer = parts.chosenAnswer;
    return {
      rows: unpublishRows({ languages, labelOf, choice, answer }),
      facts: [],
    };
  }
  return publishChoices({
    languages,
    labelOf,
    // Which language is on screen is worth saying only among others.
    currentLocale: languages.length > 1 ? currentLocale : undefined,
    choice,
    chosenAnswer: parts.chosenAnswer,
    everyLanguageAnswer: parts.everyLanguageAnswer,
    sharedPending: parts.sharedPending,
    outOfDate,
  });
}

/**
 * Publishing or unpublishing the request, and telling whoever asked to be told. A refusal is of
 * the parts chosen when it was made: chosen otherwise, they are not refused until they are sent.
 */
function usePartsMove({
  target,
  direction,
  labelOf,
  shown,
  onDone,
  onPublished,
  onOpenChange,
  onRefused,
  choice,
  request,
}: Pick<
  PublishPartsDialogProps,
  | "target"
  | "direction"
  | "labelOf"
  | "shown"
  | "onDone"
  | "onPublished"
  | "onOpenChange"
> & {
  onRefused: () => void;
  /** The parts as the person chose them. */
  choice: PartsChoice;
  /** What is sent: the choice, less what is not offered. */
  request: PartsChoice;
}): {
  confirm: (withoutReview?: string) => Promise<void>;
  pending: boolean;
  error: Error | null;
  /** The last refusal no longer holds the parts it was of. */
  forgetRefusal: () => void;
} {
  const move = usePublishParts({ target, direction, shown });
  const [refusedChoice, setRefusedChoice] = useState<PartsChoice | null>(null);
  const confirm = async (withoutReview?: string): Promise<void> => {
    try {
      const done = await move.mutateAsync({
        locales: request.locales,
        shared: request.shared,
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
      if (direction === "publish") {
        onPublished?.({
          published: languagesWith(
            done,
            "goes-live",
            "goes-live-with-pending-change"
          ),
        });
      }
      onOpenChange(false);
    } catch {
      // Shown in the dialog beside the parts it names; the dialog stays open, back on the parts.
      setRefusedChoice(choice);
      onRefused();
    }
  };
  const ofThisChoice =
    refusedChoice !== null && sameParts(refusedChoice, choice);
  return {
    confirm,
    pending: move.isPending,
    error: ofThisChoice ? move.error : null,
    forgetRefusal: () => setRefusedChoice(null),
  };
}

/** What holds Publish where a workflow governs the document, each with its fix. */
function problemsOf(
  review: PublishReview | undefined,
  direction: PublishPartsDirection,
  args: Omit<Parameters<typeof readyProblems>[0], "parts">
): ReadyProblem[] {
  if (review === undefined || direction !== "publish") return [];
  return readyProblems({ ...args, parts: review.parts });
}

/** Offered only to a person who may, and only while a chosen part waits for approval. */
function offersPublishingWithoutReview(
  review: PublishReview | undefined,
  problems: readonly ReadyProblem[]
): boolean {
  return (
    review?.mayPublishWithoutReview === true &&
    problems.some(problem => problem.unapproved)
  );
}

/**
 * The refusals naming no part: a field "Ready to publish?" lists is said there, and not again
 * here, and a failure that gives no reasons is said in its own words.
 */
function generalRefusals(
  refusal: Error | null,
  refused: ReadonlyMap<string, readonly string[]>,
  problems: readonly ReadyProblem[]
): string[] {
  const unexplained = refused.size === 0 && !refusedAsChangedSince(refusal);
  if (refusal !== null && unexplained) {
    return [apiErrorMessage(refusal, "This could not be done.")];
  }
  return (refused.get("") ?? []).filter(
    message => !problems.some(problem => problem.text === message)
  );
}

/**
 * Focus that closing left on nothing, sent to the editor's main button: what opened the dialog
 * may have been held while it ran, and held controls cannot keep the focus.
 */
function focusMainButton(event: Event): void {
  if (document.activeElement !== document.body) return;
  const main = document.querySelector<HTMLElement>(MAIN_BUTTON);
  if (main === null) return;
  event.preventDefault();
  main.focus();
}

export function PublishPartsDialog(
  props: PublishPartsDialogProps
): JSX.Element {
  const { open, onOpenChange, direction, languages, labelOf, review } = props;
  const [choice, setChoice] = useState<PartsChoice>(props.initialChoice);
  // The reason being written to publish without review; null while not asked.
  const [reason, setReason] = useState<string | null>(
    props.asksReason === true ? "" : null
  );
  const returnFocus = useReturnFocusOnClose(open);
  const translated = languages.length > 0;
  const parts = useDescribedParts({
    open,
    target: props.target,
    direction,
    languages,
    choice,
    sharedPending: props.sharedPending,
  });
  const { request } = parts;
  const { rows, facts } = useDrawnParts({ ...props, choice, parts });
  const describeAgain = useDescribePartsAgain(props.target);
  const move = usePartsMove({
    ...props,
    choice,
    request,
    onRefused: () => setReason(null),
  });
  // What the server refuses, by part: from the move when it was refused, else from the
  // description, which is refused for the same reasons the move would be.
  const refusal = move.error ?? parts.error;
  const refused = refusalsByPart(refusal, [...languages, SHARED_PATH]);
  // What holds Publish where a workflow governs the document, each with its fix. A field it
  // lists is said there, and not again among the general refusals.
  const problems = problemsOf(review, direction, {
    choice: movedParts(request, { languages, ...parts }),
    refusal,
    translated,
    labelOf,
  });
  const offersWithoutReview = offersPublishingWithoutReview(review, problems);
  // Something to send, not on its way already, and no part of it about to be found not offered.
  const ready = choosesAnything(request) && !move.pending && !parts.settling;
  // An ordinary move waits for the server's description of exactly what it sends, and for whatever
  // "Ready to publish?" lists. Publishing without review waits for it too, and goes past one
  // refused for want of approval.
  const held = !parts.described || problems.length > 0;
  const readyPastReview = ready && parts.describedPastReview;

  // Asked again of the parts chosen now: a selection changed while the reason was written may no
  // longer need the bypass, and then it is left and the publish made as usual, never sent past a
  // review it does not need. Where that publish is held, the person is back at it, held.
  const confirmWithoutReview = async (why: string): Promise<void> => {
    if (offersWithoutReview) {
      await move.confirm(why);
      return;
    }
    setReason(null);
    if (!held) await move.confirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-publish-parts-dialog=""
        onCloseAutoFocus={event => {
          returnFocus(event);
          focusMainButton(event);
        }}
      >
        <DialogHeader>
          <DialogTitle>{titleOf(direction, props.openedBy)}</DialogTitle>
          <DialogDescription>{DESCRIPTION[direction]}</DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-3" aria-describedby={undefined}>
          {translated ? (
            <legend className="text-sm font-medium text-foreground">
              Languages
            </legend>
          ) : null}
          <PartRows
            rows={rows}
            refused={refused}
            onChoose={(part, chosen) =>
              setChoice(current =>
                part === SHARED_PATH
                  ? { ...current, shared: chosen }
                  : withLanguage(current, languages, part, chosen)
              )
            }
          />
        </fieldset>
        <Facts facts={facts} />

        {review === undefined ? null : (
          <ReadyToPublish
            document={review.document}
            problems={problems}
            onStepTaken={() => {
              // What the parts were refused for may be settled now: asked of the server again.
              move.forgetRefusal();
              describeAgain();
            }}
          />
        )}
        {reason === null ? null : (
          <WithoutReviewReason
            value={reason}
            onChange={setReason}
            disabled={move.pending}
          />
        )}

        <Outcome
          checking={parts.checking}
          messages={generalRefusals(refusal, refused, problems)}
          refusal={refusal}
        />

        {reason !== null ? (
          <ReasonFooter
            ready={readyPastReview && reason.trim() !== ""}
            pending={move.pending}
            onBack={() => setReason(null)}
            onConfirm={() => void confirmWithoutReview(reason.trim())}
          />
        ) : (
          <ChoiceFooter
            label={confirmLabelOf(direction, translated)}
            destructive={direction === "unpublish"}
            ready={ready}
            readyPastReview={readyPastReview}
            held={held}
            pending={move.pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={() => void move.confirm()}
            onWithoutReview={
              offersWithoutReview ? () => setReason("") : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The parts, each a choice of its own, the shared fields last. */
function PartRows({
  rows,
  refused,
  onChoose,
}: {
  rows: readonly PublishChoiceRow[];
  refused: ReadonlyMap<string, readonly string[]>;
  onChoose: (part: string, chosen: boolean) => void;
}): JSX.Element {
  const listId = useId();
  return (
    <ul className="space-y-2">
      {rows.map(row => (
        <PartRow
          key={row.part}
          id={`${listId}-${row.part}`}
          row={row}
          hint={
            row.part === SHARED_PATH
              ? "The fields every language shares."
              : undefined
          }
          onChecked={chosen => onChoose(row.part, chosen)}
          refusals={refused.get(row.part) ?? []}
        />
      ))}
    </ul>
  );
}

/** One part: its checkbox, what it will do or why it is not offered, and why it is refused. */
function PartRow({
  id,
  row,
  hint,
  onChecked,
  refusals,
}: {
  id: string;
  row: PublishChoiceRow;
  hint: string | undefined;
  onChecked: (checked: boolean) => void;
  refusals: readonly string[];
}): JSX.Element {
  const hereId = `${id}-here`;
  const aboutId = `${id}-about`;
  return (
    <li className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={row.chosen}
        disabled={!row.offered}
        onCheckedChange={next => onChecked(next === true)}
        aria-describedby={row.current ? `${hereId} ${aboutId}` : aboutId}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <div className="flex items-baseline gap-2">
          <Label htmlFor={id} className="font-medium text-foreground">
            {row.label}
          </Label>
          {row.current ? (
            <span id={hereId} className="text-xs text-muted-foreground">
              This page
            </span>
          ) : null}
        </div>
        <div id={aboutId} className="text-sm text-muted-foreground">
          {hint ? <p>{hint}</p> : null}
          {row.says ? <p>{row.says}</p> : null}
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

/** What the publish means beyond its parts: a line, or a list of them. */
function Facts({ facts }: { facts: readonly string[] }): JSX.Element | null {
  if (facts.length === 0) return null;
  if (facts.length === 1) {
    return <p className="text-sm text-muted-foreground">{facts[0]}</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {facts.map(fact => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

/** The check under way, and what was refused that names no part. */
function Outcome({
  checking,
  messages,
  refusal,
}: {
  checking: boolean;
  messages: readonly string[];
  refusal: Error | null;
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
      {refusal !== null && refusedAsChangedSince(refusal) ? (
        <p role="alert" className="text-sm text-danger-text">
          This document changed since you opened it. Review the latest version,
          then try again.
        </p>
      ) : null}
    </>
  );
}

/** Back to the parts, or publish past the review with the reason written. */
function ReasonFooter({
  ready,
  pending,
  onBack,
  onConfirm,
}: {
  ready: boolean;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
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
      <Button type="button" disabled={!ready} onClick={onConfirm}>
        <Spinner shown={pending} />
        Publish without review
      </Button>
    </DialogFooter>
  );
}

/** Cancel, publish without review where that is offered, or move the parts chosen. */
function ChoiceFooter({
  label,
  destructive,
  ready,
  readyPastReview,
  held,
  pending,
  onCancel,
  onConfirm,
  onWithoutReview,
}: {
  label: string;
  destructive: boolean;
  ready: boolean;
  /** Publishing without review may go ahead. */
  readyPastReview: boolean;
  /** The move is not described yet, or something "Ready to publish?" lists holds it. */
  held: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onWithoutReview: (() => void) | undefined;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      {onWithoutReview === undefined ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={!readyPastReview}
          onClick={onWithoutReview}
        >
          Publish without review…
        </Button>
      )}
      <Button
        type="button"
        variant={destructive ? "destructive" : "default"}
        disabled={!ready || held}
        onClick={onConfirm}
      >
        <Spinner shown={pending} />
        {label}
      </Button>
    </DialogFooter>
  );
}

/** Drawn inside a confirm while its request is on its way. */
function Spinner({ shown }: { shown: boolean }): JSX.Element | null {
  return shown ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null;
}
