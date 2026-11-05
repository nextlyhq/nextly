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

import type { RewriteReport } from "../host-rewrite/contract";
import { progressStore } from "../host-rewrite/progress";
import { rewriteHosts } from "../host-rewrite/rewrite";
import {
  siteHostReader,
  siteWalkSource,
  systemHostWriter,
  type DocumentSite,
  type RewriteSite,
} from "../host-rewrite/site";
import type { SiteStyleData } from "../site-style";

import {
  removalRunStore,
  type BreakpointRun,
  type HoldingRun,
} from "./run-store";
import { removalOf, stripBreakpointsStep, type Removal } from "./strip";

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
}

/** What the installed plugin hands the service. */
export interface RemovalInstall {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof removalRunStore>[1];
  /** The site, as every walk of its documents reads it. */
  readonly site: DocumentSite & Pick<RewriteSite, "defaultLocale">;
  /** The configured site style, which a stored `null` breakpoint set gives back. */
  readonly defaults: SiteStyleData | undefined;
}

/** What a call on a removal that is already done answers. */
const NOTHING_LEFT: RewriteReport = {
  rewritten: [],
  unchanged: [],
  left: [],
  caughtByFinalWalk: [],
  finished: true,
};

/** The service over the installed plugin, resolved per call. */
export function breakpointRemovalService(
  install: () => RemovalInstall
): BreakpointRemovalService {
  const runs = () => removalRunStore(install().db, install().dialect);
  return {
    openRun: () => runs().openRun(),
    runById: runId => runs().runById(runId),
    begin: (removedIds, before, startedBy) =>
      runs().open(removedIds, before, startedBy),
    abandon: runId => runs().abandon(runId),
    holding: () => runs().holding(),
    openRemoval: async () => {
      const run = await runs().openRun();
      return run === null ? null : removalOf(run, install().defaults);
    },
    walk: async (runId, budget) => {
      const store = runs();
      const run = await store.runById(runId);
      if (run === null) {
        throw NextlyError.notFound({
          logContext: { reason: "breakpoint-removal-no-run", runId },
        });
      }
      // A done run is walked again only for the documents it left, which
      // keep its ids from being defined again until they are stripped; with
      // none left it is closed, and values a breakpoint added since put back
      // are the site's own.
      if (!run.open && !(await store.reopen(runId))) return NOTHING_LEFT;
      const installed = install();
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
          step: stripBreakpointsStep(removalOf(run, installed.defaults)),
          ...(budget.maxDocuments === undefined
            ? {}
            : { maxDocuments: budget.maxDocuments }),
          ...(budget.deadline === undefined
            ? {}
            : { deadline: budget.deadline }),
        }
      );
    },
  };
}
