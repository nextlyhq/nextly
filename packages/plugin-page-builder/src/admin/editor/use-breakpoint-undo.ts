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
 * `refused`, with the server's words. An undo that left pages it can't write
 * yet (a live page under a pending draft) shows `left` until the read says
 * it holds none, never as all back. A finished undo gives way to anything
 * newer the read reports: another run going, or a newer removal on offer.
 *
 * Beside the removal's own steps (`use-breakpoint-removal`), which leave an
 * undo's run to this.
 *
 * @module admin/editor/use-breakpoint-undo
 * @experimental
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SITE_BREAKPOINT_UNDO_DOES_NOT_FIT,
  type SiteBreakpointRemoval,
  type SiteBreakpointRemovalStatus,
  type SiteBreakpointUndoable,
  type SiteBreakpointUndoSkipped,
} from "../../library-contract";
import {
  carryOnBreakpointRemoval,
  readBreakpointRemoval,
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
      /** The removal it undoes. */
      readonly undoes: string;
      readonly labels: readonly string[];
      readonly ids: readonly string[];
      /** Whether this tab started it, rather than finding it going. */
      readonly own: boolean;
    }
  | Undone
  | {
      /** Finished, but holding pages it puts back once it can write them. */
      readonly kind: "left";
      readonly runId: string;
      readonly undoes: string;
      /** The run as the server reports it: its labels and what it left. */
      readonly status: SiteBreakpointRemovalStatus;
      readonly ids: readonly string[];
      readonly skipped: readonly SiteBreakpointUndoSkipped[];
    }
  | {
      readonly kind: "refused";
      readonly labels: readonly string[];
      readonly message: string;
      /**
       * Whether its breakpoints no longer fit the set, which editing them
       * resolves; otherwise reading Settings again shows where things stand.
       */
      readonly fit: boolean;
    };

/** An undo this tab saw finish. */
interface Undone {
  readonly kind: "undone";
  /** Its run; absent for an undo with nothing to walk. */
  readonly runId: string | undefined;
  /** The removal it undid. */
  readonly undoes: string;
  readonly labels: readonly string[];
  readonly ids: readonly string[];
  readonly skipped: readonly SiteBreakpointUndoSkipped[];
  /** Its run's status when it ended holding pages; `null` when it held none. */
  readonly held: SiteBreakpointRemovalStatus | null;
  /** The read held when it ended, which may still report its run open. */
  readonly endedUnder: unknown;
}

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
  /** Back to the list from a refusal, reading Settings and the style again. */
  readonly reload: () => void;
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

/** Whether a refusal says the breakpoints no longer fit the set. */
function doesNotFit(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === SITE_BREAKPOINT_UNDO_DOES_NOT_FIT
  );
}

/** A refusal's own words, or a plain fallback. */
function reasonOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The removal could not be undone.";
}

/** A run the read reports, when it is an undo's. */
function undoOf(
  status: SiteBreakpointRemovalStatus
): (SiteBreakpointRemovalStatus & { readonly undoes: string }) | undefined {
  return status.undoes === undefined
    ? undefined
    : { ...status, undoes: status.undoes };
}

const IDLE: UndoStep = { kind: "idle" };

/**
 * What the read alone shows: an undo going (another tab's, or an earlier
 * visit's), followed; else one that finished leaving pages, said until it
 * holds none.
 */
function fromRead(
  removals: readonly SiteBreakpointRemovalStatus[] | undefined,
  undoable: SiteBreakpointUndoable | null | undefined
): UndoStep {
  const undos = (removals ?? []).flatMap(removal => undoOf(removal) ?? []);
  const going = undos.find(undo => undo.open);
  if (going !== undefined) {
    return {
      kind: "undoing",
      runId: going.runId,
      undoes: going.undoes,
      labels: going.labels,
      ids: undoable?.runId === going.undoes ? undoable.ids : [],
      own: false,
    };
  }
  const held = undos.find(undo => undo.left > 0);
  return held === undefined
    ? IDLE
    : {
        kind: "left",
        runId: held.runId,
        undoes: held.undoes,
        status: held,
        ids: [],
        skipped: [],
      };
}

/**
 * Whether the read reports something newer than an undo this tab saw finish:
 * another run open, its own open again in a read newer than the one it ended
 * under (a write brought values back), or another removal on offer. The
 * removal it undid is never offered again, so any offer is newer.
 */
function outranked(
  own: Undone,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined,
  undoable: SiteBreakpointUndoable | null | undefined
): boolean {
  const open = removals?.some(
    removal =>
      removal.open &&
      (removal.runId !== own.runId || removals !== own.endedUnder)
  );
  if (open === true) return true;
  return (
    undoable !== null && undoable !== undefined && undoable.runId !== own.undoes
  );
}

/**
 * A finished undo as shown: `left` while its run holds pages, read from the
 * newest read that reports it, else from what it was last seen holding;
 * `undone` only once that is cleared with the run's final report
 * (`useFinalReport`), so values a later retry skipped are never missed.
 */
