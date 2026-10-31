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
  drawnSetup,
  isSkippableKind,
  setupAllSet,
  stepFinished,
  talliedSetup,
  type SetupAnswer,
  type SetupCardData,
  type SetupSingle,
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
import { isApiError } from "@admin/lib/api/parseApiError";
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
 * The steps this card draws (`drawnSetup`, the host's own function for "You're all set"): the
 * server's, less sample content where the project's route says this reader cannot load it. A step
 * already answered stays, since someone on this site loaded or declined it, and so does one this
 * reader has answered here (`answeredHere`), drawn done once the route confirmed it, while the
 * card asks for its steps again. Counted over what is drawn, so "N of M done" counts the tiles
 * shown.
 */
function drawnSteps(
  steps: readonly SetupStep[],
  seed: SeedStatus,
  answeredHere: boolean
): SetupAnswer {
  const answered = steps.map(
    (step): SetupStep =>
      answeredHere && step.kind === "sample" && step.status === "open"
        ? { kind: "sample", status: "done" }
        : step
  );
  return drawnSetup(talliedSetup(answered), {
    sampleRefused: seed.kind === "hidden",
  });
}

/** Where the card's request to record "You're all set" stands. */
type Retirement = "unasked" | "asked" | "recorded" | "refused";

/**
 * Asks the host to record "You're all set" when the card finds every step it draws done but the
 * host, which cannot ask the project's sample-content route, did not: the host judges the steps
 * again with what the route said, through the same `drawnSetup`. The card says it is all set only
 * once the host has recorded it.
 *
 * Asked once per answer the card is drawn from (`answer`): a write that failed is asked again
 * when the card's data is next read, on the next load or refocus, never in a loop on its own
 * failure. One the host refused, as it finds a step open (409), is not asked again: the card's
 * data is read once more (`refresh`) to draw the steps as the host now has them.
 */
function useRetirement(
  due: boolean,
  sampleRefused: boolean,
  retire: SetupStateWrite["retire"],
  answer: SetupCardData,
  refresh: () => void
): Retirement {
  const [retirement, setRetirement] = useState<Retirement>("unasked");
  const asked = useRef(false);
  // The latest refresh, read when an answer lands, so a new one each draw never asks again.
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useEffect(() => {
    if (!due || asked.current) return;
    asked.current = true;
    setRetirement("asked");
    retire(
      { sampleRefused },
      {
        onDone: () => setRetirement("recorded"),
        onFailed: error => {
          if (isApiError(error) && error.status === 409) {
            setRetirement("refused");
            latestRefresh.current();
            return;
          }
          asked.current = false;
          setRetirement("unasked");
        },
      }
    );
  }, [due, sampleRefused, retire, answer]);
  return retirement;
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

/**
 * "·" between two parts of a hint, for the eye only. Spaced by padding, not by spaces: the hint
 * line lays its parts out as flex items, which drop a space at either end of their text.
 */
function Dot() {
  return (
    <span aria-hidden="true" className="px-1">
      ·
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
  if (seed.kind === "declining") return <span role="status">Saving…</span>;
  if (seed.kind === "error") {
    // Retry repeats what failed: a decline that could not be saved is asked again, not a load.
    const decline = seed.failed === "decline";
    return (
      <>
        <span role="alert" className="text-destructive" title={seed.message}>
          {decline ? "Couldn't save" : "Couldn't load"}
          <span className="sr-only">: {seed.message}</span>
        </span>
        <Dot />
        <HintAction onClick={decline ? skip : startSeed}>Retry</HintAction>
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

/** A tile's mark: a tick once its step is done or skipped, its number while it is open. */
function TileMark({ step, position }: { step: SetupStep; position: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground",
        step.status === "done" && "border-success bg-success text-background"
      )}
    >
      {stepFinished(step) ? <Check className="h-2.5 w-2.5" /> : position}
    </span>
  );
}

/** The step's own link, while it is open and has one. */
function StepLink({
  step,
  label,
  href,
  action,
}: {
  step: SetupStep;
  label: string;
  href: string | undefined;
  action: string | undefined;
}) {
  if (step.status !== "open" || href === undefined || action === undefined) {
    return null;
  }
  return (
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
  );
}

/** Open or Hide on the Singles step's tile, for the short list under the row. */
function SinglesToggle({
  step,
  label,
  open,
  listId,
  onToggle,
}: {
  step: SetupStep;
  label: string;
  open: boolean;
  listId: string;
  onToggle: () => void;
}) {
  if (step.kind !== "singles") return null;
  return (
    <>
      <Dot />
      <HintAction
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        {open ? "Hide" : "Open"}
        <span className="sr-only">: {label}</span>
      </HintAction>
    </>
  );
}

/** Skip on an open step of a skippable kind, Restore on a skipped one, and nothing on any other. */
function SkipToggle({
  step,
  label,
  write,
}: {
  step: SetupStep;
  label: string;
  write: SetupStateWrite;
}) {
  if (!isSkippableKind(step.kind) || step.status === "done") return null;
  const { kind } = step;
  const skip = step.status === "open";
  return (
    <>
      <Dot />
      <HintAction
        disabled={write.isWriting}
        onClick={() => write.setSkipped(kind, skip)}
      >
        {skip ? "Skip" : "Restore"}
        <span className="sr-only">: {label}</span>
      </HintAction>
    </>
  );
}

/**
 * What the hint line says before its actions: the sample offer while open, whole, as it is its
 * actions; else the step's state, the one part of the line cut short when the tile is narrow.
 */
function HintText({
  step,
  detail,
  sample,
}: {
  step: SetupStep;
  detail: string;
  sample: React.ReactNode;
}) {
  if (step.kind === "sample" && step.status === "open") {
    return <span className="flex shrink-0 items-center">{sample}</span>;
  }
  const text = step.status === "skipped" ? "Skipped" : detail;
  return (
    // Its whole text on hover, as a narrow tile may cut it short.
    <span className="min-w-0 truncate" title={text}>
      {text}
    </span>
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
  return (
    <li
      data-setup-step={step.kind}
      data-status={step.status}
      className={cn(
        SETUP_TILE.className,
        "flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border px-2 py-0.5",
        step.status === "done" && "border-success bg-success/5"
      )}
    >
      <TileMark step={step} position={position} />
      <span className="grid min-w-0">
        <span
          className={cn(
            SETUP_TILE_LINES.label,
            "truncate font-semibold text-foreground"
          )}
          // Its whole name on hover, as a narrow tile may cut it short.
          title={label}
        >
          {label}
          <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
        </span>
        {/* One line: only the detail is cut short, so its actions are never clipped. */}
        <span
          className={cn(
            SETUP_TILE_LINES.hint,
            "flex min-w-0 items-center whitespace-nowrap text-muted-foreground"
          )}
        >
          <HintText step={step} detail={detail} sample={sample} />
          <span className="flex shrink-0 items-center" data-setup-actions="">
            <StepLink step={step} label={label} href={href} action={action} />
            <SinglesToggle
              step={step}
              label={label}
              open={singlesOpen}
              listId={singlesListId}
              onToggle={onToggleSingles}
            />
            <SkipToggle step={step} label={label} write={write} />
          </span>
        </span>
      </span>
    </li>
  );
}

/** One Single in the list: its state, and the link that fills it in. */
function SingleRow({ single, label }: { single: SetupSingle; label: string }) {
  return (
    <li
      data-setup-single={single.slug}
      className="flex min-h-6 items-center justify-between gap-2"
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
      {/* A 24 px target, the least a pointer is given. */}
      <Link
        href={singleHref(single.slug)}
        className="inline-flex min-h-6 items-center font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary"
      >
        {single.filledIn ? "Edit" : "Fill in"}
        <span className="sr-only">: {label}</span>
      </Link>
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
      className="grid rounded-md border border-border px-2.5 py-1.5 text-xs"
    >
      {step.singles.map(single => (
        <SingleRow
          key={single.slug}
          single={single}
          label={labels.get(single.slug) ?? single.slug}
        />
      ))}
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
/**
 * The body height to ask the frame for, of steps drawn `needed` tall: all of it while the
 * Singles' list is open, or where it overflows the card's own rows; none otherwise.
 */
function heightToAsk(
  needed: number | undefined,
  rows: number | undefined,
  singlesOpen: boolean
): number | undefined {
  if (needed === undefined) return undefined;
  if (singlesOpen) return needed;
  const holds = rows === undefined ? undefined : cardBodyHeightPx(rows);
  return holds !== undefined && needed > holds ? needed : undefined;
}

function useGrowToFit(
  drawn: boolean,
  singlesOpen: boolean,
  content: React.RefObject<HTMLDivElement | null>
): void {
  const report = useContext(CardGrowContext);
  const rows = useContext(CardHeightContext);
  useLayoutEffect(() => {
    report?.(
      drawn
        ? heightToAsk(content.current?.offsetHeight, rows, singlesOpen)
        : undefined
    );
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

/** A known answer, as the card draws its tiles from. */
type CountedSetup = Extract<SetupAnswer, { known: true }>;

/**
 * Whether the card is all set, and the steps it draws as tiles while it is not. All set when the
 * host found it so, or when every step the card draws is done though the host could not tell
 * (`drawnSetup`) and the host has since recorded it (`useRetirement`); until then the tiles are
 * drawn, every one done.
 */
function useDrawnSetup(
  card: SetupCardData,
  seed: SeedStatus,
  answeredHere: boolean,
  write: Pick<SetupStateWrite, "retire">,
  refresh: () => void
): { allSet: boolean; counted: CountedSetup | undefined } {
  const drawn =
    card.setup.known && !card.allSet
      ? drawnSteps(card.setup.steps, seed, answeredHere)
      : undefined;
  const drawnAllSet = drawn !== undefined && setupAllSet(drawn);
  const retirement = useRetirement(
    drawnAllSet,
    seed.kind === "hidden",
    write.retire,
    card,
    refresh
  );
  const allSet = card.allSet || (drawnAllSet && retirement === "recorded");
  return { allSet, counted: drawn?.known && !allSet ? drawn : undefined };
}

/** A change that could not be saved, said once to assistive technology: the header shows it. */
function SaveFailure({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="sr-only">
      {message}
    </p>
  );
}

/** The collapsed card: one line, "Set up your project · N of M done", and its controls. */
function CollapsedSetup({
  progress,
  failure,
  controls,
}: {
  progress: string;
  failure: React.ReactNode;
  controls: React.ReactNode;
}) {
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
      {controls}
    </div>
  );
}

/** The expanded card: the bar, one row of tiles beside its controls, and the Singles' list. */
function ExpandedSetup({
  content,
  counted,
  write,
  singlesOpen,
  onToggleSingles,
  singlesListId,
  sample,
  failure,
  controls,
}: {
  content: React.RefObject<HTMLDivElement | null>;
  counted: CountedSetup;
  write: SetupStateWrite;
  singlesOpen: boolean;
  onToggleSingles: () => void;
  singlesListId: string;
  sample: React.ReactNode;
  failure: React.ReactNode;
  controls: React.ReactNode;
}) {
  const singles = counted.steps.find(
    (step): step is Extract<SetupStep, { kind: "singles" }> =>
      step.kind === "singles"
  );
  return (
    <div
      ref={content}
      className={cn("grid", SETUP_GAP.className)}
      data-testid="setup-card"
    >
      <ProgressBar done={counted.done} total={counted.total} />
      {failure}
      {/* Below 640 px the controls sit over the tiles, so the tiles' two columns take the card's
          whole width; from 640 px they end the tiles' one row. */}
      <div
        className={cn(
          "flex flex-col-reverse items-end sm:flex-row sm:items-start",
          SETUP_GAP.className
        )}
      >
        {/* One row of tiles: one column per step from 640 px, two below. */}
        <ol
          className={cn(
            "grid min-w-0 flex-1 grid-cols-2 self-stretch sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:self-auto",
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
              onToggleSingles={onToggleSingles}
              singlesListId={singlesListId}
              sample={sample}
            />
          ))}
        </ol>
        <span
          // A tile high from 640 px (`SETUP_TILE`, 36 px), written out whole so the stylesheet
          // keeps the class; one compact button high below.
          className="flex h-6 shrink-0 items-center sm:h-9"
        >
          {controls}
        </span>
      </div>
      {singles !== undefined && singlesOpen && (
        <SinglesList step={singles} id={singlesListId} />
      )}
    </div>
  );
}

/**
 * Collapsed as the server says, then as the reader sets it here while the write lands. A write
 * that fails puts back what was drawn before it, which is what the server still holds, and the
 * header says the change was not saved.
 */
function useCollapsedHere(
  stored: boolean,
  write: SetupStateWrite
): { collapsed: boolean; toggle: () => void } {
  const [here, setHere] = useState<boolean | undefined>();
  const collapsed = here ?? stored;
  return {
    collapsed,
    toggle: () => {
      const before = here;
      setHere(!collapsed);
      write.setCollapsed(!collapsed, () => setHere(before));
    },
  };
}

/**
 * Sample content loaded or declined from this card, once the route confirmed it: its tile is
 * drawn done, and the card asks for its steps again.
 */
function useSampleAnsweredHere(retry: () => void): {
  answeredHere: boolean;
  answered: () => void;
} {
  const [answeredHere, setAnsweredHere] = useState(false);
  return {
    answeredHere,
    answered: () => {
      setAnsweredHere(true);
      retry();
    },
  };
}

/**
 * The card in its frame: "N of M done" in the header beside the title, so the body holds the bar
 * and the tiles alone (a change that could not be saved says so there instead, where it is seen);
 * grown only when its steps do not fit; and one grid row while collapsed, whose line is then the
 * whole card. Answers the count's words while steps are drawn.
 */
function useSetupInFrame(
  counted: CountedSetup | undefined,
  collapsed: boolean,
  failed: string | undefined,
  singlesOpen: boolean,
  content: React.RefObject<HTMLDivElement | null>
): string | undefined {
  const progress =
    counted === undefined
      ? undefined
      : progressText(counted.done, counted.total);
  const drawn = progress !== undefined;
  useCardTitleCount(failed ?? progress);
  useGrowToFit(drawn && !collapsed, singlesOpen, content);
  useCardCollapsed(drawn && collapsed);
  return progress;
}

/** Not known is its own answer: never drawn as steps waiting, nor as finished. */
function NotKnown({ retry }: { retry: () => void }) {
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

export const SetupCard: React.FC<DeclaredComponentProps> = ({
  data,
  retry,
}) => {
  const card = data as SetupCardData;
  const write = useSetupState(retry);
  const { status: seed, startSeed, skip } = useSeedStatus();
  const { collapsed, toggle } = useCollapsedHere(card.collapsed, write);
  const [singlesOpen, setSinglesOpen] = useState(false);
  const sample = useSampleAnsweredHere(retry);
  const singlesListId = useId();
  const content = useRef<HTMLDivElement>(null);
  const { allSet, counted } = useDrawnSetup(
    card,
    seed,
    sample.answeredHere,
    write,
    retry
  );
  const progress = useSetupInFrame(
    counted,
    collapsed,
    write.failed,
    singlesOpen,
    content
  );

  if (!card.setup.known) return <NotKnown retry={retry} />;
  if (allSet) return <AllSet write={write} />;
  if (counted === undefined || progress === undefined) return null;
  const controls = (
    <CardControls collapsed={collapsed} write={write} onToggle={toggle} />
  );
  const failure = <SaveFailure message={write.failed} />;
  if (collapsed) {
    return (
      <CollapsedSetup
        progress={progress}
        failure={failure}
        controls={controls}
      />
    );
  }
  return (
    <ExpandedSetup
      content={content}
      counted={counted}
      write={write}
      singlesOpen={singlesOpen}
      onToggleSingles={() => setSinglesOpen(open => !open)}
      singlesListId={singlesListId}
      failure={failure}
      controls={controls}
      sample={
        <SampleContent
          seed={seed}
          startSeed={startSeed}
          skip={() => skip(sample.answered)}
          onLoaded={sample.answered}
        />
      }
    />
  );
};

SetupCard.displayName = "SetupCard";
