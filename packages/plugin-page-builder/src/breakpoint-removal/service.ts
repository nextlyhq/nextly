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
import type { SiteBreakpointUndoSkipped } from "../library-contract";
import type { SiteStyleData } from "../site-style";

import {
  fragmentCapture,
  fragmentStore,
  FRAGMENTS_KEPT_DAYS,
  type FragmentRow,
  type StoredFragment,
} from "./fragments";
import type { OpenWork } from "./lock-acceptance";
import {
  fragmentSource,
  fragmentsForValue,
  restoreStep,
  skippedDocuments,
} from "./restore";
import {
  removalRunStore,
  removedEver,
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

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What an undo that cannot be made is told. */
const CANNOT_UNDO =
  "This removal can no longer be undone: only the newest removal can be, once, for 30 days.";

/**
 * The refusal of an undo, with why in the log: not a done removal, a newer
 * removal since, undone already, or nothing kept any more.
 */
function cannotUndo(reason: string, runId: string): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: CANNOT_UNDO,
    logContext: { reason: `breakpoint-undo-${reason}`, runId },
  });
}

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
   * The open removal, or undo, as a lock judges a write against it, or `null`
   * when none is open. Throws when the runs cannot be read: a caller
   * accepting a write on its answer accepts nothing then.
   */
  openRemoval(): Promise<OpenWork | null>;
  /**
   * The open removal with every id it removed, for the one write that stores
   * the set without them: the site still defines them while that write is
   * judged, since it is the write that removes them, so judging it by the
   * ids defined now would leave nothing to accept. An open undo as
   * `openRemoval` answers it. `null` when none is open; throws when the runs
   * cannot be read.
   */
  openRemovalAsSaved(): Promise<OpenWork | null>;
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
  /**
   * The save that opened a run has stored its set, or may have: the run is
   * walked from now on. Until then nobody walks it.
   */
  publish(runId: string): Promise<void>;
  /**
   * Keep what a removal took out of the shared styles, before the write that
   * takes it out. Throws when it cannot be kept, so that write is not made.
   */
  keepFragment(row: FragmentRow): Promise<string>;
  /** Delete a kept row whose write was not made. */
  discardFragment(id: string): Promise<void>;
  /** Delete what removals took out before `before`: past their undo window. */
  purgeFragments(before: Date): Promise<void>;
  /**
   * Open a run putting removal `runId` back, refusing (409) unless it can be
   * undone: it is a removal and done, it is the newest removal, it was not
   * undone already, and it was made within the 30 days what it took out is
   * kept for. The run takes the one open slot, preparing until its set is
   * stored (`publish`); walking it puts each kept value back (`restore`).
   */
  undo(runId: string, startedBy: string): Promise<BreakpointRun>;
  /** What removal `runId` kept of what it took out, newest first. */
  kept(runId: string): Promise<StoredFragment[]>;
  /**
   * What undo `undoRunId` could not put back, per document, read once its
   * walk is finished. A document it left (a live row under a pending draft)
   * counts only what will not go back once it can be written: a value not
   * back yet is one that will be.
   */
  undoSkipped(undoRunId: string): Promise<SiteBreakpointUndoSkipped[]>;
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

/** What a call on a run its save has not published yet answers: nothing done. */
const NOT_WALKED: RewriteReport = {
  rewritten: [],
  unchanged: [],
  left: [],
  caughtByFinalWalk: [],
  finished: false,
};

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
 * Whether a run being prepared has outlived its save: opened longer ago than
 * any save takes, so the save stopped before it published the run.
 */
