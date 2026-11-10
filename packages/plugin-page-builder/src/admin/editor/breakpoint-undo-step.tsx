"use client";

/**
 * The undo of a breakpoint removal, drawn in Settings' Site tab: in place of
 * the breakpoint list while it asks, works or is refused (`UndoStepPanel`),
 * or above it while it is offered, followed or finished (`UndoStatusRow`).
 * Inline rather than a dialog over Settings, as the removal's steps are, so
 * there is never a modal on a modal.
 *
 * Every sentence comes from `breakpoint-undo-flow`; this draws them.
 *
 * @module admin/editor/breakpoint-undo-step
 * @experimental
 */
import { Button } from "@nextlyhq/ui";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type JSX } from "react";

import { Actions, RefusedStep, WorkingStep } from "./breakpoint-removal-step";
import {
  undoableWords,
  undoConfirmWords,
  skippedLine,
  undoingWords,
  undoLeftWords,
  undoneWords,
  undoRefusedWords,
  undoResumedWords,
  type SkippedLine,
} from "./breakpoint-undo-flow";
import type { BreakpointUndo } from "./use-breakpoint-undo";

/**
 * The step that takes the breakpoint list's place: the confirmation, this
 * tab's own undo going, or a refusal. Nothing for any other. Focus moves to
 * its title as it appears, so a keyboard or screen reader follows it.
 */
export function UndoStepPanel({
  undo,
  onClose,
  onEditBreakpoints,
}: {
  undo: BreakpointUndo;
  /** Close Settings: an undo carries on without it. */
  onClose: () => void;
  /** Open the breakpoint editor: the way on from breakpoints that no longer fit. */
  onEditBreakpoints: () => void;
}): JSX.Element | null {
  const title = useRef<HTMLHeadingElement>(null);
  const kind = undo.step.kind;
  useEffect(() => {
    title.current?.focus();
  }, [kind]);
  const { step } = undo;
  if (step.kind === "confirm") {
    const words = undoConfirmWords(step.target.labels);
    return (
      <div className="space-y-3" data-breakpoint-undo="confirm">
        <section
          aria-labelledby="breakpoint-undo-title"
          className="space-y-2 rounded-md border border-border p-4"
        >
          <h4
            ref={title}
            tabIndex={-1}
            id="breakpoint-undo-title"
            className="text-base font-semibold outline-none"
          >
            {words.title}
          </h4>
          <p className="text-sm text-muted-foreground">{words.body}</p>
          <p className="text-sm text-muted-foreground">{words.hint}</p>
        </section>
        <Actions>
          <Button
            type="button"
            variant="outline"
            onClick={undo.back}
            disabled={step.sending}
          >
            Back
          </Button>
          <Button type="button" onClick={undo.confirm} disabled={step.sending}>
            {step.sending ? "Putting back…" : words.confirm}
          </Button>
        </Actions>
      </div>
    );
  }
  if (step.kind === "undoing") {
    return (
      <WorkingStep
        attrs={{ "data-breakpoint-undo": "undoing" }}
        titleId="breakpoint-undo-title"
        titleRef={title}
        words={undoingWords(step.labels)}
        busy="Putting back…"
        onClose={onClose}
      />
    );
  }
  if (step.kind === "refused") {
    const words = undoRefusedWords(step.labels, step.message);
    return (
      <RefusedStep
        attrs={{ "data-breakpoint-undo": "refused" }}
        titleId="breakpoint-undo-title"
        titleRef={title}
        title={words.title}
        message={words.body}
      >
        <Button type="button" variant="outline" onClick={undo.back}>
          Back
        </Button>
        {step.fit ? (
          <Button
            type="button"
            onClick={() => {
              undo.back();
              onEditBreakpoints();
            }}
          >
            Edit breakpoints
          </Button>
        ) : (
          <Button type="button" onClick={undo.reload}>
            Reload
          </Button>
        )}
      </RefusedStep>
    );
  }
  return null;
}

/** One document the undo could not put every value back into. */
function SkippedItem({ line }: { line: SkippedLine }): JSX.Element {
  return (
    <li className="flex flex-wrap gap-x-2 border-t border-border py-1 first:border-t-0">
      {line.href === undefined ? (
        <span className="text-foreground">{line.name}</span>
      ) : (
        // Underlined always, beside names that are not links; in a new tab,
        // so Settings stays where it is.
        <a
          href={line.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          {line.name}
        </a>
      )}
      <span className="text-muted-foreground">{line.why}</span>
    </li>
  );
}

/**
 * A status row above the breakpoint list: the removal on offer, when the
 * removal's own row says nothing of it; an undo another tab or an earlier
 * visit started, still going; or this tab's undo finished, with each document
 * it could not put every value back into and why.
 */
export function UndoStatusRow({
  undo,
  offerHere,
}: {
  undo: BreakpointUndo;
  /** Whether this row offers the undo, the removal's own row not showing. */
  offerHere: boolean;
}): JSX.Element | null {
  const { step, offered } = undo;
  if (step.kind === "undoing" && !step.own) {
    const words = undoResumedWords(step.labels);
    return (
      <Row state="resumed" icon="going" title={words.title} hint={words.hint} />
    );
  }
  if (step.kind === "undone" || step.kind === "left") {
    // One that left pages says so first; what stayed out for good follows.
    const words =
      step.kind === "undone"
        ? undoneWords(step.labels, step.skipped)
        : {
            ...undoLeftWords(step.status),
            lines: step.skipped.map(entry =>
              skippedLine(entry, step.status.labels)
            ),
          };
    return (
      <Row
        state={step.kind}
        icon={
          step.kind === "undone" && words.lines.length === 0 ? "done" : "left"
        }
        title={words.title}
        hint={words.hint}
        below={<SkippedList lines={words.lines} />}
      />
    );
  }
  if (offered !== undefined && offerHere) {
    const words = undoableWords(offered);
    return (
      <Row
        state="undoable"
        icon="done"
        title={words.title}
        hint={words.hint}
        beside={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => undo.ask(offered)}
          >
            Undo
          </Button>
        }
      />
    );
  }
  return null;
}

/** The documents an undo could not put back, under its row; none, nothing. */
function SkippedList({
  lines,
}: {
  lines: readonly SkippedLine[];
}): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1.5 text-sm">
      {lines.map(line => (
        <SkippedItem key={`${line.name}|${line.why}`} line={line} />
      ))}
    </ul>
  );
}

/** A status row: its icon, its words, and what follows them. */
function Row({
  state,
  icon,
  title,
  hint,
  below = null,
  beside = null,
}: {
  state: string;
  icon: "going" | "done" | "left";
  title: string;
  hint: string;
  /** Under the words: the documents an undo could not put back. */
  below?: JSX.Element | null;
  /** At the row's end: its button. */
  beside?: JSX.Element | null;
}): JSX.Element {
  return (
    <div
      role="status"
      data-breakpoint-undo={state}
      className="flex items-start gap-2.5 rounded-md border border-border px-3.5 py-3 text-sm"
    >
      {icon === "going" ? (
        <Loader2
          className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : icon === "done" ? (
        <Check
          className="mt-0.5 size-4 shrink-0 text-success"
          aria-hidden="true"
        />
      ) : (
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 space-y-0.5">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{hint}</p>
        {below}
      </div>
      {beside}
    </div>
  );
}
