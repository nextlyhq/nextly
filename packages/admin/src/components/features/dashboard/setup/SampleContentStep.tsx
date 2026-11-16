"use client";

/**
 * "Start with sample content" inside the setup card: a word or two in its line's hint and its
 * buttons on that line, and, while a load or its outcome is on show, a panel under the steps that
 * says it in full:
 *
 * - offered: Add samples and No thanks, only to a person the project's route would let load, while
 *   the site holds no entry and nobody answered;
 * - loading: says so, from whichever tab started it, until it reports;
 * - a load started and never reported: "A load started at <time> has not finished", with "Add your
 *   first entry" and nothing else, however long ago it started;
 * - failed: what failed, with "Add your first entry", and Try again while the site holds no entry,
 *   which first warns that some of the content may already be there;
 * - loaded but not recorded: says exactly that, and Try again records it without loading again;
 * - loaded: Continue, which shows the steps as they are now.
 *
 * Its state is `useSampleRun`'s; this only draws it.
 *
 * @module components/features/dashboard/setup/SampleContentStep
 */

import { Button } from "@nextlyhq/ui";
import type React from "react";

import { Link } from "@admin/components/ui/link";

import { STEP_BUTTON, STEP_GHOST_BUTTON } from "./step-buttons";
import type { SampleRunState, SampleView } from "./useSampleRun";

/** A failure's words, in the danger status's text colour, which reads at 4.5:1 in both themes. */
const FAILED_TEXT = "text-danger-text";

