/**
 * Removing breakpoints as the installed plugin carries it out: the run (one
 * open at a time), the walk that strips every document holding blocks, and
 * the open removal as the write path's lock judgements read it.
 *
 * Every document is read and written as the SYSTEM. A value under a removed
 * breakpoint is one no stylesheet emits any longer, so stripping it changes
 * nothing anybody sees; it goes from every document, whoever may open it, so
 * the breakpoint starts empty if it is ever added again. What authorizes the
 * removal is the site permission the save asked for. Each write still carries
 * the hash of the value it was computed from, so an author's concurrent edit
 * is never overwritten (`host-rewrite/expectations`), and a published row is
 * published again in the state it was read in.
 *
 * Bound to the installed plugin through a holder, as the component rewrite's
 * service is: contributed before `init` runs and called long after it.
 *
 * @module breakpoint-removal/service
 * @experimental
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  documentAddressOf,
  type LeftReason,
  type RewriteReport,
} from "../host-rewrite/contract";
import { progressStore } from "../host-rewrite/progress";
import { rewriteHosts } from "../host-rewrite/rewrite";
import {
  documentHasWorkingDraft,
  siteHostReader,
  siteWalkSource,
  systemHostWriter,
  type DocumentSite,
  type RewriteSite,
} from "../host-rewrite/site";
import type { SiteStyleData } from "../site-style";

import {
  removalRunStore,
  WRITTEN_BACK,
  type BreakpointRun,
  type HoldingRun,
} from "./run-store";
import {
  emittedBreakpoints,
  removalOf,
  stripBreakpointsStep,
  type Removal,
} from "./strip";

/** The name the service is contributed under. */
export const BREAKPOINT_REMOVAL_SERVICE = "breakpointRemoval";

/** How far one call of the walk may go before it stops to resume later. */
export interface WalkBudget {
  readonly maxDocuments?: number;
  readonly deadline?: Date;
}

/**
 * The service.
 *
 * @experimental
 */
export interface BreakpointRemovalService {
  /** The open removal, or `null` when none is. */
  openRun(): Promise<BreakpointRun | null>;
  /** One removal by its id, open or done; `null` when there is none. */
  runById(runId: string): Promise<BreakpointRun | null>;
  /**
   * Open a removal of `removedIds`, recording the set stored `before` and who
   * started it. Refused with a conflict while another is open.
   */
  begin(
    removedIds: readonly string[],
    before: unknown,
    startedBy: string
  ): Promise<BreakpointRun>;
  /** Drop a removal that wrote nothing, which closes it. */
  abandon(runId: string): Promise<void>;
  /**
   * Strip the site for a removal, resuming where it stopped, within `budget`.
   * A removal that is done is opened again for the documents it left, which
   * may since have been resolved (a draft published or discarded), and
   * answers finished, with nothing done, when it left none.
   */
  walk(runId: string, budget: WalkBudget): Promise<RewriteReport>;
  /**
   * The removals still holding the breakpoints they removed: the open one,
   * and each done one with documents it left.
   */
  holding(): Promise<HoldingRun[]>;
  /**
   * The open removal as a lock judges a write against it, or `null` when none
   * is open. Throws when the runs cannot be read: a caller accepting a write
   * on its answer accepts nothing then.
   */
  openRemoval(): Promise<Removal | null>;
  /**
   * The open removal with every id it removed, for the one write that stores
   * the set without them: the site still defines them while that write is
   * judged, since it is the write that removes them, so judging it by the
   * ids defined now would leave nothing to accept. `null` when none is open;
   * throws when the runs cannot be read.
   */
  openRemovalAsSaved(): Promise<Removal | null>;
  /**
   * Carry on whatever removal is owed a walk, within `budget`: the open one;
   * or else a done one a write brought values back to while another was open
   * (`WRITTEN_BACK`); or else a done one that left a page for its pending
   * draft, once that draft is gone (discarded, which runs no write hook).
   * Nothing when none is.
   */
  carryOn(budget: WalkBudget): Promise<void>;
  /**
   * The site defines `ids` again: the done runs that removed them give up
   * their claim on them (`readdedIds`).
   */
  retire(ids: readonly string[]): Promise<void>;
}

/** What the installed plugin hands the service. */
export interface RemovalInstall {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof removalRunStore>[1];
  /** The site, as every walk of its documents reads it. */
  readonly site: DocumentSite & Pick<RewriteSite, "defaultLocale">;
  /** The configured site style, which a stored `null` breakpoint set gives back. */
  readonly defaults: SiteStyleData | undefined;
  /**
   * The breakpoint ids the site defines now, read when asked: a run strips
   * only those of its ids the site does not define again.
   */
  readonly definedBreakpoints: () => Promise<ReadonlySet<string>>;
}

/** What a call on a removal that is already done answers. */
const NOTHING_LEFT: RewriteReport = {
  rewritten: [],
  unchanged: [],
  left: [],
  caughtByFinalWalk: [],
  finished: true,
};

/**
 * A run's removal as it stands now: its ids less those the site defines
 * again, which the walk and the locks both judge by, so a lock never accepts
 * a strip the walk would not make.
 */
async function removalNow(
  run: BreakpointRun,
  installed: RemovalInstall
): Promise<Removal> {
  return removalOf(
    run,
    installed.defaults,
    await installed.definedBreakpoints()
  );
}

/**
 * How long a save may take between opening its run and storing its set (the
 * count, then the write and its retries) before the run is taken to be one
 * whose save failed: seconds in practice, so minutes to spare.
 */