function finishedShown(
  own: Undone,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined
): UndoStep {
  const runId = own.runId;
  if (runId === undefined) return own;
  const now = removals?.find(removal => removal.runId === runId);
  const held = now !== undefined && !now.open && now.left > 0 ? now : own.held;
  return held === null
    ? own
    : {
        kind: "left",
        runId,
        undoes: own.undoes,
        status: held,
        ids: own.ids,
        skipped: own.skipped,
      };
}

/**
 * The step on screen: this tab's own while it is under way; its finished one
 * until the read reports something newer; else what the read shows.
 */
function shownUndo(
  own: UndoStep,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined,
  undoable: SiteBreakpointUndoable | null | undefined
): UndoStep {
  if (
    own.kind === "confirm" ||
    own.kind === "refused" ||
    own.kind === "undoing"
  ) {
    return own;
  }
  if (own.kind === "undone" && !outranked(own, removals, undoable)) {
    return finishedShown(own, removals);
  }
  return fromRead(removals, undoable);
}

/**
 * What a finished undo's run holds: its status when it left pages, `null`
 * when it holds none. Read from the run, never from the last call's own
 * count, which counts that call alone; a failed read answers `null`, and the
 * Settings read that follows says what it holds.
 */
async function heldAtEnd(
  runId: string | undefined
): Promise<SiteBreakpointRemovalStatus | null> {
  if (runId === undefined) return null;
  try {
    const status = await readBreakpointRemoval(runId);
    return status !== null && !status.open && status.left > 0 ? status : null;
  } catch {
    return null;
  }
}

/**
 * Keep a finished undo's report whole while it holds pages: a read reporting
 * it holding pages records that, and a newer read no longer reporting it
 * (its pages written since, by a later retry) has the run's final report
 * fetched, which names what that retry could not put back, before the undo
 * is shown as done. A failed fetch is tried again on the next read.
 */
function useFinalReport(
  own: UndoStep,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined,
  setOwn: (update: (current: UndoStep) => UndoStep) => void,
  latest: { readonly current: unknown }
): void {
  useEffect(() => {
    if (own.kind !== "undone" || own.runId === undefined) return;
    if (removals === undefined) return;
    const runId = own.runId;
    const now = removals.find(removal => removal.runId === runId);
    const sameRun = (current: UndoStep): current is Undone =>
      current.kind === "undone" && current.runId === runId;
    if (now !== undefined && !now.open && now.left > 0) {
      if (own.held === null) {
        setOwn(current =>
          sameRun(current) ? { ...current, held: now } : current
        );
      }
      return;
    }
    if (own.held === null || now !== undefined) return;
    if (removals === own.endedUnder) return;
    let stopped = false;
    carryOnBreakpointRemoval(runId).then(
      answered => {
        if (stopped || !answered.finished) return;
        setOwn(current =>
          sameRun(current)
            ? {
                ...current,
                held: null,
                skipped: answered.undo?.skipped ?? [],
                endedUnder: latest.current,
              }
            : current
        );
      },
      () => undefined
    );
    return () => {
      stopped = true;
    };
  }, [own, removals, setOwn, latest]);
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
  if (step.kind !== "undone" && step.kind !== "left") return new Map();
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
  // The read on hand when an undo ends, which may be from before it did.
  const latest = useRef(removals);
  useEffect(() => {
    followed.current = step;
    latest.current = removals;
  });

  // Ends an undo: what its run still holds is read first, so a finished
  // undo that left pages is never shown as all back.
  const finish = useCallback(
    async (
      ended: Pick<Undone, "runId" | "undoes" | "labels" | "ids" | "skipped">
    ): Promise<void> => {
      const held = await heldAtEnd(ended.runId);
      setOwn({
        kind: "undone",
        ...ended,
        held,
        endedUnder: latest.current,
      });
    },
    []
  );

  const settle = useCallback(
    (answered: SiteBreakpointRemoval) => {
      const was = followed.current;
      if (was.kind !== "undoing") return;
      reread();
      refreshStyle();
      void finish({
        runId: was.runId,
        undoes: was.undoes,
        labels: was.labels,
        ids: was.ids,
        skipped: answered.undo?.skipped ?? [],
      });
    },
    [reread, refreshStyle, finish]
  );
  useFollowUndo(step, settle);
  useFinalReport(own, removals, setOwn, latest);

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
          void finish({
            runId: run?.runId,
            undoes: target.runId,
            labels: target.labels,
            ids: target.ids,
            skipped: run?.undo?.skipped ?? [],
          });
        } else {
          setOwn({
            kind: "undoing",
            runId: run.runId,
            undoes: target.runId,
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
          fit: doesNotFit(error),
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
      // Offered only while nothing else is shown, a finished undo outranked.
      if (step.kind !== "idle") return;
      setOwn({ kind: "confirm", target, sending: false });
    },
    back: () => {
      if (own.kind === "confirm" && own.sending) return;
      setOwn({ kind: "idle" });
    },
    reload: () => {
      setOwn({ kind: "idle" });
      reread();
      refreshStyle();
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
