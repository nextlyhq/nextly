"use client";

/**
 * "Set up your project": the setup steps left on a new project, as one row of tiles, for a
 * super-admin.
 *
 * A declared widget's view (`core/setup`): the frame draws the title, loading and a failed load,
 * and this draws what `load` answered, in one of four states:
 * - setup could not be checked: says so with Retry, and never a step shown open on that basis;
 * - every step done: "You're all set", said once (the server has recorded it, so the next load
 *   leaves the card out);
 * - collapsed: one line, "N of M done", with Expand, kept per reader on the server;
 * - the steps: "N of M done" and a progress bar over one row of tiles, two columns below 640 px.
 *
 * Each tile is a step: its number or a tick, its name, one line of detail, and what the reader can
 * do about it. Skip is offered on "Fill in your Singles" and "Invite a teammate" only, and Restore
 * on a step skipped. The Singles are one tile, "N of M filled in"; choosing it opens a short list
 * of them, each with its state and link, and the card grows in place to hold it. Sample content is
 * the first tile, with its load and decline drawn inside it, and is left out where the project's
 * sample-content route says it cannot be loaded by this reader.
 *
 * Collapse and Dismiss sit at the end of the progress line. Dismissing removes the card and keeps
 * that on the server for this reader.
 *
 * @module components/features/dashboard/SetupCard
 */

import { Button } from "@nextlyhq/ui";
import {
  isSkippableKind,
  talliedSetup,
  type SetupCardData,
  type SetupStep,
} from "nextly/config";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Check, ChevronDown, ChevronUp, X } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import {
  useSeedStatus,
  type SeedStatus,
} from "@admin/hooks/queries/useSeedStatus";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { cn } from "@admin/lib/utils";

import { FrameState } from "../widgets/frame/card-state";
import { CardGrowContext } from "../widgets/frame/grow";

import {
  filledIn,
  singleHref,
  stepPresentation,
} from "./setup/step-presentation";
import { useSetupState, type SetupStateWrite } from "./setup/useSetupState";

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

/** What a screen reader hears for each status, which the tick and styling only show. */
const STATUS_TEXT: Record<SetupStep["status"], string> = {
  done: "done",
  skipped: "skipped",
  open: "still to do",
};

/**
 * The steps this card draws: the server's, less sample content where the project's route says
 * this reader cannot load it. A step already answered stays, since someone on this site loaded or
 * declined it. Counted again over what is drawn, so "N of M done" counts the tiles shown.
 */
function drawnSteps(
  steps: readonly SetupStep[],
  seed: SeedStatus
): ReturnType<typeof talliedSetup> {
  return talliedSetup(
    steps.filter(
      step =>
        step.kind !== "sample" ||
        step.status !== "open" ||
        seed.kind !== "hidden"
    )
  );
}

/** "N of M done", from a counted answer. */
function progressText(done: number, total: number): string {
  return `${done} of ${total} done`;
}

