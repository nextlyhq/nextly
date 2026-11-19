"use client";

/**
 * The side panel's Review section: for the part on screen (and, on a
 * translated document, its shared fields), the stage it stands in, who it is
 * assigned to or waits for, when it is due, and its last move. Each part's
 * own steps are offered on it, so a part the header does not speak for (the
 * shared fields waiting in another stage than the language) can still be
 * moved. A person who may assign it is offered to: to themselves, to a role it
 * waits for, or to no one.
 *
 * Reads the same review state the header does, under the same key, so the
 * two never disagree and the panel costs no request of its own. Draws nothing
 * where no workflow is attached.
 *
 * @module components/features/entries/review/ReviewSection
 * @experimental
 */

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { toast } from "@admin/components/ui";
import {
  useAssignPart,
  useReviewState,
} from "@admin/hooks/queries/useReviewState";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { useHasPermission } from "@admin/hooks/useHasPermission";
import { useLocalization } from "@admin/hooks/useLocalization";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type {
  PartReview,
  ReviewAssignee,
  ReviewStep,
} from "@admin/types/workflows";

import { leadingReviewStep } from "../EntryForm/document-actions";
import { PanelSection } from "../EntryForm/panels/PanelSection";

import { waitingForWords } from "./review-words";
import { StepRefusalNote } from "./StepRefusalNote";
import { useStepTaker, type StepTaker } from "./useStepTaker";

export interface ReviewSectionProps {
  document: ReleaseDocumentRef;
  /** The language being edited; the default language where none is named. */
  locale?: string | undefined;
}

export function ReviewSection({
  document,
  locale,
}: ReviewSectionProps): JSX.Element | null {
  const { data } = useReviewState(document);
  const { defaultLocale, getLocale } = useLocalization();
  const taker = useStepTaker(document);
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
  return (
    <PanelSection title="Review">
      <div className="space-y-4">
        {parts.map(part => (
          <PartBlock
            key={part.part ?? ""}
            document={document}
            part={part}
            taker={taker}
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
  title,
}: {
  document: ReleaseDocumentRef;
  part: PartReview;
  taker: StepTaker;
  title: string | null;
}): JSX.Element {
  const { formatDate } = useAdminDateFormatter();
  return (
    <div className="space-y-1.5 text-sm" data-review-part={part.part ?? ""}>
      {title === null ? null : (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <p className="font-medium text-foreground">
        {part.stage === null
          ? "Live, nothing waiting for review"
          : (part.stageLabel ?? part.stage)}
      </p>
      {part.stage === null ? null : (
        <>
          <p className="text-xs text-muted-foreground">
            {assignmentWords(part)}
          </p>
          {part.dueAt === null ? null : (
            <p className="text-xs text-muted-foreground">
              Due {formatDate(part.dueAt, { dateStyle: "medium" }, part.dueAt)}
            </p>
          )}
          <PartSteps part={part} taker={taker} />
          <AssignControls document={document} part={part} />
        </>
      )}
      <LastMove part={part} />
    </div>
  );
}

/** The steps this person may take on the part alone, primary first. */
function PartSteps({
  part,
  taker,
}: {
  part: PartReview;
  taker: StepTaker;
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
          disabled={taker.pending || part.version === null}
          onClick={() => take(step)}
        >
          {step.label}
        </Button>
      ))}
    </div>
  );
}

/** Who the part is assigned to, or that it is not and who it waits for. */
function assignmentWords(part: PartReview): string {
  const waiting = waitingForWords(part.waitingFor);
  if (part.assignee !== null) {
    return `Assigned to ${waiting ?? part.assignee.id}`;
  }
  return waiting === null
    ? "Not assigned"
    : `Not assigned, waiting for ${waiting}`;
}

/**
 * The ways to assign the part this person is offered. The server takes an
 * assignment from whoever may edit the document or take the stage's main
 * step, and only to someone who may take that step; a refusal is said where
 * it happens. The candidates are the ones the review state already names:
 * the person, and the roles the part waits for.
 */
function AssignControls({
  document,
  part,
}: {
  document: ReleaseDocumentRef;
  part: PartReview;
}): JSX.Element | null {
  const has = useHasPermission();
  const me = useCurrentUserId();
  const assign = useAssignPart(document);
  const leading = leadingReviewStep(part.steps);
  // Whoever may edit the document, or may take the stage's primary step as
  // the server judges it, may assign the part.
  const mayAssign =
    has(`update-${document.scopeSlug}`) || leading?.mayTake === true;
  if (!mayAssign || leading === undefined) return null;

  const to = (assignee: ReviewAssignee | null) => {
    assign.mutate(
      { part: part.part, revision: part.revision, assignee },
      {
        onError: reason =>
          toast.error(apiErrorMessage(reason, "The part wasn't assigned.")),
      }
    );
  };
  const assignedToMe =
    part.assignee?.kind === "user" && part.assignee.id === me;
  const roles =
    part.assignee === null && part.waitingFor?.kind === "roles"
      ? part.waitingFor.roles
      : [];
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {me === null || assignedToMe ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={assign.isPending}
          onClick={() => to({ kind: "user", id: me })}
        >
          Assign to me
        </Button>
      )}
      {roles.map(role => (
        <Button
          key={role.id}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={assign.isPending}
          onClick={() => to({ kind: "role", id: role.id })}
        >
          Assign to {role.name ?? "this role"}
        </Button>
      ))}
      {part.assignee === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={assign.isPending}
          onClick={() => to(null)}
        >
          Unassign
        </Button>
      )}
    </div>
  );
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
