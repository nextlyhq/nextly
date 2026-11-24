"use client";

/**
 * The side panel's Review section: for the part on screen (and, on a
 * translated document, its shared fields), the stage it stands in, who it
 * waits for, who it is assigned to, when it is due, and its last move.
 *
 * The steps are the header's main button, so the section draws none for the
 * parts the header moves (`partsOnScreen`); only a part the header does not
 * speak for (the shared fields waiting in another stage than the language)
 * offers its own steps here, so it can still be moved. A person who may
 * assign a part has one Assign… picker of people and roles.
 *
 * Reads the same review state the header does, under the same key, so the
 * two never disagree and the panel costs no request of its own. Draws nothing
 * where no workflow is attached.
 *
 * @module components/features/entries/review/ReviewSection
 * @experimental
 */

import { Button } from "@nextlyhq/ui";
import { Fragment, type JSX } from "react";
import type React from "react";

import { StagePill } from "@admin/components/features/settings/workflows/StagePill";
import { useReviewState } from "@admin/hooks/queries/useReviewState";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { useHasPermission } from "@admin/hooks/useHasPermission";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import { leadingReviewStep } from "../EntryForm/document-actions";
import { PanelSection } from "../EntryForm/panels/PanelSection";

import { AssignPicker } from "./AssignPicker";
import { partsOnScreen, waitingForWords } from "./review-words";
import { approves, useSharedApprovalHold } from "./shared-hold";
import { StepRefusalNote } from "./StepRefusalNote";
import { useStepTaker, type StepTaker } from "./useStepTaker";

export interface ReviewSectionProps {
  document: ReleaseDocumentRef;
  /** The language being edited; the default language where none is named. */
  locale?: string | undefined;
  /**
   * Why no step can be taken at this moment, as the editor holds its header's
   * steps (`stepsHold`): unsaved edits, a save on its way, a past version on
   * screen. The steps here wait for it, and say it.
   */
  hold?: string | undefined;
}

export function ReviewSection({
  document,
  locale,
  hold,
}: ReviewSectionProps): JSX.Element | null {
  const { data } = useReviewState(document);
  const { defaultLocale, getLocale } = useLocalization();
  const taker = useStepTaker(document);
  // Held where the shared fields' version under review is hidden from this
  // person: see `shared-hold`.
  const sharedHeld = useSharedApprovalHold(
    document,
    data?.attached === true ? data.review.parts : []
  );
  const language = locale ?? defaultLocale;
  if (data === undefined || !data.attached) return null;
  const own = data.review.parts.find(part => part.part === language);
  const shared = data.review.parts.find(part => part.part === null);
  // The language on screen and the shared fields, each on its own: they can
  // stand in different stages, which the header's single line cannot say. A
  // document that is not translated has the shared part alone.
  const parts = [own, shared].filter(
    (part): part is PartReview => part !== undefined
  );
  if (parts.length === 0) return null;
  const titled = parts.length > 1;
  // The parts the header's main button moves, read by the same rule the
  // header uses, so no step is offered in both places.
  const moved = new Set(
    partsOnScreen(data, language).map(each => each.part ?? "")
  );
  return (
    <PanelSection title="Review">
      <div className="space-y-4">
        {parts.map(part => (
          <PartBlock
            key={part.part ?? ""}
            document={document}
            part={part}
            taker={taker}
            hold={hold}
            approvalHeld={part.part === null ? sharedHeld : undefined}
            offersSteps={!moved.has(part.part ?? "")}
            title={
              !titled
                ? null
                : part.part === null
                  ? "Shared fields"
                  : (getLocale(part.part)?.label ?? part.part)
            }
          />
        ))}
      </div>
      <StepRefusalNote refusal={taker.refusal} onDismiss={taker.clearRefusal} />
      {taker.dialog}
    </PanelSection>
  );
}

