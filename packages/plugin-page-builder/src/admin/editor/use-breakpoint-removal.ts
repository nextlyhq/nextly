"use client";

/**
 * Removing a breakpoint from Settings' Site tab, step by step.
 *
 * A save of a set that drops breakpoints asks the route's dry run first
 * (`checking`). Where nothing at all is stored under them it saves straight
 * on; otherwise it shows what would go (`confirm`), and only Remove saves,
 * with the dry run's version so the server removes exactly what was shown.
 * A removal the save did not finish is followed (`removing`) by calling its
 * route until it has; one Settings finds still open when it opens is followed
 * the same way (`resumed`), with editing held until it ends. It ends `done`,
 * or `left` where documents keep their values for now. A refusal at any point
 * is `refused`, with the server's words.
 *
 * The breakpoint editor stays mounted, hidden, under the steps that take its
 * place, and its save is answered only when the step ends: `undefined` once
 * the set is stored, `null` to go back to the draft as it was, or a refusal
 * to show beside it.
 *
 * @module admin/editor/use-breakpoint-removal
 * @experimental
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RemovedBreakpoint } from "../../breakpoint-removal/dry-run";
import type {
  SiteBreakpointRemovalStatus,
  SiteBreakpointsDryRun,
  SiteBreakpointsSaved,
} from "../../library-contract";
import {
  askBreakpointRemoval,
  carryOnBreakpointRemoval,
  confirmBreakpointRemoval,
  readBreakpointRemoval,
  readSiteRemovals,
} from "../breakpoint-removal-client";

import {
  droppedIds,
  nothingStored,
  resumedWords,
} from "./breakpoint-removal-flow";

/** Where a removal is. */
export type RemovalStep =
  | { readonly kind: "idle" }
  | {
      readonly kind: "checking";
      readonly next: BreakpointSet;
      readonly labels: readonly string[];
      /**
       * Whether the save it found nothing stored for is out: then it can no
       * longer be cancelled, since the removal may already be made.
       */
      readonly sending?: boolean;
    }
  | {
      readonly kind: "confirm";
      readonly next: BreakpointSet;
      readonly dryRun: SiteBreakpointsDryRun;
      /** Whether the confirmed save is out. */
      readonly sending: boolean;
    }
  | {
      readonly kind: "removing";
      readonly runId: string;
      readonly labels: readonly string[];
      /** What the dry run counted, to say once it is done. */
      readonly counted: readonly RemovedBreakpoint[];
    }
  | {
      readonly kind: "resumed";
      readonly runId: string;
      readonly labels: readonly string[];
    }
  | {
      readonly kind: "done";
      /** The removal it ended, where there was a run. */
      readonly runId?: string;
      /** The tab's read of the removals when it ended; see `shownStep`. */
      readonly endedUnder?: unknown;
      readonly labels: readonly string[];
      readonly counted?: readonly RemovedBreakpoint[];
    }
  | {
      readonly kind: "left";
      /** The removal it ended. */
      readonly runId?: string;
      /** The tab's read of the removals when it ended; see `shownStep`. */
      readonly endedUnder?: unknown;
      readonly status: Pick<
        SiteBreakpointRemovalStatus,
        "labels" | "left" | "waitingOnDrafts"
      >;
    }
  | {
      readonly kind: "refused";
      readonly message: string;
    };

/** What the steps are handed. */
export interface BreakpointRemovalOptions {
  /** The site's breakpoints as the tab shows them. */
  readonly current: BreakpointSet;
  /** An ordinary save of the set, for one that removes nothing. */
  readonly save: (next: BreakpointSet) => Promise<string | null | undefined>;
  /** The removals the tab's read reports, or `undefined` where it reports none. */
  readonly removals: readonly SiteBreakpointRemovalStatus[] | undefined;
  /** Read the tab again. */
  readonly reread: () => void;
  /** Read the site's style again, so the canvas draws the stored set. */
  readonly refreshStyle: () => void;
}

/** How long to wait between calls carrying a removal on. */
const FOLLOW_MS = 1000;
/** How long to wait after a call carrying a removal on failed. */
const FOLLOW_AFTER_TROUBLE_MS = 5000;

