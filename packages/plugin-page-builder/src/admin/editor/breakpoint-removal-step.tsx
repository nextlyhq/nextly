"use client";

/**
 * The breakpoint removal's steps, drawn in Settings' Site tab in place of the
 * breakpoint list (`RemovalStepPanel`: checking, confirm, removing, refused)
 * or above it (`RemovalStatusRow`: resumed, done, left). Inline rather than a
 * dialog over Settings, so there is never a modal on a modal.
 *
 * Every sentence comes from `breakpoint-removal-flow`; this draws them.
 *
 * @module admin/editor/breakpoint-removal-step
 * @experimental
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type JSX, type Ref } from "react";

import { DESTRUCTIVE_CONFIRM_CLASS } from "../destructive-confirm";

import {
  checkingWords,
  confirmWords,
  doneWords,
  leftWords,
  removingWords,
  resumedWords,
  type RemovalNote,
} from "./breakpoint-removal-flow";
import type { BreakpointRemoval } from "./use-breakpoint-removal";

/** A note, its lead in the foreground. */
function Note({ note }: { note: RemovalNote }): JSX.Element {
  return (
    <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
      <strong className="font-medium text-foreground">{note.lead}</strong>{" "}
      {note.rest}
    </p>
  );
}

/**
 * The buttons under a step, at its right. `held` keeps them at the bottom of
 * the tab as it scrolls, for a confirmation longer than Settings is tall, so
 * the choice it asks for, and `note` beside it, are never scrolled out of
 * sight. Held at the tab's very edge, over its bottom padding, so nothing
 * shows beneath them.
 */
export function Actions({
  children,
  held = false,
  note,
}: {
  children: JSX.Element | JSX.Element[];
  held?: boolean;
  note?: string;
}): JSX.Element {
  return (
    <div
      className={
        held
          ? "sticky -bottom-6 -mb-6 flex items-center justify-end gap-2 bg-background pb-6 pt-3"
          : "flex items-center justify-end gap-2"
      }
    >
      {note === undefined ? null : (
        <p className="mr-auto text-sm text-muted-foreground">{note}</p>
      )}
      {children}
    </div>
  );
}