function PartBlock({
  document,
  part,
  taker,
  hold,
  approvalHeld,
  offersSteps,
  title,
}: {
  document: ReleaseDocumentRef;
  part: PartReview;
  taker: StepTaker;
  hold: string | undefined;
  approvalHeld: string | undefined;
  /** Whether its steps are drawn here, for a part the header does not move. */
  offersSteps: boolean;
  title: string | null;
}): JSX.Element {
  return (
    <div className="space-y-1.5 text-sm" data-review-part={part.part ?? ""}>
      {title === null ? null : (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      {part.stage === null ? (
        <p className="font-medium text-foreground">
          Live, nothing waiting for review
        </p>
      ) : (
        <>
          <PartFacts part={part} />
          {offersSteps ? (
            <PartSteps
              part={part}
              taker={taker}
              hold={hold}
              approvalHeld={approvalHeld}
            />
          ) : null}
          <AssignControls document={document} part={part} />
        </>
      )}
      <LastMove part={part} />
    </div>
  );
}

/**
 * Where a part in review stands, as label and value rows: its stage (as
 * Settings shows it, its saved label on its colour), who it waits for, who it
 * is assigned to, and when it is due.
 */
function PartFacts({ part }: { part: PartReview }): JSX.Element {
  const { formatDate } = useAdminDateFormatter();
  const waiting = waitingForWords(part.waitingFor);
  const rows: { term: string; value: React.ReactNode }[] = [
    {
      term: "Stage",
      value: (
        <StagePill
          label={part.stageLabel ?? part.stage ?? ""}
          colour={part.stageColour}
        />
      ),
    },
    { term: "Waiting for", value: waiting ?? "No one" },
    {
      term: "Assigned",
      value: part.assignee === null ? "Nobody" : (waiting ?? part.assignee.id),
    },
    ...(part.dueAt === null
      ? []
      : [
          {
            term: "Due",
            value: formatDate(part.dueAt, { dateStyle: "medium" }, part.dueAt),
          },
        ]),
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs">
      {rows.map(row => (
        <Fragment key={row.term}>
          <dt className="text-muted-foreground">{row.term}</dt>
          <dd className="min-w-0 text-foreground">{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function PartSteps({
  part,
  taker,
  hold,
  approvalHeld,
}: {
  part: PartReview;
  taker: StepTaker;
  hold: string | undefined;
  approvalHeld: string | undefined;
}): JSX.Element | null {
  const steps = part.steps
    .filter(step => step.mayTake)
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  if (steps.length === 0) return null;
  const take = (step: ReviewStep) => {
    void taker.take(step, [part]);
  };
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {steps.map(step => (
        <Button
          key={step.name}
          type="button"
          size="sm"
          variant={step.primary ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          disabled={
            taker.pending ||
            hold !== undefined ||
            part.version === null ||
            (approvalHeld !== undefined && approves(step))
          }
          onClick={() => take(step)}
        >
          {step.label}
        </Button>
      ))}
      {/* What holds every step is said first, and the shared approval's
          own hold only where nothing else holds them. */}
      {hold === undefined ? null : (
        <p className="w-full text-xs text-muted-foreground">{hold}</p>
      )}
      {hold !== undefined ||
      approvalHeld === undefined ||
      !steps.some(step => approves(step)) ? null : (
        <p className="w-full text-xs text-muted-foreground">{approvalHeld}</p>
      )}
    </div>
  );
}

/** Who the part is assigned to, or that it is not and who it waits for. */
/**
 * The Assign… picker, for a person who may assign the part: one who may edit
 * the document, or who may take its stage's primary step.
 */
function AssignControls({
  document,
  part,
}: {
  document: ReleaseDocumentRef;
  part: PartReview;
}): JSX.Element | null {
  const has = useHasPermission();
  const leading = leadingReviewStep(part.steps);
  const mayAssign =
    has(`update-${document.scopeSlug}`) || leading?.mayTake === true;
  if (!mayAssign || leading === undefined) return null;
  return <AssignPicker document={document} part={part} />;
}

/** The part's latest move: who moved it where, when, and what they said. */
function LastMove({ part }: { part: PartReview }): JSX.Element | null {
  const { formatDate } = useAdminDateFormatter();
  const move = part.lastMove;
  if (move === null) return null;
  const who = move.actor.name ?? "Someone";
  const where =
    move.to === null
      ? "out of review"
      : `to ${move.to === part.stage ? (part.stageLabel ?? move.to) : move.to}`;
  return (
    <div className="pt-1 text-xs text-muted-foreground">
      <p>
        {who} moved it {where},{" "}
        {formatDate(
          move.at,
          { dateStyle: "medium", timeStyle: "short" },
          move.at
        )}
      </p>
      {move.comment === null ? null : (
        <p className="italic">“{move.comment}”</p>
      )}
    </div>
  );
}
