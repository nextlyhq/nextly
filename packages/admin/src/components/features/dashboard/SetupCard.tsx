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
 * - collapsed: one line, "Set up your project · N of M done", with Expand and Dismiss, the whole
 *   card one grid row tall (`frame/collapse`), kept per reader on the server;
 * - the steps: "N of M done" in the frame's header beside the title, and in the body a thin
 *   progress bar over one row of compact tiles, two columns below 640 px. At the card's size,
 *   12 × 2, that is all the body holds (`setup/measures`), so the dashboard loads with nothing
 *   moving.
 *
 * Each tile is a step: its number or a tick, its name, and one hint line holding what the reader
 * can do about it ("Add", "2 of 5 filled in · Open · Skip"). Skip is offered on "Fill in your
 * Singles" and "Invite a teammate" only, and Restore on a step skipped. The Singles are one tile;
 * choosing it opens a short list of them, each with its state and link, and only then, the
 * reader's own action, does the card grow in place, as it does where the tiles wrap. Sample content
 * is the first tile, with its load and decline in its hint line, and is left out where the
 * project's sample-content route says it cannot be loaded by this reader.
 *
 * Collapse and Dismiss sit at the end of the tiles' row. Dismissing removes the card and keeps
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
import { useCardCollapsed } from "../widgets/frame/collapse";
import { CardGrowContext } from "../widgets/frame/grow";
import { cardBodyHeightPx } from "../widgets/frame/measures";
import { CardHeightContext } from "../widgets/frame/tier";
import { useCardTitleCount } from "../widgets/frame/title-count";

import { SETUP_GAP, SETUP_TILE, SETUP_TILE_LINES } from "./setup/measures";
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
 * declined it, and so does one this reader has just answered here (`answeredHere`), drawn done at
 * once while the card asks for its steps again. Counted again over what is drawn, so "N of M done"
 * counts the tiles shown.
 */
function drawnSteps(
  steps: readonly SetupStep[],
  seed: SeedStatus,
  answeredHere: boolean
): ReturnType<typeof talliedSetup> {
  return talliedSetup(
    steps.flatMap((step): SetupStep[] => {
      if (step.kind !== "sample" || step.status !== "open") return [step];
      if (answeredHere) return [{ kind: "sample", status: "done" }];
      return seed.kind === "hidden" ? [] : [step];
    })
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

/**
 * Collapse or expand, and dismiss: the card's two controls. At the end of the tiles' row when
 * expanded, 24 px each, the least a target may be; at the end of the one line when collapsed.
 */
function CardControls({
  collapsed,
  write,
  onToggle,
}: {
  collapsed: boolean;
  write: SetupStateWrite;
  onToggle: () => void;
}) {
  // The compact pair in the tiles' row: 24 px targets, inside the row's 36 px.
  const compact = !collapsed && "h-6 w-6";
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(compact)}
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
        size="icon-sm"
        className={cn(compact)}
        onClick={write.dismiss}
        disabled={write.isWriting}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dismiss setup</span>
      </Button>
    </span>
  );
}

/** A tile's action, as a word in its hint line: "Open", "Skip", "Load". */
function HintAction({
  children,
  onClick,
  disabled,
  ...aria
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary disabled:opacity-50"
      {...aria}
    >
      {children}
    </button>
  );
}

/** " · " between two parts of a hint, for the eye only. */
function Dot() {
  return <span aria-hidden="true"> · </span>;
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
  /** Runs once a load has succeeded. */
  onLoaded: () => void;
}) {
  // The steps as they are now once a run has finished: never an earlier answer. Asked once per
  // load that succeeds, however often the card is drawn while it shows that outcome.
  const loaded = seed.kind === "success";
  const told = useRef(false);
  useEffect(() => {
    if (!loaded) {
      told.current = false;
      return;
    }
    if (told.current) return;
    told.current = true;
    onLoaded();
  }, [loaded, onLoaded]);
  if (seed.kind === "loading") return <span>Checking…</span>;
  if (seed.kind === "seeding") {
    return <span role="status">Loading sample content…</span>;
  }
  if (seed.kind === "error") {
    return (
      <>
        <span role="alert" className="text-destructive" title={seed.message}>
          Couldn&apos;t load<span className="sr-only">: {seed.message}</span>
        </span>
        <Dot />
        <HintAction onClick={startSeed}>Retry</HintAction>
      </>
    );
  }
  if (seed.kind !== "idle") return null;
  return (
    <>
      <HintAction onClick={startSeed}>Load</HintAction>
      <Dot />
      <HintAction onClick={skip}>No thanks</HintAction>
    </>
  );
}