/** An action in the panel, drawn as the card's other buttons are. */
function SampleAction({
  children,
  onClick,
  disabled,
  quiet = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** The quieter of two actions side by side: Cancel, No thanks. */
  quiet?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={quiet ? "ghost" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={quiet ? STEP_GHOST_BUTTON : STEP_BUTTON}
    >
      {children}
    </Button>
  );
}

/** A message's actions, on their own line under its words. */
function Actions({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {children}
    </span>
  );
}

/** When a load started, in the reader's own words for a date and time. */
function startedWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The step's hint line while it is open, in a word or two, and whether it says something failed. */
export interface SampleHint {
  words: string;
  failed: boolean;
}

/**
 * What the step's hint line says of the load, where it says anything of its own: nothing while the
 * load is offered, whose hint is the step's own words, or once it is answered.
 */
export function sampleHint(view: SampleView): SampleHint | undefined {
  const said = (words: string, failed = false) => ({ words, failed });
  switch (view.kind) {
    case "checking":
      return said("Checking…");
    case "unreadable":
      return said("Couldn't check");
    case "running":
      return said("Loading…");
    case "declining":
      return said("Saving…");
    case "unfinished":
      return said("Not finished");
    case "failed":
      return said("Couldn't load", true);
    case "confirming":
      return said("Load again?");
    case "unrecorded":
      return said(view.recording ? "Recording…" : "Not recorded", true);
    case "loaded":
      return said("Loaded");
    case "offer":
    case "done":
      return undefined;
  }
}

/** The step's buttons while the load is offered: Add samples, and No thanks beside it. */
export function SampleContentActions({ sample }: { sample: SampleRunState }) {
  if (sample.view.kind !== "offer") return null;
  return (
    <>
      <SampleAction onClick={sample.load}>Add samples</SampleAction>
      <SampleAction onClick={sample.decline} quiet>
        No thanks
      </SampleAction>
    </>
  );
}

/** "Add your first entry", where a load's outcome offers it and the step is open. */
function FirstEntry({ href }: { href: string | undefined }) {
  if (href === undefined) return null;
  return (
    <Button asChild variant="outline" size="sm" className={STEP_BUTTON}>
      <Link href={href}>Add your first entry</Link>
    </Button>
  );
}

/** A view of one kind, with the step's state and actions. */
type ViewProps<K extends SampleView["kind"]> = {
  view: Extract<SampleView, { kind: K }>;
  sample: SampleRunState;
};

function Running() {
  return <p role="status">Loading sample content…</p>;
}

function Unfinished({ view, sample }: ViewProps<"unfinished">) {
  return (
    <p role="status">
      A load started at {startedWhen(view.startedAt)} has not finished. It may
      still be running, so no other load will start.
      {sample.entryHref !== undefined && (
        <Actions>
          <FirstEntry href={sample.entryHref} />
        </Actions>
      )}
    </p>
  );
}

/**
 * A failed load: what failed, "Add your first entry" while that step is open, Try again while the
 * site holds no entry, and always a way to end the step, declining sample content for the site,
 * which the server allows over a failed load. Without it a failed load that left entries would
 * hold setup open with nothing to press.
 */
function Failed({ view, sample }: ViewProps<"failed">) {
  return (
    <p role="alert">
      <span className={FAILED_TEXT}>
        Loading sample content failed: {view.failure}
      </span>
      <Actions>
        <FirstEntry href={sample.entryHref} />
        {view.retry && (
          <SampleAction onClick={sample.askAgain}>Try again</SampleAction>
        )}
        <SampleAction onClick={sample.decline} quiet>
          Decline sample content
        </SampleAction>
      </Actions>
    </p>
  );
}

function Confirming({ sample }: ViewProps<"confirming">) {
  return (
    <p role="alert">
      Some sample content may already be there from the load that failed. Load
      it again?
      <Actions>
        <SampleAction onClick={sample.confirmAgain}>Load again</SampleAction>
        <SampleAction onClick={sample.cancelAgain} quiet>
          Cancel
        </SampleAction>
      </Actions>
    </p>
  );
}

function Unrecorded({ view, sample }: ViewProps<"unrecorded">) {
  return (
    <p role="alert">
      <span className={FAILED_TEXT}>
        The sample content loaded, but recording that failed
        {view.again ? " again" : ""}.
      </span>
      <Actions>
        <SampleAction onClick={sample.record} disabled={view.recording}>
          {view.recording ? "Recording…" : "Try again"}
        </SampleAction>
      </Actions>
    </p>
  );
}

function Loaded({ view, sample }: ViewProps<"loaded">) {
  if (view.continuing) return <p role="status">Checking your steps…</p>;
  return (
    <p role="status">
      Sample content loaded.
      <Actions>
        <SampleAction onClick={sample.continueOn}>Continue</SampleAction>
      </Actions>
    </p>
  );
}

/** What the panel says of each kind of view; a kind with no panel says nothing here. */
const RUN_MESSAGES: {
  [K in SampleView["kind"]]?: (props: ViewProps<K>) => React.ReactNode;
} = {
  running: Running,
  unfinished: Unfinished,
  failed: Failed,
  confirming: Confirming,
  unrecorded: Unrecorded,
  loaded: Loaded,
};

/** What the panel says of the load, and its actions. */
function RunMessage({ sample }: { sample: SampleRunState }) {
  const Message = RUN_MESSAGES[sample.view.kind] as
    | ((props: ViewProps<SampleView["kind"]>) => React.ReactNode)
    | undefined;
  return Message === undefined ? null : (
    <Message view={sample.view} sample={sample} />
  );
}

/**
 * The panel under the steps: the load or its outcome in full, a refusal the server answered with,
 * and a check of the other steps that failed while a run is on show, with its own Retry.
 */
export function SampleContentPanel({
  sample,
  retry,
}: {
  sample: SampleRunState;
  retry: () => void;
}) {
  if (!sample.panelShown && !sample.refreshFailed) return null;
  return (
    <div
      className="mt-1.5 grid gap-2 rounded-lg border border-border px-3 py-2.5 text-[12.5px] text-muted-foreground"
      data-setup-sample-panel=""
    >
      {sample.notice !== undefined && <p role="alert">{sample.notice}</p>}
      <RunMessage sample={sample} />
      {sample.refreshFailed && (
        <p role="alert" data-setup-refresh-failed="">
          We couldn&apos;t check your other steps just now.
          <Actions>
            <SampleAction onClick={retry}>Retry</SampleAction>
          </Actions>
        </p>
      )}
    </div>
  );
}
