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
  documentKeyOf,
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
import { checkStoredBreakpoints } from "../site-style-record";
import { readStoredJson, sameStoredValue } from "../stored-json";

import {
  fragmentCapture,
  fragmentStore,
  FRAGMENTS_KEPT_DAYS,
  type FragmentRow,
  type StoredFragment,
} from "./fragments";
import type { OpenWork, ValueRestore } from "./lock-acceptance";
import {
  fragmentSource,
  keptDocuments,
  keptForValue,
  restoreStep,
  skippedDocuments,
  type KeptRows,
  type ValueAddress,
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

/** What an undo that cannot be made is told, by why. */
const CANNOT_UNDO = {
  "not-a-done-removal":
    "This removal can't be undone: it isn't a finished breakpoint removal.",
  "a-newer-removal":
    "This removal can't be undone: only the newest removal can be, and a breakpoint was removed after it.",
  "already-undone": "This removal can't be undone: it was undone already.",
} as const;

/** A date as the person reads it: 6 December 2026. */
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The refusal of an undo, saying why in plain words and in the log: not a
 * done removal, a newer removal since, or undone already.
 */
function cannotUndo(
  reason: keyof typeof CANNOT_UNDO,
  runId: string
): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: CANNOT_UNDO[reason],
    logContext: { reason: `breakpoint-undo-${reason}`, runId },
  });
}

/** The refusal of an undo past its days, naming the day they ended. */
function pastItsWindow(runId: string, ended: number): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `This removal can't be undone: its ${FRAGMENTS_KEPT_DAYS} days to undo it ended on ${DAY.format(ended)}.`,
    logContext: { reason: "breakpoint-undo-past-its-window", runId },
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
  /**
   * Delete what removals took out before `before`: past their undo window.
   * What an undo is still putting back stays until it is done.
   */
  purgeFragments(before: Date): Promise<void>;
  /**
   * Open a run putting removal `runId` back, refusing (409) unless it can be
   * undone: it is a removal and done, it is the newest removal, it was not
   * undone already, and it was made within the 30 days what it took out is
   * kept for. The run takes the one open slot, preparing until its set is
   * stored (`publish`); walking it puts each kept value back (`restore`).
   */
  undo(
    runId: string,
    startedBy: string,
    /** The breakpoint set the undo is about to store, recorded on its run. */
    planned: unknown
  ): Promise<BreakpointRun>;
  /** Refuse (409) unless removal `runId` can be undone now, opening nothing. */
  assertUndoable(runId: string): Promise<void>;
  /** What removal `runId` kept of the shared styles; `null` for nothing. */
  keptSharedStyles(runId: string): Promise<StoredFragment | null>;
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
  /**
   * The breakpoints the site's stylesheet is emitted under now, read when
   * asked: how recovery tells an undo's own set landed from another save's.
   */
  readonly breakpointsNow: () => Promise<unknown>;
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
  const kept = keptRowsOf(installed.db, run.undoes);
  return rewriteHosts(
    {
      fence: store,
      progress: progressStore(installed.db, installed.dialect),
      source: fragmentSource(kept),
      read: siteHostReader(installed.site),
      write: systemHostWriter(installed.site),
    },
    { runId: run.runId, step: restoreStep(kept), ...budgetOf(budget) }
  );
}

/** A removal's kept rows, read a part at a time. */
function keptRowsOf(db: PluginDatabase, runId: string): KeptRows {
  const store = fragmentStore(db);
  return {
    valuesAfter: (after, limit) => store.valuesAfter(runId, after, limit),
    forDocument: documentKey => store.forDocument(runId, documentKey),
  };
}

/**
 * What an open undo puts back into one value, as its walk would write it:
 * the rows kept for that value, of the form the walk writes (the pending
 * draft where there is one, the live row otherwise, which a row with no
 * lifecycle keeps as `draft`), with that form's value as read now.
 */
async function restoreFor(
  installed: RemovalInstall,
  undoes: string,
  target: ValueAddress
): Promise<ValueRestore | undefined> {
  const rows = keptForValue(
    await fragmentStore(installed.db).forDocument(
      undoes,
      documentKeyOf(target)
    ),
    target,
    installed.site.defaultLocale()
  );
  const [first] = rows;
  if (first === undefined) return undefined;
  const read = await siteHostReader(installed.site)(first.host);
  const form =
    read.draft !== null || read.liveState === null ? "draft" : "published";
  const value = read.draft ?? read.published;
  if (value.kind !== "value") return undefined;
  return {
    current: readStoredJson(value.value),
    fragments: rows.filter(row => row.form === form).map(row => row.fragment),
  };
}

/**
 * The newest removal an undo is measured against: the newest run that is a
 * removal, published, and did something, which is one that kept what it took
 * out, or still claims a breakpoint the site does not define. A run whose save
 * stopped before its set landed is closed by the recovery having done nothing;
 * it is no removal, and does not stand in the way of undoing the one before.
 */
async function newestRemoval(
  all: readonly BreakpointRun[],
  keptAny: (runId: string) => Promise<boolean>,
  defined: () => Promise<ReadonlySet<string>>
): Promise<BreakpointRun | undefined> {
  const removals = all
    .filter(run => run.undoes === null && !run.preparing)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  for (const run of removals) {
    if (run.open || (await keptAny(run.id))) return run;
    const now = await defined();
    if (run.removedIds.some(id => !now.has(id))) return run;
  }
  return undefined;
}

