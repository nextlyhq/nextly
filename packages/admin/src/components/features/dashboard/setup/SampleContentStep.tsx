"use client";

/**
 * "Start with sample content" inside the setup card: a few words and its actions in the tile's
 * hint line, and, while a load or its outcome is on show, a panel under the tiles that says it in
 * full (`dashboard-layout` R-18 and R-19):
 *
 * - offered: Load · No thanks, only to a person the project's route would let load, while the site
 *   holds no entry and nobody answered;
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

import type React from "react";

import { Link } from "@admin/components/ui/link";

import type { SampleRunState } from "./useSampleRun";

/**
 * A failure's words: the darker shade in light mode, as the base red at this size falls short of
 * the 4.5:1 text contrast there; the base red in dark mode, which reads at that size.
 */
const FAILED_TEXT = "text-destructive-700 dark:text-destructive";

/** An action word in the hint line or the panel. */
function SampleAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** "·" between two parts, for the eye only, spaced by padding as the hint line's flex items drop spaces. */
function Dot() {
  return (
    <span aria-hidden="true" className="px-1">
      ·
    </span>
  );
}

/** When a load started, in the reader's own words for a date and time. */
export function startedWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The tile's hint line while the step is open: its state in a word or two, and its actions. */
export function SampleContentHint({ sample }: { sample: SampleRunState }) {
  const { view } = sample;
  switch (view.kind) {
    case "checking":
      return <span>Checking…</span>;
    case "offer":
      return (
        <>
          <SampleAction onClick={sample.load}>Load</SampleAction>
          <Dot />
          <SampleAction onClick={sample.decline}>No thanks</SampleAction>
        </>
      );
    case "unreadable":
      return <span>Couldn&apos;t check</span>;
    case "running":
      return <span>Loading…</span>;
    case "declining":
      return <span role="status">Saving…</span>;
    case "unfinished":
      return <span>Not finished</span>;
    case "failed":
      return <span className={FAILED_TEXT}>Couldn&apos;t load</span>;
    case "confirming":
      return <span>Load again?</span>;
    case "unrecorded":
      return (
        <span className={FAILED_TEXT}>
          {view.recording ? "Recording…" : "Not recorded"}
        </span>
      );
    case "loaded":
      return <span>Loaded</span>;
    case "done":
      return null;
  }
}

/** "Add your first entry", where a load's outcome offers it and the step is open. */
function FirstEntry({ href }: { href: string | undefined }) {
  if (href === undefined) return null;
  return (
    <>
      <Dot />
      <Link
        href={href}
        className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary"
      >
        Add your first entry
      </Link>
    </>
  );
}

/** What the panel says of the load, and its actions. */
function RunMessage({ sample }: { sample: SampleRunState }) {
  const { view } = sample;
  switch (view.kind) {
    case "running":
      return <p role="status">Loading sample content…</p>;
    case "unfinished":
      return (
        <p role="status">
          A load started at {startedWhen(view.startedAt)} has not finished. It
          may still be running, so no other load will start.
          <FirstEntry href={sample.entryHref} />
        </p>
      );
    case "failed":
      return (
        <p role="alert">
          <span className={FAILED_TEXT}>
            Loading sample content failed: {view.failure}
          </span>
          <FirstEntry href={sample.entryHref} />
          {view.retry && (
            <>
              <Dot />
              <SampleAction onClick={sample.askAgain}>Try again</SampleAction>
            </>
          )}
        </p>
      );
    case "confirming":
      return (
        <p role="alert">
          Some sample content may already be there from the load that failed.
          Load it again?
          <Dot />
          <SampleAction onClick={sample.confirmAgain}>Load again</SampleAction>
          <Dot />
          <SampleAction onClick={sample.cancelAgain}>Cancel</SampleAction>
        </p>
      );
    case "unrecorded":
      return (
        <p role="alert">
          <span className={FAILED_TEXT}>
            The sample content loaded, but recording that failed
            {view.again ? " again" : ""}.
          </span>
          <Dot />
          <SampleAction onClick={sample.record} disabled={view.recording}>
            {view.recording ? "Recording…" : "Try again"}
          </SampleAction>
        </p>
      );
    case "loaded":
      return (
        <p role="status">
          {view.continuing ? "Checking your steps…" : "Sample content loaded."}
          {!view.continuing && (
            <>
              <Dot />
              <SampleAction onClick={sample.continueOn}>Continue</SampleAction>
            </>
          )}
        </p>
      );
    default:
      return null;
  }
}

/**
 * The panel under the tiles: the load or its outcome in full, a refusal the server answered with,
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
      className="grid gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground"
      data-setup-sample-panel=""
    >
      {sample.notice !== undefined && <p role="alert">{sample.notice}</p>}
      <RunMessage sample={sample} />
      {sample.refreshFailed && (
        <p role="alert" data-setup-refresh-failed="">
          We couldn&apos;t check your other steps just now.
          <Dot />
          <SampleAction onClick={retry}>Retry</SampleAction>
        </p>
      )}
    </div>
  );
}