/** A refusal's own words, or a plain fallback. */
function reasonOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The breakpoints could not be saved.";
}

/**
 * The step a finished removal ended on, from the run's own status: `null`
 * when it holds nothing (done), its status when it left documents. Never
 * from a call's own count of what it left, which counts that call alone.
 */
function endedOn(
  runId: string,
  endedUnder: unknown,
  status: SiteBreakpointRemovalStatus | null,
  labels: readonly string[],
  counted: readonly RemovedBreakpoint[] | undefined
): RemovalStep {
  if (status !== null && status.left > 0) {
    return { kind: "left", runId, endedUnder, status };
  }
  return {
    kind: "done",
    runId,
    endedUnder,
    labels: status?.labels ?? labels,
    ...(counted === undefined ? {} : { counted }),
  };
}

/** How many times a finished run's status is read before following it on. */
const STATUS_ATTEMPTS = 3;

/**
 * Removal `runId`'s status, read again after a short wait when a read fails;
 * `undefined` when none answered, which is never taken for done.
 */
async function statusOf(
  runId: string
): Promise<SiteBreakpointRemovalStatus | null | undefined> {
  for (let attempt = 1; attempt <= STATUS_ATTEMPTS; attempt += 1) {
    try {
      return await readBreakpointRemoval(runId);
    } catch {
      if (attempt < STATUS_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, FOLLOW_MS * attempt));
      }
    }
  }
  return undefined;
}

/** How often an open Settings looks for a removal another tab started. */
export const WATCH_MS = 10_000;

/**
 * The step on screen: this tab's own while it is under way; a removal the
 * read reports open (followed, holding editing), which also outranks this
 * tab's finished one, since editing must wait for it too; then this tab's
 * finished one; then one that finished leaving documents (said until they
 * are resolved). The read this tab held when its run ended may still report
 * that run open, from before it ended, and is not followed again; any newer
 * read reporting it open is the run opened again (a write brought values
 * back), and is followed.
 */
function shownStep(
  own: RemovalStep,
  removals: readonly SiteBreakpointRemovalStatus[] | undefined
): RemovalStep {
  const open = removals?.find(removal => removal.open);
  const finished = own.kind === "done" || own.kind === "left";
  if (
    open !== undefined &&
    (own.kind === "idle" ||
      (finished && (open.runId !== own.runId || removals !== own.endedUnder)))
  ) {
    return { kind: "resumed", runId: open.runId, labels: open.labels };
  }
  if (own.kind !== "idle") return own;
  const leftOver = removals?.find(removal => !removal.open && removal.left > 0);
  return leftOver === undefined
    ? own
    : { kind: "left", runId: leftOver.runId, status: leftOver };
}

/** What a dry run's answer leads to. */
function afterDryRun(
  dryRun: SiteBreakpointsDryRun
): "save" | "remove" | "confirm" {
  // The site drops nothing after all: an ordinary save.
  if (dryRun.removed.length === 0) return "save";
  return nothingStored(dryRun) ? "remove" : "confirm";
}

/** What the tab reads off a step. */
function stepFacts(
  step: RemovalStep
): Pick<BreakpointRemoval, "blocked" | "inFlight" | "takesOver"> {
  return {
    blocked:
      step.kind === "resumed" ? resumedWords(step.labels).hint : undefined,
    inFlight:
      step.kind === "checking" || (step.kind === "confirm" && step.sending),
    takesOver:
      step.kind === "checking" ||
      step.kind === "confirm" ||
      step.kind === "removing" ||
      step.kind === "refused",
  };
}

/** The steps, and what the tab does with them. */
export interface BreakpointRemoval {
  /** Where the removal is, the open run the tab's read reports included. */
  readonly step: RemovalStep;
  /** The editor's save: through the steps when the set drops breakpoints. */
  readonly save: (next: BreakpointSet) => Promise<string | null | undefined>;
  /** Back to the draft, from checking or confirm. */
  readonly back: () => void;
  /** Remove, from confirm. */
  readonly remove: () => void;
  /** Leave a refusal for the draft, which shows it. */
  readonly cancelRefused: () => void;
  /** Leave a refusal for the stored set: the editor is closed and re-read. */
  readonly reload: () => void;
  /** Told when editing starts, so a finished step's row gives way to it. */
  readonly editing: (editing: boolean) => void;
  /** Changes each time the editor must start again from the stored set. */
  readonly generation: number;
  /** Why the breakpoints cannot be edited now, if they cannot. */
  readonly blocked: string | undefined;
  /** Whether a request the step waits on is out. */
  readonly inFlight: boolean;
  /** Whether the step takes the breakpoint list's place, and the tab's. */
  readonly takesOver: boolean;
}