/**
 * One step's tile: its number or a tick, its name, and one hint line holding what the reader can
 * do about it, in a fixed height so the row is one tile high (`SETUP_TILE`).
 */
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
  const skippable = isSkippableKind(step.kind);
  const setSkipped = (skipped: boolean) => {
    if (isSkippableKind(step.kind)) write.setSkipped(step.kind, skipped);
  };
  return (
    <li
      data-setup-step={step.kind}
      data-status={step.status}
      className={cn(
        SETUP_TILE.className,
        "flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border px-2 py-0.5",
        step.status === "done" && "border-success/40 bg-success/5"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground",
          step.status === "done" && "border-success bg-success text-background"
        )}
      >
        {finished ? <Check className="h-2.5 w-2.5" /> : position}
      </span>
      <span className="grid min-w-0">
        <span
          className={cn(
            SETUP_TILE_LINES.label,
            "truncate font-semibold text-foreground"
          )}
        >
          {label}
          <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
        </span>
        <span
          className={cn(
            SETUP_TILE_LINES.hint,
            "truncate text-muted-foreground"
          )}
        >
          {step.kind === "sample" && open ? (
            sample
          ) : (
            <span>{step.status === "skipped" ? "Skipped" : detail}</span>
          )}
          {open && href !== undefined && action !== undefined && (
            <>
              <Dot />
              <Link
                href={href}
                className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary"
              >
                {action}
                <span className="sr-only">: {label}</span>
              </Link>
            </>
          )}
          {step.kind === "singles" && (
            <>
              <Dot />
              <HintAction
                aria-expanded={singlesOpen}
                aria-controls={singlesListId}
                onClick={onToggleSingles}
              >
                {singlesOpen ? "Hide" : "Open"}
                <span className="sr-only">: {label}</span>
              </HintAction>
            </>
          )}
          {open && skippable && (
            <>
              <Dot />
              <HintAction
                disabled={write.isWriting}
                onClick={() => setSkipped(true)}
              >
                Skip<span className="sr-only">: {label}</span>
              </HintAction>
            </>
          )}
          {step.status === "skipped" && skippable && (
            <>
              <Dot />
              <HintAction
                disabled={write.isWriting}
                onClick={() => setSkipped(false)}
              >
                Restore<span className="sr-only">: {label}</span>
              </HintAction>
            </>
          )}
        </span>
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
 * Asks the frame to grow the card only when its steps do not fit its rows: while the reader has
 * the Singles' list open, which is their own action, or where the tiles wrap into two columns
 * below 640 px. At rest in one row the steps fit 12 × 2 (`SETUP_ROW_BODY_PX`), so the card is
 * drawn at its own rows and nothing moves as the dashboard loads. Measured after every draw; drawn
 * at its own rows again once the list closes or the steps are not drawn.
 */
function useGrowToFit(
  drawn: boolean,
  singlesOpen: boolean,
  content: React.RefObject<HTMLDivElement | null>
): void {
  const report = useContext(CardGrowContext);
  const rows = useContext(CardHeightContext);
  useLayoutEffect(() => {
    if (report === undefined) return;
    const needed = drawn ? content.current?.offsetHeight : undefined;
    const holds = rows === undefined ? undefined : cardBodyHeightPx(rows);
    const overflows =
      needed !== undefined && holds !== undefined && needed > holds;
    report(drawn && (singlesOpen || overflows) ? needed : undefined);
  });
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
  // Sample content loaded or declined from this card: its tile is drawn done at once.
  const [sampleAnsweredHere, setSampleAnsweredHere] = useState(false);
  const singlesListId = useId();
  const content = useRef<HTMLDivElement>(null);
  // The steps drawn, when there are steps to draw: setup known, and not all set.
  const steps =
    card.setup.known && !card.allSet
      ? drawnSteps(card.setup.steps, seed, sampleAnsweredHere)
      : undefined;
  const counted = steps?.known ? steps : undefined;
  const progress =
    counted === undefined
      ? undefined
      : progressText(counted.done, counted.total);
  // "N of M done" in the frame's header, beside the title, so the body holds the bar and the
  // tiles alone; a change that could not be saved says so there instead, where it is seen.
  useCardTitleCount(write.failed ?? progress);
  useGrowToFit(!collapsed && counted !== undefined, singlesOpen, content);
  // One grid row while collapsed: the line below is then the whole card.
  useCardCollapsed(collapsed && counted !== undefined);

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
  if (counted === undefined || progress === undefined) return null;
  const toggleCollapsed = () => {
    setCollapsedHere(!collapsed);
    write.setCollapsed(!collapsed);
  };
  const singles = counted.steps.find(
    (step): step is Extract<SetupStep, { kind: "singles" }> =>
      step.kind === "singles"
  );
  const failure = write.failed !== undefined && (
    // Said once, to assistive technology; the header shows it.
    <p role="alert" className="sr-only">
      {write.failed}
    </p>
  );

  if (collapsed) {
    return (
      <div
        className="flex h-10 min-w-0 items-center gap-2"
        data-testid="setup-card"
      >
        {/* The frame keeps the title and its count for assistive technology, which reads them as
            the card's name; this is the same words, drawn. */}
        <p
          aria-hidden="true"
          className="min-w-0 flex-1 truncate text-sm"
          data-testid="setup-progress"
        >
          <span className="font-semibold text-foreground">
            Set up your project
          </span>
          <span className="text-muted-foreground"> · {progress}</span>
        </p>
        {failure}
        <CardControls
          collapsed={collapsed}
          write={write}
          onToggle={toggleCollapsed}
        />
      </div>
    );
  }

  return (
    <div
      ref={content}
      className={cn("grid", SETUP_GAP.className)}
      data-testid="setup-card"
    >
      <ProgressBar done={counted.done} total={counted.total} />
      {failure}
      <div className={cn("flex items-start", SETUP_GAP.className)}>
        {/* One row of tiles: one column per step from 640 px, two below. */}
        <ol
          className={cn(
            "grid min-w-0 flex-1 grid-cols-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none",
            SETUP_GAP.className
          )}
          aria-label="Setup steps"
        >
          {counted.steps.map((step, index) => (
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
                  skip={() => {
                    setSampleAnsweredHere(true);
                    skip(retry);
                  }}
                  onLoaded={() => {
                    setSampleAnsweredHere(true);
                    retry();
                  }}
                />
              }
            />
          ))}
        </ol>
        <span
          className={cn(SETUP_TILE.className, "flex shrink-0 items-center")}
        >
          <CardControls
            collapsed={collapsed}
            write={write}
            onToggle={toggleCollapsed}
          />
        </span>
      </div>
      {singles !== undefined && singlesOpen && (
        <SinglesList step={singles} id={singlesListId} />
      )}
    </div>
  );
};

SetupCard.displayName = "SetupCard";
