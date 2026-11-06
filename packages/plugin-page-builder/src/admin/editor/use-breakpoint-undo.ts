"use client";

/**
 * Undoing the newest breakpoint removal from Settings' Site tab, step by step.
 *
 * The Site tab's read offers the removal that can still be undone
 * (`undoable`). Undo asks first (`confirm`), and only Put back undoes it. An
 * undo its request did not finish is followed (`undoing`) by calling the
 * removal route until it has; one Settings finds still going is followed the
 * same way, shown as a row while editing waits for it. It ends `undone`, with
 * every document it could not put every value back into and why, or
 * `refused`, with the server's words.
 *
 * Beside the removal's own steps (`use-breakpoint-removal`), which leave an
 * undo's run to this.
 *
 * @module admin/editor/use-breakpoint-undo
 * @experimental
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SiteBreakpointRemoval,
  SiteBreakpointRemovalStatus,
  SiteBreakpointUndoable,
  SiteBreakpointUndoSkipped,
} from "../../library-contract";
import {
  carryOnBreakpointRemoval,
  undoBreakpointRemoval,
} from "../breakpoint-removal-client";

import { followLoop } from "./follow-loop";

/** Where an undo is. */
export type UndoStep =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirm";
      readonly target: SiteBreakpointUndoable;
      /** Whether the undo is out. */
      readonly sending: boolean;
    }
  | {
      readonly kind: "undoing";
      readonly runId: string;
      readonly labels: readonly string[];
      readonly ids: readonly string[];
      /** Whether this tab started it, rather than finding it going. */
      readonly own: boolean;
    }
  | {
      readonly kind: "undone";
      readonly labels: readonly string[];
      readonly ids: readonly string[];
      readonly skipped: readonly SiteBreakpointUndoSkipped[];
    }
  | {
      readonly kind: "refused";
      readonly labels: readonly string[];
      readonly message: string;
    };

/** What the undo is handed. */
export interface BreakpointUndoOptions {
  /** The removal the tab's read offers to undo, as it reports it. */
  readonly undoable: SiteBreakpointUndoable | null | undefined;
  /** The runs the tab's read reports, an undo's included. */
  readonly removals: readonly SiteBreakpointRemovalStatus[] | undefined;
  /** Read the tab again. */
  readonly reread: () => void;
  /** Read the site's style again, so the canvas draws the stored set. */
  readonly refreshStyle: () => void;
}

/** The undo's steps, and what the tab does with them. */
export interface BreakpointUndo {
  readonly step: UndoStep;
  /**
   * The removal on offer, while nothing else is said of it: the row that
   * offers it shows Undo.
   */
  readonly offered: SiteBreakpointUndoable | undefined;
  /** Undo, from the row: asks first. */
  readonly ask: (target: SiteBreakpointUndoable) => void;
  /** Back to the list, from the confirmation or a refusal. */
  readonly back: () => void;
  /** Put back, from the confirmation. */
  readonly confirm: () => void;
  /** Told when editing starts, so a finished undo's row gives way to it. */
  readonly editing: (editing: boolean) => void;
  /** The breakpoints just put back, by id, for the list to say so. */
  readonly putBack: ReadonlyMap<string, string>;
  /** Whether the step takes the breakpoint list's place, and the tab's. */
  readonly takesOver: boolean;
  /** Whether a request the step waits on is out. */
  readonly inFlight: boolean;
}

/** How long to wait between calls carrying an undo on. */
const FOLLOW_MS = 1000;
/** How long to wait after a call carrying an undo on failed. */
const FOLLOW_AFTER_TROUBLE_MS = 5000;

/** A refusal's own words, or a plain fallback. */
function reasonOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The removal could not be undone.";
}

/**
 * The step on screen: this tab's own; else an undo the read reports going,
 * followed and shown as a row.
 */
