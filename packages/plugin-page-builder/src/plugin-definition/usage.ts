/**
 * Usage and counting: the usage indexes as the routes and the counts read
 * them (one index as the shared-style and variable routes read it, the pages
 * the variable index does not cover, the count after a migrate or an install,
 * and how many documents place a component), the index maintenance `init`
 * registers, and the overview's route.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import {
  type PluginRoute,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
} from "@nextlyhq/plugin-sdk";

import { registerClassUsageMaintenance } from "../class-usage-hook";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { componentUsageCount, componentUsageIndex } from "../component-usage";
import type { SharedStyleUsageKind } from "../library-contract";
import { overviewRoute } from "../overview/route";
import {
  joinedCount,
  type SharedStyleUsageSource,
  type UsageCountJobs,
  storedIdsAfter,
  storedPageForms,
} from "../shared-styles-routes";
import { tokenUsageIndex } from "../token-usage";
import { type UncoveredPages, uncoveredPagesFrom } from "../uncovered-pages";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import { backfillSurvey } from "../usage-backfill-wiring";
import { usageBookkeeping } from "../usage-bookkeeping";
import { listDocumentsUsingEach, type UsageCount } from "../usage-count";
import type { countThePages } from "../usage-count-after-migrate";
import { usageHealthService } from "../usage-health-service";
import type { UsageIndex, UsageSubject } from "../usage-index";
import {
  usageIndexStores,
  usageTableOf,
  usageTableRows,
} from "../usage-index-tables";

import { type InitContext, liveSingle } from "./install-context";
import { componentStoreOf } from "./options";
import type { Definition } from "./state";

/** The usage indexes as the routes, the counts and `init` read them. */
export interface UsageParts {
  readonly pagesCountOf: (ctx: {
    services: { jobs: UsageCountJobs };
    logger: { info: (message: string) => void };
  }) => Parameters<typeof countThePages>[0];
  readonly uncoveredPagesOf: (
    ctx: Parameters<typeof storedPageForms>[0]
  ) => UncoveredPages;
  readonly usageSourceOf: <TRow extends UsageSubject>(
    collections: Readonly<Record<string, string | undefined>>,
    index: UsageIndex<TRow>,
    jobs: UsageCountJobs
  ) => SharedStyleUsageSource;
  readonly countPlacements: () => (id: string) => Promise<UsageCount>;
}

