"use client";

/**
 * The Get started card: the setup steps this reader could still take, decided on the server.
 *
 * Its states, each from the layout read that decided the card is drawn:
 * - while the steps load, the frame's skeleton;
 * - when setup could not be checked, saying so with Retry, and never a step shown as waiting on
 *   that basis;
 * - the steps, with "x of y done" (a skipped step counts as done), each waiting step linking to
 *   where it is done, Skip on the steps a site can do without, and the first five Singles with
 *   a control for the rest;
 * - "You're all set" once every step is done or skipped, with the steps a click away.
 *
 * The frame draws the card's title, its one heading, and its Remove control, which records the
 * dismissal per reader and puts focus on Undo. Skips and "acted" are this card's own settings,
 * written through the dashboard's guarded single-card write.
 *
 * @module components/features/dashboard/GetStartedCard
 */

import { Button } from "@nextlyhq/ui";
import type { GetStartedAnswer, GetStartedStep } from "nextly/config";
import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";
import { useId, useMemo, useState } from "react";

import { Check, CheckCircle2 } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { useGetStarted } from "@admin/hooks/queries/useGetStarted";
import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { cn } from "@admin/lib/utils";

import { CardSkeleton } from "../widgets/frame/states";

import { isSkippable, stepPresentation } from "./get-started/step-presentation";
import {
  useGetStartedWrite,
  type GetStartedWrite,
} from "./get-started/useGetStartedWrite";

/** The Singles listed before the rest are folded behind a control. */
const SINGLES_SHOWN = 5;

/** The sidebar's own Singles request, so the card shares its answer for their labels. */
const SINGLES_PARAMS = {
  pagination: { page: 0, pageSize: 100 },
  sorting: [],
  filters: {},
};

function useSingleLabels(): ReadonlyMap<string, string> {
  const { data } = useSingles(SINGLES_PARAMS);
  return useMemo(
    () =>
      new Map((data?.items ?? []).map(single => [single.slug, single.label])),
    [data?.items]
  );
}

/** What a screen reader hears for each status, which the icon and styling only show. */
const STATUS_TEXT: Record<GetStartedStep["status"], string> = {
  done: "done",
  skipped: "skipped",
  open: "still to do",
  unknown: "could not be checked",
};

function SetupNotChecked({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="grid justify-items-start gap-2"
      data-testid="get-started-unknown"
    >
      <p className="text-sm font-semibold text-foreground">
        We couldn&apos;t check your setup.
      </p>
      <p className="text-sm text-muted-foreground">
        Some of what this card checks could not be read just now.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** The sample-content offer, inline in the first-entry step while it is open. */
function SampleContentOffer() {
  const { status, startSeed, skip } = useSeedStatus();
  if (status.kind === "seeding") {
    return (
      <span className="text-xs text-muted-foreground">
        Loading sample content…
      </span>
    );
  }
  if (status.kind !== "idle") return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={startSeed}>
        Load sample content
      </Button>
      <Button variant="ghost" size="sm" onClick={skip}>
        No thanks
      </Button>
    </span>
  );
}

/** A step's mark and label: done, skipped or still to do, and said aloud. */
function StepMark({ step, label }: { step: GetStartedStep; label: string }) {
  const finished = step.status === "done" || step.status === "skipped";
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border",
          finished && "bg-primary/10"
        )}
      >
        {step.status === "done" && (
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
        )}
        {step.status === "skipped" && (
          <Check className="h-3 w-3 text-muted-foreground" />
        )}
      </span>
      <span
        className={cn(
          "text-sm",
          finished ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {label}
        <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
      </span>
      {step.status === "unknown" && (
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          Couldn&apos;t check
        </span>
      )}
    </span>
  );
}

/**
 * What a reader can do about a step: start an open one (with the sample
 * content offer on the first entry), skip an open one of a skippable kind, or
 * restore a skipped one.
 */