/** The rows a save keeps, with the ones it drops struck through. */
function CheckedRows({
  current,
  next,
}: {
  current: BreakpointSet;
  next: BreakpointSet;
}): JSX.Element {
  const kept = new Set(
    [...next.viewport, ...next.container].map(def => def.id)
  );
  // Every authored row: the viewport's base has no width and is not one,
  // while the container axis may hold one unbounded definition of its own.
  const rows = [
    ...current.viewport.filter(def => def.maxWidth !== undefined),
    ...current.container,
  ];
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map(def => {
        const dropped = !kept.has(def.id);
        return (
          <li
            key={def.id}
            className={
              dropped
                ? "flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground line-through"
                : "flex items-center gap-2 px-3 py-2 text-sm"
            }
          >
            <span className="font-medium">{def.label}</span>
            <span className="text-muted-foreground">
              {def.maxWidth === undefined
                ? "every width"
                : `up to ${def.maxWidth} pixels`}
            </span>
            {dropped ? <span className="sr-only">(removed)</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The step that takes the breakpoint list's place: checking, confirm,
 * removing or refused. Nothing for any other.
 */
export function RemovalStepPanel(props: StepProps): JSX.Element {
  // Focus moves to each step as it takes the editor's place: the button that
  // led to it is hidden with the editor, and focus would otherwise fall back
  // to the page, losing a keyboard author's place.
  const holder = useRef<HTMLDivElement>(null);
  const kind = props.removal.step.kind;
  useEffect(() => {
    holder.current?.focus();
  }, [kind]);
  return (
    <div ref={holder} tabIndex={-1} className="outline-none">
      <StepBody {...props} />
    </div>
  );
}

/** What a step is drawn from. */
interface StepProps {
  removal: BreakpointRemoval;
  current: BreakpointSet;
  /** What the base breakpoint is called on the device buttons. */
  baseLabel: string;
  /** Close Settings: the removal carries on without it. */
  onClose: () => void;
}

/** The step itself, by its kind. */
function StepBody({
  removal,
  current,
  baseLabel,
  onClose,
}: StepProps): JSX.Element | null {
  const { step } = removal;
  if (step.kind === "checking") {
    return (
      <div className="space-y-3" data-breakpoint-removal="checking">
        <CheckedRows current={current} next={step.next} />
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {checkingWords(step.labels)}
        </p>
        <Actions>
          <Button
            type="button"
            variant="outline"
            // Not once the save it found nothing stored for is out.
            disabled={step.sending === true}
            onClick={removal.back}
          >
            Cancel
          </Button>
          <Button type="button" disabled>
            Save breakpoints
          </Button>
        </Actions>
      </div>
    );
  }
  if (step.kind === "confirm") {
    const words = confirmWords(step.dryRun, current, step.next, baseLabel);
    return (
      <div className="space-y-3" data-breakpoint-removal="confirm">
        <section
          aria-labelledby="breakpoint-removal-title"
          className="space-y-3 rounded-md border border-border p-4"
        >
          <h4 id="breakpoint-removal-title" className="text-base font-semibold">
            {words.title}
          </h4>
          <p className="text-sm text-muted-foreground">{words.intro}</p>
          {words.removed.map(removed => (
            <div key={removed.id} className="space-y-3">
              {words.removed.length > 1 ? (
                <h5 className="text-sm font-medium">{removed.label}</h5>
              ) : null}
              <dl className="divide-y divide-border border-y border-border text-sm">
                {removed.rows.map(row => (
                  <div key={row.label} className="flex justify-between py-1.5">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="tabular-nums">
                      {row.count}
                      {row.drafts === undefined ? null : (
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.drafts} with drafts
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {removed.totals === null ? null : (
                <p className="text-sm text-muted-foreground">
                  {removed.totals}
                </p>
              )}
              {removed.notes.map(note => (
                <Note key={note.lead} note={note} />
              ))}
            </div>
          ))}
          {words.notes.map(note => (
            <Note key={note.lead} note={note} />
          ))}
        </section>
        <Actions held note={words.undo}>
          <Button
            type="button"
            variant="outline"
            disabled={step.sending}
            onClick={removal.back}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="destructive"
            // The deeper red the page builder's destructive confirmations share.
            className={DESTRUCTIVE_CONFIRM_CLASS}
            disabled={step.sending}
            onClick={removal.remove}
          >
            {step.sending ? "Removing…" : words.confirm}
          </Button>
        </Actions>
      </div>
    );
  }
  if (step.kind === "removing") {
    return (
      <WorkingStep
        attrs={{ "data-breakpoint-removal": "removing" }}
        titleId="breakpoint-removal-title"
        words={removingWords(step.labels)}
        busy="Removing…"
        onClose={onClose}
      />
    );
  }
  if (step.kind === "refused") {
    return (
      <RefusedStep
        attrs={{ "data-breakpoint-removal": "refused" }}
        titleId="breakpoint-removal-title"
        title="Nothing was removed"
        message={step.message}
      >
        <Button type="button" variant="outline" onClick={removal.cancelRefused}>
          Cancel
        </Button>
        <Button type="button" onClick={removal.reload}>
          Reload breakpoints
        </Button>
      </RefusedStep>
    );
  }
  return null;
}

/** The data attribute a step is found by: its flow, and its state. */
type StepAttrs = Readonly<Record<`data-${string}`, string>>;

/**
 * A step that works while the person waits: its title, what it is doing, an
 * indeterminate bar (the route reports finished or not, not a total), and
 * Close beside a busy button. `titleRef` takes focus as it appears.
 */
export function WorkingStep({
  attrs,
  titleId,
  titleRef,
  words,
  busy,
  onClose,
}: {
  attrs: StepAttrs;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
  words: {
    readonly title: string;
    readonly body: string;
    readonly hint: string;
  };
  busy: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3" {...attrs}>
      <section
        aria-labelledby={titleId}
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h4
          ref={titleRef}
          tabIndex={titleRef === undefined ? undefined : -1}
          id={titleId}
          className="text-base font-semibold outline-none"
        >
          {words.title}
        </h4>
        <p className="text-sm text-muted-foreground">{words.body}</p>
        <div
          role="progressbar"
          aria-label={words.title}
          className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="absolute inset-y-0 left-1/4 w-1/3 rounded-full bg-foreground motion-safe:animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground">{words.hint}</p>
      </section>
      <Actions>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" disabled>
          {busy}
        </Button>
      </Actions>
    </div>
  );
}

/** A refused step: its title in the destructive colour, why, and its buttons. */
export function RefusedStep({
  attrs,
  titleId,
  titleRef,
  title,
  message,
  children,
}: {
  attrs: StepAttrs;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
  title: string;
  message: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <div className="space-y-3" {...attrs}>
      <section
        role="alert"
        aria-labelledby={titleId}
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h4
          ref={titleRef}
          tabIndex={titleRef === undefined ? undefined : -1}
          id={titleId}
          className="text-base font-semibold text-destructive outline-none"
        >
          {title}
        </h4>
        <p className="text-sm text-muted-foreground">{message}</p>
      </section>
      <Actions>{children}</Actions>
    </div>
  );
}

/**
 * A status row above the breakpoint list: resumed, done or left. A finished
 * removal that can still be undone says until when, with Undo beside it.
 */
export function RemovalStatusRow({
  removal,
  offer,
}: {
  removal: BreakpointRemoval;
  /** The undo this row's removal can still have, when it can. */
  offer?: { readonly hint: string; readonly undo: () => void };
}): JSX.Element | null {
  const { step } = removal;
  const row =
    step.kind === "resumed"
      ? { icon: "going" as const, words: resumedWords(step.labels) }
      : step.kind === "done"
        ? { icon: "done" as const, words: doneWords(step.labels, step.counted) }
        : step.kind === "left"
          ? { icon: "left" as const, words: leftWords(step.status) }
          : null;
  if (row === null) return null;
  return (
    <div
      role="status"
      data-breakpoint-removal={step.kind}
      className="flex items-start gap-2.5 rounded-md border border-border px-3.5 py-3 text-sm"
    >
      {row.icon === "going" ? (
        <Loader2
          className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : row.icon === "done" ? (
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
        <p className="font-medium">{row.words.title}</p>
        <p className="text-muted-foreground">
          {offer === undefined
            ? row.words.hint
            : `${row.words.hint} ${offer.hint}`}
        </p>
      </div>
      {offer === undefined ? null : (
        <Button type="button" variant="outline" size="sm" onClick={offer.undo}>
          Undo
        </Button>
      )}
    </div>
  );
}