function staleWhilePreparing(run: BreakpointRun): boolean {
  const at = openedAt(run.id);
  return at === undefined || Date.now() - at >= PREPARING_MS;
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

/** A walk's budget as the rewrite takes it: only what is set. */
function budgetOf(budget: WalkBudget): WalkBudget {
  return {
    ...(budget.maxDocuments === undefined
      ? {}
      : { maxDocuments: budget.maxDocuments }),
    ...(budget.deadline === undefined ? {} : { deadline: budget.deadline }),
  };
}

/**
 * Walk an undo: only the documents its removal kept something for, each
 * value given back what was kept of it (`restoreStep`). Its writes are made as
 * the system, as the strip's were, and keep nothing: there is nothing an
 * undo takes out.
 */
async function walkRestore(
  installed: RemovalInstall,
  store: ReturnType<typeof removalRunStore>,
  run: { readonly runId: string; readonly undoes: string },
  budget: WalkBudget
): Promise<RewriteReport> {
  const rows = await fragmentStore(installed.db).forRun(run.undoes);
  return rewriteHosts(
    {
      fence: store,
      progress: progressStore(installed.db, installed.dialect),
      source: fragmentSource(rows),
      read: siteHostReader(installed.site),
      write: systemHostWriter(installed.site),
    },
    { runId: run.runId, step: restoreStep(rows), ...budgetOf(budget) }
  );
}

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
    // Nobody walks a run its save has not published: its set may yet be
    // refused, and nothing it strips could be put back.
    if (run.preparing) return NOT_WALKED;
    const installed = install();
    // An undo walks only what its removal kept, putting it back.
    if (run.undoes !== null) {
      if (!run.open && !(await store.reopen(runId))) return NOTHING_LEFT;
      return walkRestore(
        installed,
        store,
        { runId, undoes: run.undoes },
        budget
      );
    }
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
    // What each strip takes out is kept before its write (`fragments`).
    const capture = fragmentCapture(fragmentStore(installed.db), runId);
    return rewriteHosts(
      {
        fence: store,
        progress: progressStore(installed.db, installed.dialect),
        source: siteWalkSource(installed.site),
        read: siteHostReader(installed.site),
        write: capture.writer(systemHostWriter(installed.site)),
      },
      {
        runId,
        step: stripBreakpointsStep(removal, capture.remember),
        ...budgetOf(budget),
      }
    );
  };
  // An open undo as the locks judge it: what its removal kept, per value,
  // and of the shared styles with every id the removal took out.
  const restoreWork = async (undoes: string): Promise<OpenWork> => {
    const installed = install();
    const rows = await fragmentStore(installed.db).forRun(undoes);
    const undone = await runs().runById(undoes);
    const site = rows.find(row => row.host === null);
    return {
      kind: "restore",
      fragmentsFor: fragmentsForValue(rows, installed.site.defaultLocale()),
      ...(site?.form === "site"
        ? {
            classes: {
              fragment: site.fragment,
              ids: undone === null ? new Set<string>() : removedEver(undone),
            },
          }
        : {}),
    };
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
    // A dropped removal stripped nothing, so nothing it kept is owed back.
    abandon: async runId => {
      await fragmentStore(install().db).forget(runId);
      await runs().abandon(runId);
    },
    holding: () => runs().holding(),
    openRemoval: async () => {
      const run = await runs().openRun();
      if (run === null) return null;
      if (run.undoes !== null) return restoreWork(run.undoes);
      return { kind: "strip", removal: await removalNow(run, install()) };
    },
    openRemovalAsSaved: async () => {
      const run = await runs().openRun();
      if (run === null) return null;
      if (run.undoes !== null) return restoreWork(run.undoes);
      return { kind: "strip", removal: removalOf(run, install().defaults) };
    },
    walk,
    carryOn: async budget => {
      const store = runs();
      const open = await store.openRun();
      // A run its save is still preparing is that save's to publish. One
      // older than any save takes is a save that stopped before publishing
      // it, its set stored or not: published here, its walk strips only the
      // ids the site does not define, so a set that never landed strips
      // nothing and the run closes.
      if (open?.preparing === true) {
        if (!staleWhilePreparing(open)) return;
        await store.publish(open.id);
      }
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
    publish: runId => runs().publish(runId),
    undo: async (runId, startedBy) => {
      const store = runs();
      const all = await store.runs();
      const run = all.find(candidate => candidate.id === runId);
      // Preconditions, before anything is opened.
      if (run === undefined || run.open || run.undoes !== null) {
        throw cannotUndo("not-a-done-removal", runId);
      }
      const newest = all
        .filter(candidate => candidate.undoes === null)
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
      if (newest?.id !== runId) throw cannotUndo("a-newer-removal", runId);
      if (all.some(candidate => candidate.undoes === runId)) {
        throw cannotUndo("already-undone", runId);
      }
      // Within the days what it took out is kept for, read from its id. Rows
      // are kept after the run opens, so they outlive this window, never the
      // other way round.
      const at = openedAt(runId);
      if (at === undefined || Date.now() - at >= FRAGMENTS_KEPT_DAYS * DAY_MS) {
        throw cannotUndo("past-its-window", runId);
      }
      return store.open([], { stored: null, emitted: null }, startedBy, runId);
    },
    kept: runId => fragmentStore(install().db).forRun(runId),
    undoSkipped: async undoRunId => {
      const run = await runs().runById(undoRunId);
      if (run === null || run.undoes === null) return [];
      return skippedDocuments(
        await fragmentStore(install().db).forRun(run.undoes),
        siteHostReader(install().site)
      );
    },
    keepFragment: row => fragmentStore(install().db).keep(row),
    discardFragment: id => fragmentStore(install().db).discard(id),
    purgeFragments: before => fragmentStore(install().db).purge(before),
  };
}