function shownUndo(
  own: UndoStep,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined,
  undoable: SiteBreakpointUndoable | null | undefined
): UndoStep {
  if (own.kind !== "idle") return own;
  const going = removals?.find(
    removal => removal.open && removal.undoes !== undefined
  );
  if (going === undefined) return own;
  return {
    kind: "undoing",
    runId: going.runId,
    labels: going.labels,
    ids:
      undoable !== null &&
      undoable !== undefined &&
      undoable.runId === going.undoes
        ? undoable.ids
        : [],
    own: false,
  };
}

/**
 * Carry the undo on screen on through the removal route until it says it has
 * finished, then settle it with what it could not put back. A failed call is
 * tried again later, since the removal job carries it on meanwhile.
 */
function useFollowUndo(
  step: UndoStep,
  settle: (answered: SiteBreakpointRemoval) => void
): void {
  const following = step.kind === "undoing" ? step.runId : undefined;
  useEffect(() => {
    if (following === undefined) return;
    return followLoop(async stopped => {
      try {
        const answered = await carryOnBreakpointRemoval(following);
        if (stopped()) return null;
        if (!answered.finished) return FOLLOW_MS;
        settle(answered);
        return null;
      } catch {
        return FOLLOW_AFTER_TROUBLE_MS;
      }
    });
  }, [following, settle]);
}

/** The breakpoints put back, by id, as the list tags them. */
function putBackOf(step: UndoStep): ReadonlyMap<string, string> {
  if (step.kind !== "undone") return new Map();
  return new Map(step.ids.map(id => [id, "put back"]));
}

export function useBreakpointUndo({
  undoable,
  removals,
  reread,
  refreshStyle,
}: BreakpointUndoOptions): BreakpointUndo {
  const [own, setOwn] = useState<UndoStep>({ kind: "idle" });
  const step = shownUndo(own, removals, undoable);
  // The step being followed, for its settle to name what it put back: kept
  // beside the callback rather than in its dependencies.
  const followed = useRef(step);
  useEffect(() => {
    followed.current = step;
  });

  const settle = useCallback(
    (answered: SiteBreakpointRemoval) => {
      const was = followed.current;
      reread();
      refreshStyle();
      setOwn({
        kind: "undone",
        labels: was.kind === "undoing" ? was.labels : [],
        ids: was.kind === "undoing" ? was.ids : [],
        skipped: answered.undo?.skipped ?? [],
      });
    },
    [reread, refreshStyle]
  );
  useFollowUndo(step, settle);

  const confirm = (): void => {
    if (own.kind !== "confirm" || own.sending) return;
    const { target } = own;
    setOwn({ ...own, sending: true });
    undoBreakpointRemoval(target.runId).then(
      saved => {
        refreshStyle();
        reread();
        const run = saved.removal;
        if (run === undefined || run.finished) {
          setOwn({
            kind: "undone",
            labels: target.labels,
            ids: target.ids,
            skipped: run?.undo?.skipped ?? [],
          });
        } else {
          setOwn({
            kind: "undoing",
            runId: run.runId,
            labels: target.labels,
            ids: target.ids,
            own: true,
          });
        }
      },
      (error: unknown) => {
        setOwn({
          kind: "refused",
          labels: target.labels,
          message: reasonOf(error),
        });
      }
    );
  };

  return {
    step,
    offered:
      step.kind === "idle" && undoable !== null && undoable !== undefined
        ? undoable
        : undefined,
    ask: target => {
      if (own.kind !== "idle") return;
      setOwn({ kind: "confirm", target, sending: false });
    },
    back: () => {
      if (own.kind === "confirm" && own.sending) return;
      setOwn({ kind: "idle" });
    },
    confirm,
    editing: now => {
      if (now && (own.kind === "undone" || own.kind === "refused")) {
        setOwn({ kind: "idle" });
      }
    },
    putBack: putBackOf(step),
    takesOver:
      step.kind === "confirm" ||
      step.kind === "refused" ||
      (step.kind === "undoing" && step.own),
    inFlight: step.kind === "confirm" && step.sending,
  };
}