function StepActions({
  step,
  label,
  href,
  write,
}: {
  step: GetStartedStep;
  label: string;
  href: string;
  write: GetStartedWrite;
}) {
  const blocked = write.unavailable !== undefined || write.isWriting;
  const open = step.status === "open";
  return (
    <span className="flex flex-wrap items-center gap-2">
      {open && (
        <Link
          href={href}
          onClick={write.markActed}
          className="text-xs font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary"
        >
          {step.kind === "single" ? "Open" : "Start"}
          <span className="sr-only">: {label}</span>
        </Link>
      )}
      {open && step.kind === "entry" && <SampleContentOffer />}
      {open && isSkippable(step) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked}
          title={write.unavailable}
          onClick={() => write.setSkipped(step.key, true)}
        >
          Skip<span className="sr-only">: {label}</span>
        </Button>
      )}
      {step.status === "skipped" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked}
          title={write.unavailable}
          onClick={() => write.setSkipped(step.key, false)}
        >
          Restore<span className="sr-only">: {label}</span>
        </Button>
      )}
    </span>
  );
}

function StepRow({
  step,
  singleLabels,
  write,
}: {
  step: GetStartedStep;
  singleLabels: ReadonlyMap<string, string>;
  write: GetStartedWrite;
}) {
  const { label, href } = stepPresentation(step, singleLabels);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <StepMark step={step} label={label} />
      <StepActions step={step} label={label} href={href} write={write} />
    </li>
  );
}

function StepList({
  answer,
  write,
}: {
  answer: GetStartedAnswer;
  write: GetStartedWrite;
}) {
  const singleLabels = useSingleLabels();
  const [allSingles, setAllSingles] = useState(false);
  const restId = useId();
  const singles = answer.steps.filter(step => step.kind === "single");
  const shownSingles = allSingles ? singles : singles.slice(0, SINGLES_SHOWN);
  const folded = singles.length - SINGLES_SHOWN;
  const row = (step: GetStartedStep) => (
    <StepRow
      key={step.key}
      step={step}
      singleLabels={singleLabels}
      write={write}
    />
  );
  return (
    <div className="grid gap-3">
      <div>
        {/* The bar is the picture; the line under it is the answer, announced once. */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{
              width: `${answer.total === 0 ? 0 : Math.round((answer.done / answer.total) * 100)}%`,
            }}
          />
        </div>
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="get-started-progress"
        >
          {answer.done} of {answer.total} done
        </p>
      </div>
      <ul className="grid divide-y divide-border">
        {answer.steps
          .filter(step => step.kind === "collection" || step.kind === "entry")
          .map(row)}
      </ul>
      {singles.length > 0 && (
        <ul id={restId} className="grid divide-y divide-border">
          {shownSingles.map(row)}
        </ul>
      )}
      {folded > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          aria-expanded={allSingles}
          aria-controls={restId}
          onClick={() => setAllSingles(open => !open)}
        >
          {allSingles ? "Show fewer Singles" : `Show ${folded} more`}
        </Button>
      )}
      <ul className="grid divide-y divide-border">
        {answer.steps.filter(step => step.kind === "invite").map(row)}
      </ul>
    </div>
  );
}

function AllSet({ onShowSteps }: { onShowSteps: () => void }) {
  return (
    <div
      className="grid justify-items-start gap-2"
      data-testid="get-started-all-set"
    >
      <p className="text-sm font-semibold text-foreground">
        You&apos;re all set.
      </p>
      <p className="text-sm text-muted-foreground">
        Every step is done or skipped. Remove this card when you no longer need
        it.
      </p>
      <Button variant="outline" size="sm" onClick={onShowSteps}>
        Show the steps
      </Button>
    </div>
  );
}

export const GetStartedCard: React.FC<WidgetComponentProps> = ({
  placementId,
}) => {
  const { answer, isPending, isUnavailable, retry, acted } =
    useGetStarted(placementId);
  const write = useGetStartedWrite(placementId, answer, acted);
  const [showSteps, setShowSteps] = useState(false);

  if (isPending) return <CardSkeleton shape="rows" rows={4} />;
  // Not known is its own answer: never drawn as steps waiting, nor as finished.
  if (isUnavailable || answer === undefined || answer.unknown) {
    return <SetupNotChecked onRetry={retry} />;
  }
  if (answer.done === answer.total && !showSteps) {
    return <AllSet onShowSteps={() => setShowSteps(true)} />;
  }
  return <StepList answer={answer} write={write} />;
};

GetStartedCard.displayName = "GetStartedCard";
