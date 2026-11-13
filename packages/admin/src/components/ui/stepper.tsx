"use client";

/**
 * Where a flow of a few steps is: each step done, current or still to come,
 * drawn as a numbered row with a line between steps. The email provider setup
 * draws its Choose / Connect / Send a test with it, and through
 * `@nextlyhq/plugin-sdk/admin` a plugin's flow (an import, a guided setup)
 * draws the same.
 *
 * An ordered list, so its length and each step's place are announced; the
 * current step carries `aria-current="step"`, and a done step says "(done)" in
 * words as well as with a tick. A done step may offer a way back, as a link
 * (`href`) or a button (`onSelect`); a current or upcoming step never does,
 * since a step not yet reached has nothing to go back to.
 *
 * @module components/ui/stepper
 */

import type { JSX, ReactNode } from "react";

import { Check } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

/** Where a step is relative to the current one. */
export type StepState = "complete" | "current" | "upcoming";

/** One step: what it reads, and for a done step, the way back to it. */
export interface StepperStep {
  /** What the step is; a done step can say what was chosen there. */
  label: ReactNode;
  /** A done step's page, opened as a link. */
  href?: string;
  /** A done step's handler, run from a button, where the flow has no pages. */
  onSelect?: () => void;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /**
   * The current step's index, from 0. Steps before it are done and steps
   * after it are to come; an index past the last marks every step done.
   */
  current: number;
  /** Names the list. Default: "Steps". */
  "aria-label"?: string;
  className?: string;
}

/** A step's state, from its index and the current one: the only place it is decided. */
function stateOf(index: number, current: number): StepState {
  if (index < current) return "complete";
  return index === current ? "current" : "upcoming";
}

/** The focus ring the shared Button draws, so a way back reads as a control. */
const STEP_FOCUS =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A step's number, or a tick once it is done. */
function StepMarker({
  index,
  state,
}: {
  index: number;
  state: StepState;
}): JSX.Element {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
        state === "upcoming"
          ? "border-border text-muted-foreground"
          : "border-foreground bg-foreground text-background"
      )}
    >
      {state === "complete" ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        index + 1
      )}
    </span>
  );
}

/**
 * The marker and the label of one step, wrapped in its way back when it is
 * done and offers one, so the whole step is the target rather than its text.
 */
function StepContent({
  step,
  index,
  state,
}: {
  step: StepperStep;
  index: number;
  state: StepState;
}): JSX.Element {
  const content = (
    <>
      <StepMarker index={index} state={state} />
      {/* The label wraps rather than being cut short: on a phone three
          steps share the row, and a label cut to "Source: S…" no longer
          says what was chosen or what comes next. */}
      <span
        className={cn(
          "min-w-0 [overflow-wrap:anywhere]",
          state === "current" ? "font-medium" : "text-muted-foreground"
        )}
      >
        {step.label}
        {state === "complete" && <span className="sr-only"> (done)</span>}
      </span>
    </>
  );
  if (state !== "complete") return content;
  const wayBack = cn(
    "flex min-w-0 items-center gap-2 hover:[&>span:last-child]:text-foreground hover:[&>span:last-child]:underline",
    STEP_FOCUS
  );
  if (step.href) {
    return (
      <Link href={step.href} className={wayBack}>
        {content}
      </Link>
    );
  }
  if (step.onSelect) {
    return (
      <button
        type="button"
        onClick={step.onSelect}
        className={cn(wayBack, "cursor-pointer text-left")}
      >
        {content}
      </button>
    );
  }
  return content;
}

export function Stepper({
  steps,
  current,
  "aria-label": ariaLabel = "Steps",
  className,
}: StepperProps): JSX.Element {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn("flex items-center gap-2 text-sm sm:gap-4", className)}
    >
      {steps.map((step, index) => {
        const state = stateOf(index, current);
        return (
          <li
            key={index}
            data-state={state}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={state === "current" ? "step" : undefined}
          >
            <StepContent step={step} index={index} state={state} />
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="hidden h-px flex-1 bg-border sm:block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