const PREPARING_MS = 5 * 60 * 1000;

/**
 * When a run was opened, read from its id: a UUIDv7 carries its creation
 * time in milliseconds in its first 48 bits. `undefined` for an id that is
 * not one, which is then taken as old.
 */
function openedAt(runId: string): number | undefined {
  const hex = runId.replace(/-/g, "");
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(hex)) return undefined;
  return Number.parseInt(hex.slice(0, 12), 16);
}

/**
 * Whether an open run is still being prepared by its save: the site still
 * defines every id it removes, and it was opened moments ago. One older than
 * that is a save that failed after opening it, which the walk then closes.
 */
async function preparing(
  run: BreakpointRun,
  installed: RemovalInstall
): Promise<boolean> {
  const at = openedAt(run.id);
  if (at === undefined || Date.now() - at >= PREPARING_MS) return false;
  return (await removalNow(run, installed)).ids.size === 0;
}

/** How many pages left for a pending draft one pass checks. */
const DRAFT_CHECKS_PER_PASS = 20;

/**
 * A done run that left a page for its pending draft, where that draft is gone
 * now, re-queued for it (which opens the run again); `undefined` when there
 * is none. Publishing the draft is a write the report sees; discarding it is
 * not, so this is how a discard is noticed. A page whose draft is still there,
 * or that cannot be read, is left alone, so a pass never opens a run it would
 * only leave the page on again.
 */
async function resolvedDraftRun(
  store: ReturnType<typeof removalRunStore>,
  site: RemovalInstall["site"]
): Promise<BreakpointRun | undefined> {
  const waiting = await store.leftFor(PENDING_DRAFT, DRAFT_CHECKS_PER_PASS);
  for (const { runId, documentKey } of waiting) {
    const document = documentAddressOf(documentKey);
    if (document === undefined) continue;
    if (await documentHasWorkingDraft(site, document)) continue;
    const queued = await store.requeueDocument(runId, documentKey);
    if (queued === "reopened" || queued === "requeued") {
      return (await store.runById(runId)) ?? undefined;
    }
  }
  return undefined;
}

/** The left reason a published page with a pending draft is recorded with. */
export const PENDING_DRAFT: LeftReason = "pending-draft";

/** The service over the installed plugin, resolved per call. */
export function breakpointRemovalService(
  install: () => RemovalInstall
): BreakpointRemovalService {
  const runs = () => removalRunStore(install().db, install().dialect);
  const walk = async (
    runId: string,
    budget: WalkBudget
  ): Promise<RewriteReport> => {
    const store = runs();
    const run = await store.runById(runId);
    if (run === null) {
      throw NextlyError.notFound({
        logContext: { reason: "breakpoint-removal-no-run", runId },
      });
    }
    const installed = install();
    const removal = await removalNow(run, installed);
    if (removal.ids.size === 0) {
      // Every breakpoint it removed is defined again (or its set was never
      // stored): what documents hold under them is the site's own, and there
      // is nothing to strip. An open run is closed, keeping its row as the
      // record, so the one open slot is not held for nothing.
      if (run.open) await store.advance(run.id, run.phase, "done", null);
      return NOTHING_LEFT;
    }
    // A done run is walked again only for the documents it left, which
    // keep its ids from being defined again until they are stripped; with
    // none left it is closed, and values a breakpoint added since put back
    // are the site's own.
    if (!run.open && !(await store.reopen(runId))) return NOTHING_LEFT;
    return rewriteHosts(
      {
        fence: store,
        progress: progressStore(installed.db, installed.dialect),
        source: siteWalkSource(installed.site),
        read: siteHostReader(installed.site),
        write: systemHostWriter(installed.site),
      },
      {
        runId,
        step: stripBreakpointsStep(removal),
        ...(budget.maxDocuments === undefined
          ? {}
          : { maxDocuments: budget.maxDocuments }),
        ...(budget.deadline === undefined ? {} : { deadline: budget.deadline }),
      }
    );
  };
  return {
    openRun: () => runs().openRun(),
    runById: runId => runs().runById(runId),
    // The set the stylesheet is emitted under is recorded as it is now, so
    // carrying the run on later does not depend on the configured defaults
    // staying as they are.
    begin: (removedIds, before, startedBy) =>
      runs().open(
        removedIds,
        {
          stored: before,
          emitted: emittedBreakpoints(before, install().defaults) ?? null,
        },
        startedBy
      ),
    abandon: runId => runs().abandon(runId),
    holding: () => runs().holding(),
    openRemoval: async () => {
      const run = await runs().openRun();
      return run === null ? null : removalNow(run, install());
    },
    openRemovalAsSaved: async () => {
      const run = await runs().openRun();
      return run === null ? null : removalOf(run, install().defaults);
    },
    walk,
    carryOn: async budget => {
      const store = runs();
      const open = await store.openRun();
      // A run whose save has not stored its set yet is that save's to walk:
      // walked now, it would find its ids still defined and close with
      // nothing done, and the save's own walk would then report it finished.
      if (open !== null && (await preparing(open, install()))) return;
      // The open run first: it holds the one open slot, and a done run
      // cannot be opened again while it does.
      const owed =
        open ??
        (await store.holding()).find(held =>
          held.leftReasons.includes(WRITTEN_BACK)
        )?.run ??
        (await resolvedDraftRun(store, install().site));
      if (owed === null || owed === undefined) return;
      await walk(owed.id, budget);
    },
    retire: ids => runs().retire(ids),
  };
}
