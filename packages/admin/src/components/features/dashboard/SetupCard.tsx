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
 * - collapsed: one line, the frame's header alone, "Set up your project N of M done" with Expand
 *   and Dismiss beside the card's menu, the whole card one grid row tall (`frame/collapse`), kept
 *   per reader on the server;
 * - the steps: "N of M done" in the frame's header beside the title, and in the body a thin
 *   progress bar over one row of compact tiles, in two columns where the body is too narrow for
 *   each to read in full (`setupRowClass`). At the card's size,
 *   12 × 2, that is all the body holds (`setup/measures`), so the dashboard loads with nothing
 *   moving.
 *
 * Each tile is a step: its number or a tick, its name, and one hint line holding what the reader
 * can do about it ("Add", "2 of 5 · Open · Skip", "Invite · Skip"), its words short so a tile
 * reads in full at narrow widths, and read in full to assistive technology ("2 of 5 filled in").
 * Skip is offered on "Fill in your Singles" and "Invite a teammate" only, and Restore on a step
 * skipped. The Singles are one tile;
 * choosing it opens a short list of them, each with its state and link, and only then, the
 * reader's own action, does the card grow in place, as it does where the tiles wrap. Sample content
 * is the first tile, with its load and decline in its hint line, and is left out where the
 * project's sample-content route says it cannot be loaded by this reader.
 *
 * Collapse and Dismiss sit in the card's header, beside its menu, while the card is expanded
 * (`frame/header-slot`), so the tiles take the body's whole width; collapsed, at the end of its one
 * line. Dismissing removes the card and keeps that on the server for this reader.
 *
 * @module components/features/dashboard/SetupCard
 */

import { Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
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
  Fragment,
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
import { WIDGET_QUERIES_KEY } from "@admin/hooks/queries/widget-queries-key";
import { isApiError } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";

import { FrameState } from "../widgets/frame/card-state";
import { useCardCollapsed } from "../widgets/frame/collapse";
import { CardGrowContext } from "../widgets/frame/grow";
import { CardHeaderContent } from "../widgets/frame/header-slot";
import { cardBodyHeightPx } from "../widgets/frame/measures";
import { CardHeightContext } from "../widgets/frame/tier";
import { useCardTitleCount } from "../widgets/frame/title-count";

import {
  SETUP_GAP,
  SETUP_TILE,
  SETUP_TILE_LINES,
  setupRowClass,
} from "./setup/measures";
import { useRetirementRefusals } from "./setup/retirement-refusals";
import {
  filledIn,
  singleHref,
  stepPresentation,
  type StepPresentation,
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
 * failure. One the host refused, as it finds a step open (409), is never asked again over the same
 * steps: the dashboard's answers are read again in place (the batch's own query, so the card stays
 * drawn rather than being unmounted for a skeleton), and only an answer whose steps differ from the
 * refused one's (`retirementSignature`) is asked about once more, when every step it draws is
 * done. The refusal is kept outside the card (`setup/retirement-refusals`), so a card drawn again,
 * after a Retry or a write that refreshes it, remembers it: a refusal the host keeps giving over
 * the same steps is one request, however often the card is read or drawn.
 */
function useRetirement(
  due: boolean,
  sampleRefused: boolean,
  { retire, clearFailure }: Pick<SetupStateWrite, "retire" | "clearFailure">,
  answer: SetupCardData
): Retirement {
  const [retirement, setRetirement] = useState<Retirement>("unasked");
  const asked = useRef(false);
  const queryClient = useQueryClient();
  // What the last refused ask was about (`retirementSignature`), outliving this card.
  const refusals = useRetirementRefusals();
  const signature = retirementSignature(answer, sampleRefused);
  // An answer whose steps differ from the refused ones: it may be all done, finished on another
  // device before the read, or have a step open that is done later. The refusal is forgotten,
  // by whichever card is drawn over it (every new answer draws the card afresh), so these steps,
  // or the refused ones reached again later, are asked about once more; and a card that was
  // refused itself asks again. Compared by content, never by object: a refusal the host keeps
  // giving over the same steps (no preferences table, a write it cannot record) is asked once.
  // Its own effect, so a failed write, which also leaves the guard unasked, is not asked again at
  // once.
  useEffect(() => {
    const refused = refusals.refused();
    if (refused === undefined || refused === signature) return;
    refusals.forget();
    if (retirement !== "refused") return;
    asked.current = false;
    setRetirement("unasked");
  }, [signature, retirement, refusals]);
  useEffect(() => {
    if (!due || asked.current) return;
    asked.current = true;
    const askedAbout = signature;
    // Refused over these same steps already, by this card or one drawn before it: not asked.
    if (askedAbout === refusals.refused()) {
      setRetirement("refused");
      return;
    }
    setRetirement("asked");
    retire(
      { sampleRefused },
      {
        onDone: () => setRetirement("recorded"),
        onFailed: error => {
          if (isApiError(error) && error.status === 409) {
            refusals.refuse(askedAbout);
            // The card asked this itself, so nothing the reader changed failed: nothing is said.
            clearFailure();
            setRetirement("refused");
            // Read in place: the host's Retry would draw the skeleton and unmount the card.
            void queryClient.invalidateQueries({
              queryKey: WIDGET_QUERIES_KEY,
            });
            return;
          }
          asked.current = false;
          setRetirement("unasked");
        },
      }
    );
  }, [
    due,
    sampleRefused,
    retire,
    clearFailure,
    answer,
    signature,
    refusals,
    queryClient,
  ]);
  return retirement;
}

/**
 * What a retirement is judged over, as text: each step's kind and status, whether setup was known,
 * and what the project's sample-content route said. Two answers alike in these ask the host the
 * same question, whatever objects they arrive as.
 */
function retirementSignature(
  answer: SetupCardData,
  sampleRefused: boolean
): string {
  const steps = answer.setup.known
    ? answer.setup.steps.map(step => `${step.kind}:${step.status}`)
    : ["unknown"];
  return JSON.stringify([steps, sampleRefused]);
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
 * Collapse or expand, and dismiss: the card's two controls, in the frame's header beside the
 * card's menu whether it is expanded or collapsed, and drawn as the menu is: 28 px each, over the
 * 24 px a target may be at least.
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
  // Beside the card's menu in the header, the menu's own size and colour.
  const inHeader = "size-7 text-muted-foreground hover:text-foreground";
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className={inHeader}
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
        className={inHeader}
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
function stepLink(
  step: SetupStep,
  { label, href, action }: StepPresentation
): React.ReactNode {
  if (step.status !== "open" || href === undefined || action === undefined) {
    return null;
  }
  return (
    <Link
      href={href}
      className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary"
    >
      {action}
      <span className="sr-only">: {label}</span>
    </Link>
  );
}

/** Open or Hide on the Singles step's tile, for the short list under the row. */
function singlesToggle(
  step: SetupStep,
  label: string,
  { open, listId, onToggle }: SinglesListControl
): React.ReactNode {
  if (step.kind !== "singles") return null;
  return (
    <HintAction aria-expanded={open} aria-controls={listId} onClick={onToggle}>
      {open ? "Hide" : "Open"}
      <span className="sr-only">: {label}</span>
    </HintAction>
  );
}

/** Skip on an open step of a skippable kind, Restore on a skipped one, and nothing on any other. */
function skipToggle(
  step: SetupStep,
  label: string,
  write: SetupStateWrite
): React.ReactNode {
  if (!isSkippableKind(step.kind) || step.status === "done") return null;
  const { kind } = step;
  const skip = step.status === "open";
  return (
    <HintAction
      disabled={write.isWriting}
      onClick={() => write.setSkipped(kind, skip)}
    >
      {skip ? "Skip" : "Restore"}
      <span className="sr-only">: {label}</span>
    </HintAction>
  );
}

/** Whether the Singles' list is open, and what opens it, as the Singles tile's toggle needs. */
interface SinglesListControl {
  open: boolean;
  listId: string;
  onToggle: () => void;
}

/**
 * What the hint line says before its actions, drawn and read aloud: "Skipped" on a skipped step,
 * else the step's detail; nothing where its actions say it all ("Invite · Skip").
 */
function hintWords(
  step: SetupStep,
  { detail, spoken }: StepPresentation
): { shown: string; spoken: string } | undefined {
  if (step.status === "skipped") return { shown: "Skipped", spoken: "Skipped" };
  if (detail === undefined) return undefined;
  return { shown: detail, spoken: spoken ?? detail };
}

/**
 * What the hint line says before its actions: the sample offer while open, whole, as it is its
 * actions; else the step's words, the one part of the line cut short when the tile is narrow, and
 * read in full where they are drawn short ("2 of 5", read "2 of 5 filled in").
 */
function HintText({
  step,
  words,
  sample,
}: {
  step: SetupStep;
  words: { shown: string; spoken: string } | undefined;
  sample: React.ReactNode;
}) {
  if (step.kind === "sample" && step.status === "open") {
    return <span className="flex shrink-0 items-center">{sample}</span>;
  }
  if (words === undefined) return null;
  return (
    // Its whole words on hover, as a narrow tile may cut them short.
    <span className="min-w-0 truncate" title={words.spoken}>
      {words.shown === words.spoken ? (
        words.shown
      ) : (
        <>
          <span aria-hidden="true">{words.shown}</span>
          <span className="sr-only">{words.spoken}</span>
        </>
      )}
    </span>
  );
}

/**
 * A tile's actions, "·" between each, and before the first only where words come before it, so a
 * step whose actions say it all reads "Invite · Skip", never "· Invite · Skip".
 */
function HintActions({
  actions,
  afterWords,
}: {
  actions: readonly React.ReactNode[];
  afterWords: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center" data-setup-actions="">
      {actions.map((action, index) => (
        // The actions are fixed for a step, in a fixed order, so the position is their identity.
        <Fragment key={index}>
          {(index > 0 || afterWords) && <Dot />}
          {action}
        </Fragment>
      ))}
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
  singles,
  sample,
}: {
  step: SetupStep;
  position: number;
  write: SetupStateWrite;
  singles: SinglesListControl;
  sample: React.ReactNode;
}) {
  const presentation = stepPresentation(step);
  const { label } = presentation;
  const words = hintWords(step, presentation);
  const actions = [
    stepLink(step, presentation),
    singlesToggle(step, label, singles),
    skipToggle(step, label, write),
  ].filter(action => action !== null);
  // Words or the sample offer come before the actions; "·" then leads them.
  const afterWords =
    words !== undefined || (step.kind === "sample" && step.status === "open");
  return (
    <li
      data-setup-step={step.kind}
      data-status={step.status}
      className={cn(
        SETUP_TILE.className,
        "flex min-w-0 items-center gap-1 overflow-hidden rounded-md border border-border px-1.5 py-0.5",
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
          <HintText step={step} words={words} sample={sample} />
          <HintActions actions={actions} afterWords={afterWords} />
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
 * (`setupRowClass`). At rest in one row the steps fit 12 × 2 (`SETUP_ROW_BODY_PX`), so the card is
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
  write: Pick<SetupStateWrite, "retire" | "clearFailure">
): { allSet: boolean; counted: CountedSetup | undefined } {
  const drawn =
    card.setup.known && !card.allSet
      ? drawnSteps(card.setup.steps, seed, answeredHere)
      : undefined;
  const drawnAllSet = drawn !== undefined && setupAllSet(drawn);
  const retirement = useRetirement(
    drawnAllSet,
    seed.kind === "hidden",
    write,
    card
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

/**
 * The collapsed card: the frame's header is its one line, the title and "N of M done" beside it,
 * so the body draws only its controls, into that header beside the card's menu.
 */
function CollapsedSetup({
  failure,
  controls,
}: {
  failure: React.ReactNode;
  controls: React.ReactNode;
}) {
  return (
    <>
      {failure}
      <CardHeaderContent>{controls}</CardHeaderContent>
    </>
  );
}

/**
 * The expanded card: the bar, one row of tiles across the body's whole width, and the Singles'
 * list; its controls are drawn in the frame's header, beside the card's menu.
 */
function ExpandedSetup({
  content,
  counted,
  write,
  singles: singlesList,
  sample,
  failure,
  controls,
}: {
  content: React.RefObject<HTMLDivElement | null>;
  counted: CountedSetup;
  write: SetupStateWrite;
  singles: SinglesListControl;
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
      // The container the tiles' row is judged by: the body's own width, whatever the viewport.
      className={cn("@container grid", SETUP_GAP.className)}
      data-testid="setup-card"
    >
      <CardHeaderContent>{controls}</CardHeaderContent>
      <ProgressBar done={counted.done} total={counted.total} />
      {failure}
      {/* One row of tiles across the body's whole width where each reads in full there, two
          columns where the body is narrower (the body is the `@container` it is judged by). */}
      <ol
        className={cn(
          "grid min-w-0",
          setupRowClass(counted.steps.length),
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
            singles={singlesList}
            sample={sample}
          />
        ))}
      </ol>
      {singles !== undefined && singlesList.open && (
        <SinglesList step={singles} id={singlesList.listId} />
      )}
    </div>
  );
}

/**
 * Collapsed as the server says, then as the reader sets it here while the write lands and the
 * card's data is read again. Once the write has landed and that read has answered (`refreshing`
 * went on and off again), or an answer after it already holds what the reader set, the server's
 * answer is drawn again, whatever it says: a change another device made meanwhile wins over this
 * one, never masked by it. A write that fails puts back what was drawn before it, which is what
 * the server still holds, and the header says the change was not saved.
 */
function useCollapsedHere(
  stored: boolean,
  refreshing: boolean,
  write: SetupStateWrite
): { collapsed: boolean; toggle: () => void } {
  const [here, setHere] = useState<boolean | undefined>();
  // The reader's write has landed, and the card's data is being asked for again.
  const [landed, setLanded] = useState(false);
  // Whether that read has started since the write landed, so its end is the fresh answer.
  const readStarted = useRef(false);
  useEffect(() => {
    if (!landed) return;
    if (refreshing) {
      readStarted.current = true;
      return;
    }
    if (!readStarted.current && here !== stored) return;
    readStarted.current = false;
    setLanded(false);
    setHere(undefined);
  }, [landed, refreshing, here, stored]);
  const collapsed = here ?? stored;
  return {
    collapsed,
    toggle: () => {
      const before = here;
      readStarted.current = false;
      setLanded(false);
      setHere(!collapsed);
      write.setCollapsed(!collapsed, {
        onDone: () => setLanded(true),
        onFailed: () => setHere(before),
      });
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
  refreshing,
  retry,
}) => {
  const card = data as SetupCardData;
  const write = useSetupState(retry);
  const { status: seed, startSeed, skip } = useSeedStatus();
  const { collapsed, toggle } = useCollapsedHere(
    card.collapsed,
    refreshing,
    write
  );
  const [singlesOpen, setSinglesOpen] = useState(false);
  const sample = useSampleAnsweredHere(retry);
  const singlesListId = useId();
  const content = useRef<HTMLDivElement>(null);
  const { allSet, counted } = useDrawnSetup(
    card,
    seed,
    sample.answeredHere,
    write
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
    return <CollapsedSetup failure={failure} controls={controls} />;
  }
  return (
    <ExpandedSetup
      content={content}
      counted={counted}
      write={write}
      singles={{
        open: singlesOpen,
        listId: singlesListId,
        onToggle: () => setSinglesOpen(open => !open),
      }}
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