/**
 * Whether an undo whose request stopped while it was preparing stored its set:
 * the site's breakpoints are now exactly the set it planned (recorded on its
 * run when it opened), so another save that happens to define the same ids is
 * not taken for it. Published only then, so values are never put back under
 * breakpoints the undo did not define.
 */
async function undoLanded(
  installed: RemovalInstall,
  undo: BreakpointRun
): Promise<boolean> {
  if (undo.before === null) return false;
  // Both read as the Single's own check reads a set, so only what defines the
  // breakpoints (ids, labels, widths, axes) is compared.
  const now = checkStoredBreakpoints(await installed.breakpointsNow()).value;
  const planned = checkStoredBreakpoints(undo.before).value;
  return planned !== undefined && sameStoredValue(now, planned);
}

/**
 * Whether removal `runId` can be undone now: it is a finished removal, the
 * newest one (`newestRemoval`), not undone already, and within the days what
 * it took out is kept for, read from its id. Rows are kept after the run
 * opens, so they outlive this window, never the other way round. Answers the
 * refusal to throw, or when the window ends.
 */
async function undoJudged(
  installed: RemovalInstall,
  all: readonly BreakpointRun[],
  runId: string
): Promise<{ refusal: NextlyError } | { refusal?: undefined; ends: number }> {
  const run = all.find(candidate => candidate.id === runId);
  if (run === undefined || run.open || run.undoes !== null) {
    return { refusal: cannotUndo("not-a-done-removal", runId) };
  }
  const newest = await newestRemoval(
    all,
    id => fragmentStore(installed.db).keptAny(id),
    installed.definedBreakpoints
  );
  if (newest?.id !== runId) {
    return { refusal: cannotUndo("a-newer-removal", runId) };
  }
  if (all.some(candidate => candidate.undoes === runId)) {
    return { refusal: cannotUndo("already-undone", runId) };
  }
  const at = openedAt(runId);
  if (at === undefined) {
    return { refusal: cannotUndo("not-a-done-removal", runId) };
  }
  const ends = at + FRAGMENTS_KEPT_DAYS * DAY_MS;
  if (Date.now() >= ends) return { refusal: pastItsWindow(runId, ends) };
  return { ends };
}

/**
 * The removals whose kept rows the purge leaves: each one an undo is still
 * putting back (open, or holding a page it left), and each undone within the
 * window, whose undo still answers what it could not put back from them.
 */
function undoneRecently(all: readonly BreakpointRun[]): string[] {
  return all
    .filter(run => {
      if (run.undoes === null) return false;
      const at = openedAt(run.id);
      return (
        run.open ||
        at === undefined ||
        Date.now() - at < FRAGMENTS_KEPT_DAYS * DAY_MS
      );
    })
    .map(run => run.undoes)
    .filter((undoes): undoes is string => undoes !== null);
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
      // What it kept records a strip that never landed, or one its defined
      // ids took back: nothing to put back, so it does not stand as a
      // removal an undo is measured against. Not while an undo reads it.
      const undone = (await store.runs()).some(
        other => other.undoes === run.id
      );
      if (!undone) await fragmentStore(installed.db).forget(run.id);
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
    const site = await fragmentStore(installed.db).sharedStyles(undoes);
    const undone = await runs().runById(undoes);
    return {
      kind: "restore",
      restoreFor: target => restoreFor(installed, undoes, target),
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
        // An undo is published only once its set is stored: its walk puts
        // values back whatever the site defines, so one whose set never
        // landed is dropped, and can be made again.
        if (open.undoes !== null && !(await undoLanded(install(), open))) {
          await store.abandon(open.id);
          return;
        }
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
    assertUndoable: async runId => {
      const judged = await undoJudged(install(), await runs().runs(), runId);
      if (judged.refusal !== undefined) throw judged.refusal;
    },
    undo: async (runId, startedBy, planned) => {
      const store = runs();
      // Preconditions, before anything is opened.
      const judged = await undoJudged(install(), await store.runs(), runId);
      if (judged.refusal !== undefined) throw judged.refusal;
      // The set it is about to store is recorded with it, for recovery.
      return store.open(
        [],
        { stored: planned, emitted: null },
        startedBy,
        runId
      );
    },
    keptSharedStyles: runId => fragmentStore(install().db).sharedStyles(runId),
    undoSkipped: async undoRunId => {
      const run = await runs().runById(undoRunId);
      if (run === null || run.undoes === null) return [];
      return skippedDocuments(
        keptDocuments(keptRowsOf(install().db, run.undoes), null),
        siteHostReader(install().site)
      );
    },
    keepFragment: row => fragmentStore(install().db).keep(row),
    discardFragment: id => fragmentStore(install().db).discard(id),
    // Not the rows of a removal an undo is still putting back, open or
    // holding a document it left: its walk reads them until it is done.
    purgeFragments: async before => {
      const store = runs();
      const keep = new Set(undoneRecently(await store.runs()));
      // A run holding a page it left is carried on later: its rows stay too.
      for (const held of await store.holding()) {
        if (held.run.undoes !== null) keep.add(held.run.undoes);
      }
      await fragmentStore(install().db).purge(before, [...keep]);
    },
  };
}
