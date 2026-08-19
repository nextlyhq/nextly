"use client";

/**
 * The first-run card: what an author has not done on this page yet.
 *
 * Presentational. What the steps ARE and whether each is done is
 * {@link module:onboarding}'s derivation from the document; whether the card
 * should be on screen at all is {@link useBuilderChecklist}'s. Splitting the
 * three keeps the part with a rule in it testable without a DOM, which is the
 * same split the rest of this package makes.
 *
 * ## It stays after the last box is ticked
 *
 * Vanishing at the moment of completion takes away the only confirmation the
 * author gets, and reads as the card having crashed rather than as work being
 * finished. It stays, saying so, until it is dismissed — one click, on a card
 * that is plainly done.
 *
 * @module onboarding-checklist
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { cn } from "@nextlyhq/ui/utils";
import { Check, X } from "lucide-react";
import { useCallback, useState } from "react";

import {
  builderChecklist,
  checklistComplete,
  checklistDoneCount,
  type ChecklistStep,
} from "./onboarding";
import { browserStore, type PreferenceStore } from "./shell-state";

/** Where the dismissal is remembered. */
export const CHECKLIST_STORAGE_KEY = "nextly.builder.checklist.dismissed";

export interface UseBuilderChecklistOptions {
  /** The page being edited. Every step is derived from it. */
  document: BlockDocument;
  /**
   * Whether the checklist may be shown at all. Defaults to true.
   *
   * The host's kill switch. A site that has taught its authors the editor
   * another way turns it off rather than asking every one of them to dismiss
   * it.
   */
  enabled?: boolean;
  /**
   * Where the dismissal is remembered. Defaults to `localStorage`.
   *
   * A port rather than a direct call, so a test can drive it and a server
   * render can have one that remembers nothing. Note what this is NOT: storage
   * is per BROWSER, so two people sharing a profile share the dismissal. Per
   * user in the sense that matters — nobody dismisses it for anyone else's
   * machine — and not a claim about accounts.
   */
  store?: PreferenceStore;
}

export interface UseBuilderChecklistResult {
  readonly steps: readonly ChecklistStep[];
  readonly visible: boolean;
  readonly dismiss: () => void;
}

/**
 * Whether to show the card, and what it should say.
 *
 * @param options - the document, the kill switch, and where dismissal lives
 * @returns the steps, whether to render, and the way to stop
 */
export function useBuilderChecklist({
  document,
  enabled = true,
  store,
}: UseBuilderChecklistOptions): UseBuilderChecklistResult {
  // Read once on mount rather than on every render: the value only changes
  // through `dismiss`, and reading storage during render makes the first
  // client render disagree with the server's.
  const [dismissed, setDismissed] = useState(() => {
    const source = store ?? browserStore(CHECKLIST_STORAGE_KEY);
    return source.read() === "true";
  });

  const dismiss = useCallback(() => {
    const source = store ?? browserStore(CHECKLIST_STORAGE_KEY);
    // Written before the state changes, and a failure is swallowed: private
    // browsing refuses storage, and an author who cannot persist the dismissal
    // should still get the card off their screen for this session.
    try {
      source.write("true");
    } catch {
      // Storage refused. The in-memory dismissal below still stands.
    }
    setDismissed(true);
  }, [store]);

  const steps = builderChecklist(document);
  return { steps, visible: enabled && !dismissed, dismiss };
}

export interface OnboardingChecklistProps {
  steps: readonly ChecklistStep[];
  /** Stop showing it. */
  onDismiss: () => void;
  className?: string;
}

/**
 * @param props - the steps and the way to dismiss them
 * @returns the card, or nothing when there are no steps to show
 */
export function OnboardingChecklist({
  steps,
  onDismiss,
  className,
}: OnboardingChecklistProps) {
  if (steps.length === 0) return null;
  const done = checklistDoneCount(steps);
  const complete = checklistComplete(steps);

  return (
    // `complementary` with a name: the card is beside the editor's work rather
    // than part of it, and an unnamed region is announced as "region".
    <aside
      aria-label="Getting started"
      className={cn(
        "border-[color:var(--nx-builder-border)] bg-[color:var(--nx-builder-surface-raised)] text-[color:var(--nx-builder-text)] w-72 rounded-lg border p-4 shadow-lg",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {complete ? "You're all set" : "Getting started"}
          </p>
          {/* The count is text rather than only a bar, so it is readable
              without colour and announced without a label of its own. */}
          <p className="text-[color:var(--nx-builder-text-muted)] text-xs">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss getting started"
          className="focus-visible:ring-ring text-[color:var(--nx-builder-text-muted)] -m-1 rounded p-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-3">
        {steps.map(step => (
          <li key={step.id} className="flex gap-2">
            {/* Weight and a mark carry the state, not colour alone: a done
                step reads as done in monochrome and to anyone who cannot
                separate the two hues. */}
            <span
              aria-hidden
              className="border-[color:var(--nx-builder-border)] mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border"
            >
              {step.done ? <Check className="size-3" /> : null}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm",
                  step.done
                    ? "text-[color:var(--nx-builder-text-muted)] font-normal line-through"
                    : "font-medium"
                )}
              >
                {step.label}
              </span>
              {/* The hint stays on a done step rather than disappearing: the
                  card is also how an author looks the gesture up again. */}
              <span className="text-[color:var(--nx-builder-text-muted)] block text-xs">
                {step.hint}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
