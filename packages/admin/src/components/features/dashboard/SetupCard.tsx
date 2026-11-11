"use client";

/**
 * "Set up your project": the setup steps left on a new project, as a vertical checklist, for a
 * super-admin.
 *
 * A declared widget's view (`core/setup`): the frame draws the title, loading and a failed load,
 * and this draws what `load` answered, in one of three states:
 * - setup could not be checked: says so with Retry, and never a step shown open on that basis;
 * - every step done: "You're all set", said once (the server has recorded it, so the next load
 *   leaves the card out), with Hide setup;
 * - the steps: "N of M done" in the frame's header beside the title, and in the body a thin
 *   progress bar over one line per step.
 *
 * Each line is a step: a tick once it is done, a dashed circle once it is skipped and an empty one
 * while it is open; its name and one hint line; and its buttons on the right, which drop under the
 * hint where the card is too narrow for both, so the card never scrolls sideways at any width.
 * Skip is offered on "Fill in your Singles" and "Invite a teammate" only, and Restore on a step
 * skipped. Show on the Singles' line lists them inside that line, each with its state and a
 * "Fill in" button. Sample content is the first line while it is open, with its load and decline
 * as its buttons and a load's progress and outcome in full under the steps
 * (`setup/SampleContentStep`); once anyone on the site has answered it the line goes, and it is
 * left out where the project's sample-content route says this reader cannot load it.
 *
 * The card's own hiding is the frame's: its menu offers Hide setup in place of Remove.
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
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Check } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { WIDGET_QUERIES_KEY } from "@admin/hooks/queries/widget-queries-key";
import { isApiError } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";

import { FrameState } from "../widgets/frame/card-state";
import { useCardTitleCount } from "../widgets/frame/title-count";

import { useRetirementRefusals } from "./setup/retirement-refusals";
import {
  SampleContentActions,
  SampleContentPanel,
  sampleHint,
} from "./setup/SampleContentStep";
import { STEP_BUTTON, STEP_GHOST_BUTTON } from "./setup/step-buttons";
import {
  filledIn,
  singleHref,
  stepPresentation,
  type StepPresentation,
} from "./setup/step-presentation";
import { useSampleRun, type SampleRunState } from "./setup/useSampleRun";
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

/** What a screen reader hears for each status, which the mark and styling only show. */
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
 * card asks for its steps again. Counted over what is drawn.
 */