/** The usage readers over the definition's installed context. */
export function usageParts(def: Definition): UsageParts {
  const { opts, state, requireInstalled, bootedNextly } = def;
  /**
   * One usage index as the shared-style and variable routes read it: its
   * health, the documents using each reference in one bounded read, and which
   * kind of document a collection holds. The composition stores are
   * components, patterns and Layouts; every other collection with a page
   * builder field holds pages, as the editor's page search reads them.
   */
  /**
   * What the count after a migrate or an install runs on: the context's own
   * jobs, the variable index's health, and the context's log.
   */
  const pagesCountOf = (ctx: {
    services: { jobs: UsageCountJobs };
    logger: { info: (message: string) => void };
  }) => ({
    sweep: (maxDurationMs: number) =>
      ctx.services.jobs.runSweepNow(USAGE_BACKFILL_JOB, { maxDurationMs }),
    health: () => usageHealthService(requireInstalled).read(tokenUsageIndex),
    log: (message: string) => ctx.logger.info(`[page-builder] ${message}`),
  });
  /**
   * The pages the variable index does not cover, from its own records: its
   * undetermined marker rows, and the types its survey cannot address. Read
   * as the system, as the rescan reads stored documents (`uncovered-pages`).
   */
  const uncoveredPagesOf = (
    ctx: Parameters<typeof storedPageForms>[0]
  ): UncoveredPages =>
    uncoveredPagesFrom({
      rows: args =>
        usageTableRows(
          requireInstalled().db,
          usageTableOf(tokenUsageIndex)
        )(args),
      markers: tokenUsageIndex.whereUndetermined(),
      unaddressable: async () =>
        (await backfillSurvey(requireInstalled())).unaddressableTypes,
      idsAfter: async (collection, after) =>
        storedIdsAfter(await bootedNextly())(collection, after),
      forms: async page => storedPageForms(ctx, await bootedNextly())(page),
    });
  const usageSourceOf = <TRow extends UsageSubject>(
    collections: Readonly<Record<string, string | undefined>>,
    index: UsageIndex<TRow>,
    // The context's jobs, which run the usage backfill now: the count a
    // removal makes before it judges an index that is not whole.
    jobs: UsageCountJobs
  ): SharedStyleUsageSource => {
    const kinds = new Map<string, SharedStyleUsageKind>([
      [
        componentStoreOf(opts).collection ??
          collections[COMPONENTS_SLUG] ??
          COMPONENTS_SLUG,
        "components",
      ],
      [collections[PATTERNS_SLUG] ?? PATTERNS_SLUG, "patterns"],
      [collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG, "layouts"],
    ]);
    return {
      health: () => usageHealthService(requireInstalled).read(index),
      // One bounded read for a whole page of references.
      documentsUsingEach: async (ids, health) =>
        listDocumentsUsingEach({
          index,
          rows: usageTableRows(requireInstalled().db, usageTableOf(index)),
          referenceIds: ids,
          health,
        }),
      kindOf: collection => kinds.get(collection) ?? "pages",
      // One count at a time in this process, which every removal joins
      // (`joinedCount`): the first context's jobs run it, as any context's
      // run the sweep on the same instance.
      countNow: maxDurationMs => {
        state.usageCountNow ??= joinedCount(budget =>
          jobs.runSweepNow(USAGE_BACKFILL_JOB, { maxDurationMs: budget })
        );
        return state.usageCountNow(maxDurationMs);
      },
    };
  };
  /**
   * How many documents place a component directly, from the usage index: the
   * number the removal dialog says, and the one a hold counts again. The
   * index rows live in the plugin's own tables, so no route context is read.
   */
  const countPlacements = () => async (id: string) => {
    const health = usageHealthService(requireInstalled);
    return componentUsageCount({
      read: health.counts(componentUsageIndex),
      componentId: id,
      health: await health.read(componentUsageIndex),
    });
  };
  return { pagesCountOf, uncoveredPagesOf, usageSourceOf, countPlacements };
}

/**
 * The class and variable usage indexes kept current on every write, and the
 * reconciler for a write made in a transaction the caller owns.
 */
export function installUsageMaintenance(
  ctx: InitContext,
  def: Definition
): void {
  const { opts, state, usage } = def;
  usage.reconcile = registerClassUsageMaintenance({
    ctx,
    // Both indexes' rows, in the plugin's own tables.
    stores: () => usageIndexStores(ctx.db),
    // A saved Single's declaration, from the Singles registry, which
    // reads it without creating the Single's document.
    single: slug => liveSingle(ctx, slug),
    // The registry record, projected. `getCollection` is declared to
    // return a shape that promises none of the properties this question
    // reads, while returning an object that carries all of them.
    draftSplit: (collection: unknown) =>
      resolvedCollectionDraftSplit(resolvedCollectionView(collection)),
    // Read per call, not captured: a host can reconfigure either, and a
    // value captured at install would keep deriving rows under bounds the
    // renderer no longer applies.
    locales: () =>
      ctx.config.localization?.locales.map(locale => locale.code) ?? [],
    // The SAME bounds the renderer draws under. Deriving the index under
    // different ones records a different document than the page serves:
    // raised bounds leave classes on the extra nodes unindexed, so a class
    // the page renders reads as unused.
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    // A failed write marks the index dirty, so health stops calling it
    // whole until a full rebuild has walked the site again.
    markDirty: () => usageBookkeeping(ctx.db, ctx.dialect).markDirty(),
    // A collection whose declaration holds no blocks field derives no
    // rows, known without reading it.
    mayHoldBlocks: collection => state.writeReach.mayHoldBlocks(collection),
  });
}

/** The routes usage and counting contribute, by name. */
export function routesForUsage(def: Definition): {
  readonly overview: PluginRoute;
} {
  const { opts } = def;
  return {
    // The overview's libraries and where the builder is used, as the
    // caller may see them.
    overview: overviewRoute(componentStoreOf(opts)),
  };
}