/** The bar is the picture; the text beside it is the answer, read once. */
function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-success"
        style={{
          width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%`,
        }}
      />
    </div>
  );
}

/** Collapse or expand, and dismiss: the card's two controls, at the end of its first line. */
function CardControls({
  collapsed,
  write,
  onToggle,
}: {
  collapsed: boolean;
  write: SetupStateWrite;
  onToggle: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={!collapsed}
        onClick={onToggle}
        disabled={write.isWriting}
      >
        {collapsed ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="sr-only">
          {collapsed ? "Expand setup" : "Collapse setup"}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={write.dismiss}
        disabled={write.isWriting}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dismiss setup</span>
      </Button>
    </span>
  );
}

/**
 * Sample content inside its tile: load it or decline it, then its run and its outcome. A failed
 * load says what failed, with Retry, rather than taking the controls away.
 */
function SampleContent({
  seed,
  startSeed,
  skip,
  onLoaded,
}: {
  seed: SeedStatus;
  startSeed: () => void;
  skip: () => void;
  onLoaded: () => void;
}) {
  // The steps as they are now once a run has finished: never an earlier answer.
  const loaded = seed.kind === "success";
  useEffect(() => {
    if (loaded) onLoaded();
  }, [loaded, onLoaded]);
  if (seed.kind === "loading") {
    return <span className="text-xs text-muted-foreground">Checking…</span>;
  }
  if (seed.kind === "seeding") {
    return (
      <span role="status" className="text-xs text-muted-foreground">
        Loading sample content…
      </span>
    );
  }
  if (seed.kind === "error") {
    return (
      <span className="grid gap-1">
        <span role="alert" className="text-xs text-destructive">
          Sample content couldn&apos;t be loaded: {seed.message}
        </span>
        <Button variant="outline" size="sm" onClick={startSeed}>
          Retry
        </Button>
      </span>
    );
  }
  if (seed.kind !== "idle") return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={startSeed}>
        Load
      </Button>
      <Button variant="ghost" size="sm" onClick={skip}>
        No thanks
      </Button>
    </span>
  );
}

/** One step's tile. */
function StepTile({
  step,
  position,
  write,
  singlesOpen,
  onToggleSingles,
  singlesListId,
  sample,
}: {
  step: SetupStep;
  position: number;
  write: SetupStateWrite;
  singlesOpen: boolean;
  onToggleSingles: () => void;
  singlesListId: string;
  sample: React.ReactNode;
}) {
  const { label, detail, href, action } = stepPresentation(step);
  const finished = step.status === "done" || step.status === "skipped";
  const open = step.status === "open";
  return (
    <li
      data-setup-step={step.kind}
      data-status={step.status}
      className={cn(
        "grid content-start gap-1 rounded-md border border-border p-2.5 text-xs",
        step.status === "done" && "border-success/40 bg-success/5"
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground",
            step.status === "done" &&
              "border-success bg-success text-background"
          )}
        >
          {finished ? <Check className="h-3 w-3" /> : position}
        </span>
        <span className="font-semibold text-foreground">
          {label}
          <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
        </span>
      </span>
      <span className="text-muted-foreground">{detail}</span>
      <span className="flex flex-wrap items-center gap-2">
        {step.kind === "sample" && open && sample}
        {open && href !== undefined && action !== undefined && (
          <Link
            href={href}
            className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary"
          >
            {action}
            <span className="sr-only">: {label}</span>
          </Link>
        )}
        {step.kind === "singles" && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={singlesOpen}
            aria-controls={singlesListId}
            onClick={onToggleSingles}
          >
            {singlesOpen ? "Hide" : "Open"}
            <span className="sr-only">: {label}</span>
          </Button>
        )}
        {open && isSkippableKind(step.kind) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={write.isWriting}
            onClick={() => {
              if (isSkippableKind(step.kind)) write.setSkipped(step.kind, true);
            }}
          >
            Skip<span className="sr-only">: {label}</span>
          </Button>
        )}
        {step.status === "skipped" && isSkippableKind(step.kind) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={write.isWriting}
            onClick={() => {
              if (isSkippableKind(step.kind))
                write.setSkipped(step.kind, false);
            }}
          >
            Restore<span className="sr-only">: {label}</span>
          </Button>
        )}
      </span>
    </li>
  );
}

/** The Singles, each with its state and the link that fills it in. */
function SinglesList({
  step,
  id,
}: {
  step: Extract<SetupStep, { kind: "singles" }>;
  id: string;
}) {
  const labels = useSingleLabels();
  const { done, total } = filledIn(step);
  return (
    <ul
      id={id}
      aria-label={`Your Singles, ${done} of ${total} filled in`}
      className="grid gap-1 rounded-md border border-border p-2.5 text-xs"
    >
      {step.singles.map(single => {
        const label = labels.get(single.slug) ?? single.slug;
        return (
          <li
            key={single.slug}
            data-setup-single={single.slug}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              {single.filledIn ? (
                <Check className="h-3 w-3 text-success" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border border-border"
                />
              )}
              <span className="text-foreground">{label}</span>
              <span className="text-muted-foreground">
                {single.filledIn ? "Filled in" : "Not filled in yet"}
              </span>
            </span>
            <Link
              href={singleHref(single.slug)}
              className="font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary"
            >
              {single.filledIn ? "Edit" : "Fill in"}
              <span className="sr-only">: {label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Asks the frame to grow the card while the Singles' list is open, so no row is cut by the
 * card's edge, and to draw it at its own rows again once the list closes.
 */
function useGrowWhile(
  open: boolean,
  content: React.RefObject<HTMLDivElement | null>
): void {
  const report = useContext(CardGrowContext);
  useLayoutEffect(() => {
    if (report === undefined) return;
    report(open ? content.current?.offsetHeight : undefined);
  }, [open, report, content]);
  useEffect(() => () => report?.(undefined), [report]);
}

function AllSet({ write }: { write: SetupStateWrite }) {
  return (
    <div
      className="flex items-start justify-between gap-3"
      data-testid="setup-all-set"
    >
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">
          You&apos;re all set.
        </p>
        <p className="text-sm text-muted-foreground">
          Every step is done. This card won&apos;t show again.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={write.dismiss}
        disabled={write.isWriting}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dismiss setup</span>
      </Button>
    </div>
  );
}

export const SetupCard: React.FC<DeclaredComponentProps> = ({
  data,
  retry,
}) => {
  const card = data as SetupCardData;
  const write = useSetupState(retry);
  const { status: seed, startSeed, skip } = useSeedStatus();
  // Collapsed as the server says, then as the reader sets it here while the write lands.
  const [collapsedHere, setCollapsedHere] = useState<boolean | undefined>();
  const collapsed = collapsedHere ?? card.collapsed;
  const [singlesOpen, setSinglesOpen] = useState(false);
  const singlesListId = useId();
  const content = useRef<HTMLDivElement>(null);
  useGrowWhile(singlesOpen && !collapsed, content);

  if (!card.setup.known) {
    // Not known is its own answer: never drawn as steps waiting, nor as finished.
    return (
      <FrameState
        state={{
          kind: "error",
          message: "We couldn't check your setup just now.",
          retry,
        }}
      />
    );
  }
  if (card.allSet) return <AllSet write={write} />;

  const steps = drawnSteps(card.setup.steps, seed);
  if (!steps.known) return null;
  const toggleCollapsed = () => {
    setCollapsedHere(!collapsed);
    write.setCollapsed(!collapsed);
  };
  const progress = progressText(steps.done, steps.total);
  const singles = steps.steps.find(
    (step): step is Extract<SetupStep, { kind: "singles" }> =>
      step.kind === "singles"
  );

  return (
    <div ref={content} className="grid gap-2" data-testid="setup-card">
      <div className="flex items-center gap-3">
        <p
          className="shrink-0 text-xs text-muted-foreground"
          data-testid="setup-progress"
        >
          {progress}
        </p>
        <div className="min-w-0 flex-1">
          <ProgressBar done={steps.done} total={steps.total} />
        </div>
        <CardControls
          collapsed={collapsed}
          write={write}
          onToggle={toggleCollapsed}
        />
      </div>
      {write.failed !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {write.failed}
        </p>
      )}
      {!collapsed && (
        <>
          {/* One row of tiles: one column per step from 640 px, two below. */}
          <ol
            className="grid grid-cols-2 gap-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none"
            aria-label="Setup steps"
          >
            {steps.steps.map((step, index) => (
              <StepTile
                key={step.kind}
                step={step}
                position={index + 1}
                write={write}
                singlesOpen={singlesOpen}
                onToggleSingles={() => setSinglesOpen(open => !open)}
                singlesListId={singlesListId}
                sample={
                  <SampleContent
                    seed={seed}
                    startSeed={startSeed}
                    skip={skip}
                    onLoaded={retry}
                  />
                }
              />
            ))}
          </ol>
          {singles !== undefined && singlesOpen && (
            <SinglesList step={singles} id={singlesListId} />
          )}
        </>
      )}
    </div>
  );
};

SetupCard.displayName = "SetupCard";