function drawnSteps(
  steps: readonly SetupStep[],
  sampleRefused: boolean,
  answeredHere: boolean
): SetupAnswer {
  const answered = steps.map(
    (step): SetupStep =>
      answeredHere && step.kind === "sample" && step.status === "open"
        ? { kind: "sample", status: "done" }
        : step
  );
  return drawnSetup(talliedSetup(answered), { sampleRefused });
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
  answer: SetupCardData,
  /**
   * Whether the project's sample-content route has answered: until it has, what the card draws
   * is not yet the question, so nothing is asked and no remembered refusal is forgotten over it.
   */
  settled: boolean
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
    if (!settled) return;
    const refused = refusals.refused();
    if (refused === undefined || refused === signature) return;
    refusals.forget();
    if (retirement !== "refused") return;
    asked.current = false;
    setRetirement("unasked");
  }, [settled, signature, retirement, refusals]);
  useEffect(() => {
    if (!settled || !due || asked.current) return;
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
    settled,
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

/** The bar is the picture; the header's "N of M done" is the answer, read once. */
function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div
      className="mt-0.5 mb-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary"
      aria-hidden="true"
      data-setup-progress=""
    >
      <div
        className="h-full rounded-full bg-success-solid transition-[width] duration-300 motion-reduce:transition-none"
        style={{
          width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%`,
        }}
      />
    </div>
  );
}

/**
 * A step's mark, in its own shape: a tick on the success colour once it is done, a dashed circle
 * once it is skipped, and an empty circle while it is open.
 */
function StepMark({ status }: { status: SetupStep["status"] }) {
  return (
    <span
      aria-hidden="true"
      data-setup-mark={status}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-control-border",
        status === "done" &&
          "border-success-solid bg-success-solid text-success-foreground",
        status === "skipped" && "border-dashed"
      )}
    >
      {status === "done" && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** Whether the Singles' list is open, and what opens it, as the Singles' line needs. */
interface SinglesListControl {
  open: boolean;
  listId: string;
  onToggle: () => void;
}

/** The hint under a step's name: Done or Skipped once it is, else what it asks or how far it is. */
function hintOf(
  step: SetupStep,
  { detail }: StepPresentation,
  sample: SampleRunState
): { words: string; failed: boolean } {
  if (step.status === "done") return { words: "Done", failed: false };
  if (step.status === "skipped") return { words: "Skipped", failed: false };
  if (step.kind === "sample") {
    return sampleHint(sample.view) ?? { words: detail, failed: false };
  }
  return { words: detail, failed: false };
}

/**
 * A step's own button while it is open: its link, the Singles' Show or Hide, or the sample load.
 * Each is named with its step ("Show: Fill in your Singles"), its visible word first, so a list of
 * the page's controls says which step each belongs to.
 */
function OwnAction({
  step,
  presentation: { label, href, action },
  singles,
  sample,
}: {
  step: SetupStep;
  presentation: StepPresentation;
  singles: SinglesListControl;
  sample: SampleRunState;
}): React.ReactNode {
  if (step.status !== "open") return null;
  if (step.kind === "sample") return <SampleContentActions sample={sample} />;
  if (step.kind === "singles") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={STEP_BUTTON}
        aria-expanded={singles.open}
        aria-controls={singles.listId}
        onClick={singles.onToggle}
        aria-label={`${singles.open ? "Hide" : "Show"}: ${label}`}
      >
        {singles.open ? "Hide" : "Show"}
      </Button>
    );
  }
  if (href === undefined || action === undefined) return null;
  return (
    <Button asChild variant="outline" size="sm" className={STEP_BUTTON}>
      <Link href={href} aria-label={`${action}: ${label}`}>
        {action}
      </Link>
    </Button>
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
}): React.ReactNode {
  const { kind } = step;
  if (!isSkippableKind(kind) || step.status === "done") return null;
  const skip = step.status === "open";
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={STEP_GHOST_BUTTON}
      disabled={write.isWriting}
      onClick={() => write.setSkipped(kind, skip)}
      aria-label={`${skip ? "Skip" : "Restore"}: ${label}`}
    >
      {skip ? "Skip" : "Restore"}
    </Button>
  );
}

/** One Single in the list: its state, and the button that fills it in while it is not. */
function SingleRow({ single, label }: { single: SetupSingle; label: string }) {
  return (
    <li
      data-setup-single={single.slug}
      className="flex min-h-10 items-center gap-2 border-t border-border px-2.5 py-1.5 first:border-t-0"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          single.filledIn ? "bg-success-solid" : "bg-control-border"
        )}
      />
      {/* Cut short where the line is too narrow, its whole name on hover. */}
      <span className="min-w-0 flex-1 truncate text-foreground" title={label}>
        {label}
      </span>
      {single.filledIn ? (
        <span className="text-muted-foreground">Filled in</span>
      ) : (
        <>
          <span className="sr-only">Not filled in yet</span>
          <Button asChild variant="outline" size="sm" className={STEP_BUTTON}>
            <Link
              href={singleHref(single.slug)}
              aria-label={`Fill in: ${label}`}
            >
              Fill in
            </Link>
          </Button>
        </>
      )}
    </li>
  );
}

/** The Singles, each with its state and the button that fills it in, inside their step's line. */
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
      // One column no wider than the line: a long name is cut short, never widening the list.
      className="mt-2 grid grid-cols-[minmax(0,1fr)] rounded-lg border border-border text-[12.5px]"
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
 * One step's line: its mark, its name and hint, the Singles' list where it is open, and its
 * buttons on the right. Where the card is too narrow for the name and the buttons side by side
 * the buttons wrap under them, still on the right, so the line never scrolls sideways.
 */
function StepLine({
  step,
  write,
  singles,
  sample,
}: {
  step: SetupStep;
  write: SetupStateWrite;
  singles: SinglesListControl;
  sample: SampleRunState;
}) {
  const presentation = stepPresentation(step);
  const { label } = presentation;
  const hint = hintOf(step, presentation, sample);
  const finished = stepFinished(step);
  const own = (
    <OwnAction
      step={step}
      presentation={presentation}
      singles={singles}
      sample={sample}
    />
  );
  const skip = <SkipToggle step={step} label={label} write={write} />;
  return (
    <li
      data-setup-step={step.kind}
      data-status={step.status}
      className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border py-2.5 first:border-t-0"
    >
      <StepMark status={step.status} />
      <div className="min-w-36 flex-1">
        <p
          className={cn(
            "text-[13.5px] leading-5 break-words",
            finished ? "text-muted-foreground" : "font-medium text-foreground"
          )}
        >
          {label}
          <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
        </p>
        <p
          className={cn(
            "text-[12.5px] leading-[18px] text-muted-foreground",
            hint.failed && "text-danger-text"
          )}
          data-setup-hint=""
        >
          {hint.words}
        </p>
        {step.kind === "singles" && step.status === "open" && singles.open && (
          <SinglesList step={step} id={singles.listId} />
        )}
      </div>
      <StepButtons>
        {own}
        {skip}
      </StepButtons>
    </li>
  );
}

/**
 * A line's buttons, on the right beside its name or, where they no longer fit there, wrapped under
 * it. Hidden while empty: a line whose step has nothing to press takes no room for buttons.
 */
function StepButtons({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 empty:hidden"
      data-setup-actions=""
    >
      {children}
    </div>
  );
}

/**
 * "You're all set": the server has recorded it, so the card will not be drawn again after this
 * visit; Hide setup takes it off now.
 */
function AllSet({ write }: { write: SetupStateWrite }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2"
      data-testid="setup-all-set"
    >
      <StepMark status="done" />
      <div className="min-w-36 flex-1">
        <p className="text-sm font-medium text-foreground">
          You&apos;re all set
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          Every step is done or skipped.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(STEP_BUTTON, "ml-auto")}
        onClick={write.dismiss}
        disabled={write.isWriting}
      >
        Hide setup
      </Button>
    </div>
  );
}

/**
 * "You're all set", once any sample-content outcome waiting on the person has been seen: a load
 * that finished setup keeps its outcome on the card until they continue.
 */
function AllSetAfterOutcome({
  sample,
  write,
  retry,
}: {
  sample: ReturnType<typeof useSampleRun>;
  write: SetupStateWrite;
  retry: () => void;
}) {
  return sample.awaitingContinue ? (
    <SampleContentPanel sample={sample} retry={retry} />
  ) : (
    <AllSet write={write} />
  );
}

/** A known answer, as the card draws its steps from. */
type CountedSetup = Extract<SetupAnswer, { known: true }>;

/**
 * Whether the card is all set, and the steps it draws while it is not. All set when the
 * host found it so, or when every step the card draws is done though the host could not tell
 * (`drawnSetup`) and the host has since recorded it (`useRetirement`); until then the steps are
 * drawn, every one done.
 */
function useDrawnSetup(
  card: SetupCardData,
  sample: { sampleRefused: boolean; answeredHere: boolean; settled: boolean },
  write: Pick<SetupStateWrite, "retire" | "clearFailure">
): { allSet: boolean; counted: CountedSetup | undefined } {
  const { sampleRefused, answeredHere, settled } = sample;
  const drawn =
    card.setup.known && !card.allSet
      ? drawnSteps(card.setup.steps, sampleRefused, answeredHere)
      : undefined;
  const drawnAllSet = drawn !== undefined && setupAllSet(drawn);
  const retirement = useRetirement(
    drawnAllSet,
    sampleRefused,
    write,
    card,
    settled
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
 * The steps the checklist lists: those the card draws, less sample content once anyone on the
 * site has answered it, whose line then goes rather than staying as a step done. Counted over
 * what is listed, so "N of M done" counts the lines shown. Whether setup is all set is judged
 * over the drawn steps before this (`useDrawnSetup`), so the line going changes no verdict.
 */
function listedSteps(counted: CountedSetup): CountedSetup {
  const steps = counted.steps.filter(
    step => !(step.kind === "sample" && step.status === "done")
  );
  return {
    known: true,
    steps,
    done: steps.filter(stepFinished).length,
    total: steps.length,
  };
}

/**
 * The checklist: the bar, one line per step, and sample content's load or outcome under them
 * while one is on show.
 */
function Checklist({
  listed,
  write,
  singles,
  sample,
  samplePanel,
}: {
  listed: CountedSetup;
  write: SetupStateWrite;
  singles: SinglesListControl;
  sample: SampleRunState;
  samplePanel: React.ReactNode;
}) {
  return (
    // Its one column is the card's width whatever a line holds (`minmax(0, 1fr)`): a grid's own
    // column would grow to the widest line's unbroken words and run past the card's edge.
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
      data-testid="setup-card"
    >
      <ProgressBar done={listed.done} total={listed.total} />
      <SaveFailure message={write.failed} />
      <ol
        aria-label="Setup steps"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
      >
        {listed.steps.map(step => (
          <StepLine
            key={step.kind}
            step={step}
            write={write}
            singles={singles}
            sample={sample}
          />
        ))}
      </ol>
      {samplePanel}
    </div>
  );
}

/**
 * "N of M done" in the frame's header beside the title, or the words of a change that could not
 * be saved, where they are seen; answers the count's words while steps are listed.
 */
function useSetupInFrame(
  listed: CountedSetup | undefined,
  failed: string | undefined
): string | undefined {
  const progress =
    listed === undefined ? undefined : progressText(listed.done, listed.total);
  useCardTitleCount(failed ?? progress);
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
  const write = useSetupState(retry);
  // The card's data to draw is the sample step's: while a load or its outcome is on show, a later
  // read that could not check setup keeps the last one that could, so the run stays on screen.
  const sample = useSampleRun(data as SetupCardData, retry, refreshing);
  const { card } = sample;
  const [singlesOpen, setSinglesOpen] = useState(false);
  const singlesListId = useId();
  const { allSet, counted } = useDrawnSetup(card, sample, write);
  const listed = counted === undefined ? undefined : listedSteps(counted);
  const progress = useSetupInFrame(listed, write.failed);

  if (!card.setup.known) return <NotKnown retry={retry} />;
  if (allSet) {
    return <AllSetAfterOutcome sample={sample} write={write} retry={retry} />;
  }
  if (listed === undefined || progress === undefined) return null;
  return (
    <Checklist
      listed={listed}
      write={write}
      singles={{
        open: singlesOpen,
        listId: singlesListId,
        onToggle: () => setSinglesOpen(open => !open),
      }}
      sample={sample}
      samplePanel={<SampleContentPanel sample={sample} retry={retry} />}
    />
  );
};

SetupCard.displayName = "SetupCard";