/** What a followed removal's end is settled with. */
type Finish = (
  asked: number,
  runId: string,
  labels: readonly string[],
  counted: readonly RemovedBreakpoint[] | undefined
) => Promise<"settled" | "again">;

/**
 * Carry the removal on screen on through its route until it says it has
 * finished, then settle it: this tab's (`removing`) or the one the read found
 * open (`resumed`). A failed call is tried again later, since the removal job
 * carries it on meanwhile.
 */
function useFollowRemoval(
  step: RemovalStep,
  turn: { readonly current: number },
  finish: Finish
): void {
  const following =
    step.kind === "removing" || step.kind === "resumed"
      ? step.runId
      : undefined;
  // Kept beside the call rather than in its dependencies: a new read hands
  // new arrays every time, and each would restart the call in flight.
  const followed = useRef<{
    labels: readonly string[];
    counted: readonly RemovedBreakpoint[] | undefined;
  }>({ labels: [], counted: undefined });
  const labels =
    step.kind === "removing" || step.kind === "resumed"
      ? step.labels
      : undefined;
  const counted = step.kind === "removing" ? step.counted : undefined;
  useEffect(() => {
    if (labels !== undefined) followed.current = { labels, counted };
  });
  useEffect(() => {
    if (following === undefined) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const asked = turn.current;
    const call = async (): Promise<void> => {
      let wait = FOLLOW_MS;
      try {
        const answered = await carryOnBreakpointRemoval(following);
        if (stopped) return;
        if (answered.finished) {
          const known = followed.current;
          const outcome = await finish(
            asked,
            following,
            known.labels,
            known.counted
          );
          // Opened again, or its status could not be read: followed on.
          if (outcome === "settled" || stopped) return;
        }
      } catch {
        wait = FOLLOW_AFTER_TROUBLE_MS;
      }
      if (!stopped) timer = setTimeout(() => void call(), wait);
    };
    void call();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [following, finish, turn]);
}

export function useBreakpointRemoval({
  current,
  save,
  removals,
  reread,
  refreshStyle,
}: BreakpointRemovalOptions): BreakpointRemoval {
  const [own, setOwn] = useState<RemovalStep>({ kind: "idle" });
  const [generation, setGeneration] = useState(0);
  // Each step begun, numbered: an answer for an earlier one changes nothing.
  const turn = useRef(0);
  // The editor's save, answered when the step ends.
  const answer = useRef<((value: string | null | undefined) => void) | null>(
    null
  );
  const answerEditor = (value: string | null | undefined): void => {
    const pending = answer.current;
    answer.current = null;
    pending?.(value);
  };
  const step = shownStep(own, removals);
  // The read as it is now, for a run that ends to record the one it ended
  // under: kept beside the callbacks rather than in their dependencies.
  const removalsNow = useRef(removals);
  useEffect(() => {
    removalsNow.current = removals;
  });

  /** Settle a removal its last call said has finished. */
  const finish = useCallback<Finish>(
    async (asked, runId, labels, counted) => {
      const status = await statusOf(runId);
      reread();
      if (turn.current !== asked) return "settled";
      // Still open (a write sent a document back to be stripped since), or
      // nothing known: the removal is followed on, never called done.
      if (status === undefined || status?.open === true) {
        setOwn({
          kind: "removing",
          runId,
          labels: status?.labels ?? labels,
          counted: counted ?? [],
        });
        return "again";
      }
      setOwn(endedOn(runId, removalsNow.current, status, labels, counted));
      return "settled";
    },
    [reread]
  );
  useFollowRemoval(step, turn, finish);
  // Another tab may start a removal while Settings is open here, and the
  // tab's own read is asked only when it opens or acts. So the removals are
  // looked at alone now and then, and the read asked again only when they
  // differ from the ones on screen: a refresh each time would hold Edit
  // breakpoints while it lasts.
  useEffect(() => {
    const timer = setInterval(() => {
      readSiteRemovals().then(
        removalsThere => {
          if (
            JSON.stringify(removalsThere ?? null) !==
            JSON.stringify(removalsNow.current ?? null)
          ) {
            reread();
          }
        },
        () => undefined
      );
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [reread]);

  /** Where a stored removal goes next: done, settled, or followed. */
  const afterSave = (
    asked: number,
    saved: SiteBreakpointsSaved,
    dryRun: SiteBreakpointsDryRun
  ): void => {
    const labels = dryRun.removed.map(removed => removed.label);
    const removal = saved.removal;
    if (removal === undefined) {
      setOwn({ kind: "done", labels, counted: dryRun.removed });
    } else if (removal.finished) {
      void finish(asked, removal.runId, labels, dryRun.removed);
    } else {
      setOwn({
        kind: "removing",
        runId: removal.runId,
        labels,
        counted: dryRun.removed,
      });
    }
  };

  const send = (
    asked: number,
    next: BreakpointSet,
    dryRun: SiteBreakpointsDryRun
  ): void => {
    confirmBreakpointRemoval(next, dryRun.version).then(
      saved => {
        refreshStyle();
        reread();
        // Stored: the editor closes on the set it saved.
        answerEditor(undefined);
        if (turn.current === asked) afterSave(asked, saved, dryRun);
      },
      (error: unknown) => {
        if (turn.current !== asked) return;
        setOwn({ kind: "refused", message: reasonOf(error) });
      }
    );
  };

  /** Go on from a dry run's answer. */
  const answered = (
    asked: number,
    next: BreakpointSet,
    dryRun: SiteBreakpointsDryRun
  ): void => {
    const then = afterDryRun(dryRun);
    if (then === "save") {
      setOwn({ kind: "idle" });
      save(next).then(answerEditor, (error: unknown) =>
        answerEditor(reasonOf(error))
      );
    } else if (then === "remove") {
      // Out now: from here it may already be made, so it cannot be cancelled.
      setOwn(current =>
        current.kind === "checking" ? { ...current, sending: true } : current
      );
      send(asked, next, dryRun);
    } else {
      setOwn({ kind: "confirm", next, dryRun, sending: false });
    }
  };

  const saveThrough = (
    next: BreakpointSet
  ): Promise<string | null | undefined> => {
    const dropped = droppedIds(current, next);
    if (dropped.length === 0) return save(next);
    const named = new Map(
      [...current.viewport, ...current.container].map(def => [
        def.id,
        def.label,
      ])
    );
    const asked = ++turn.current;
    setOwn({
      kind: "checking",
      next,
      labels: dropped.map(id => named.get(id) ?? id),
    });
    return new Promise(resolve => {
      answer.current = resolve;
      askBreakpointRemoval(next).then(
        dryRun => {
          if (turn.current === asked) answered(asked, next, dryRun);
        },
        (error: unknown) => {
          if (turn.current !== asked) return;
          setOwn({ kind: "refused", message: reasonOf(error) });
        }
      );
    });
  };

  return {
    step,
    save: saveThrough,
    back: () => {
      if (own.kind === "checking" && own.sending === true) return;
      turn.current += 1;
      setOwn({ kind: "idle" });
      answerEditor(null);
    },
    remove: () => {
      if (own.kind !== "confirm" || own.sending) return;
      setOwn({ ...own, sending: true });
      send(turn.current, own.next, own.dryRun);
    },
    cancelRefused: () => {
      if (own.kind !== "refused") return;
      turn.current += 1;
      setOwn({ kind: "idle" });
      answerEditor(own.message);
    },
    reload: () => {
      turn.current += 1;
      setOwn({ kind: "idle" });
      answerEditor(null);
      // The editor starts again from the set read now, not the draft.
      setGeneration(value => value + 1);
      refreshStyle();
      reread();
    },
    editing: now => {
      if (now && (own.kind === "done" || own.kind === "left")) {
        setOwn({ kind: "idle" });
      }
    },
    generation,
    ...stepFacts(step),
  };
}
