/**
 * Turning the plugin's context into the three things a backfill pass needs.
 *
 * `usage-backfill` decides WHAT to walk next and `usage-backfill-job` decides
 * how much of a tick to spend; neither knows how to reach a database. This is
 * the one place that resolves the site's configuration into scopes and binds
 * the stores, so everything that knows how a backfill addresses the world lives
 * together - the same split `class-usage-runtime` makes for the write path.
 *
 * @module usage-backfill-wiring
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import {
  rebuildPageBuilderUsageIndexes,
  type ClassUsageRebuildReport,
} from "./class-usage-index-rebuild";
import {
  classUsageIndexStore,
  usageBackfillStateStore,
  usageRebuildDocumentStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";
import type { UsageBackfillDeps } from "./usage-backfill-job";
import {
  backfillGeneration,
  backfillScopesFor,
  type BackfillScope,
} from "./usage-backfill-scope";

/** What the wiring must be able to ask of the host, named structurally. */
export interface BackfillHost {
  /** The trusted Direct API, resolved per pass rather than captured. */
  nextly: () => ClassUsageDirectApi;
  /**
   * Every collection slug that EXISTS, from the live registry.
   *
   * Not the configured list. `class-usage-hook` opens by saying the set of
   * collections is not known when a plugin is wired, which is why the write
   * path registers on the wildcard rather than per collection — the Schema
   * Builder creates collections at runtime, and those live only in the
   * registry. A backfill enumerating the configured set therefore walks a
   * NARROWER population than the hooks maintain, and it is the half that
   * decides readiness, so the index reports itself whole while a Builder-made
   * collection's existing documents have no rows at all.
   *
   * The registry is a superset rather than a different set: code-first
   * collections are synced into it with `source: "code"`, so reading it loses
   * none of them.
   *
   * `undefined` means the registry could not be read, which is a refusal — see
   * {@link backfillScopes}.
   */
  collectionSlugs: () => Promise<readonly string[] | undefined>;
  /** The resolved registry record for one slug, or null when it is gone. */
  resolveCollection: (slug: string) => Promise<unknown>;
  /** Whether a resolved collection stores a draft beside its published row. */
  hasDrafts: (collection: unknown) => Promise<boolean> | boolean;
  /** The site's configured locales, read per pass. */
  locales: () => readonly string[];
  /** The bounds the renderer draws under. */
  limits: () => DocumentLimits;
  /** The RESOLVED slugs of the three collections a pass writes to or reads. */
  slugs: () => {
    classIndex: string;
    componentIndex: string;
    backfillState: string;
  };
}

/**
 * Every scope the site currently has, or a REFUSAL.
 *
 * Throws rather than answering an empty list when the collections cannot be
 * enumerated, and that is the whole reason this is a function rather than a
 * field. An empty list is a legitimate answer - a site with no blocks field
 * anywhere - and `backfillComplete` reads it as FINISHED. So a configuration
 * this cannot read would report the index fully backfilled, which is the exact
 * confident-zero the backfill exists to remove, arriving through the mechanism
 * built to prevent it.
 *
 * A throw fails the pass instead, and the sweep retries: the queue is durable,
 * so refusing costs a tick and claims nothing.
 */
export async function backfillScopes(
  host: BackfillHost
): Promise<readonly BackfillScope[]> {
  const slugs = await host.collectionSlugs();
  if (slugs === undefined) {
    throw new Error(
      "[page-builder] the usage backfill could not read the collection registry, so it cannot tell an unindexed scope from a site that has none"
    );
  }

  const locales = host.locales();
  const scopes: BackfillScope[] = [];

  for (const slug of slugs) {
    const collection = await host.resolveCollection(slug);
    // A slug the registry no longer resolves contributes no scopes. Skipped
    // rather than refused: a collection removed while a backfill is in flight
    // is an ordinary event, and its rows are the delete hook's to clear.
    if (collection === null || collection === undefined) continue;

    const fields = blocksFieldsOf(collection);
    // Asked BEFORE the field check would be wasteful, and asked at all only
    // for collections that actually carry a blocks field: the draft split is a
    // read, and a site's other collections are the majority.
    if (fields.length === 0) continue;

    scopes.push(
      ...backfillScopesFor({
        collection: slug,
        fields,
        locales,
        hasDrafts: await host.hasDrafts(collection),
      })
    );
  }

  return scopes;
}

/**
 * Bind the pass to real stores.
 *
 * Every accessor is called PER PASS rather than captured once. A host can
 * reconfigure locales and limits, collections come and go, and the Direct API
 * is not resolvable until services are registered - so a value captured when
 * the plugin was defined is a value from before the site finished booting.
 */
export function usageBackfillDeps(host: BackfillHost): UsageBackfillDeps {
  return {
    scopes: () => backfillScopes(host),
    state: () =>
      usageBackfillStateStore(
        host.nextly(),
        host.slugs().backfillState,
        // Read PER PASS, like every other host accessor: a host can reconfigure
        // the bounds while a backfill is in flight, and the pass that notices
        // should be the next one rather than whichever one happened to build
        // the store.
        backfillGeneration(host.limits())
      ),
    rebuild: async scope => {
      const nextly = host.nextly();
      const slugs = host.slugs();
      const report = await rebuildPageBuilderUsageIndexes({
        documents: usageRebuildDocumentStore(nextly),
        classIndex: classUsageIndexStore(nextly, slugs.classIndex),
        componentIndex: classUsageIndexStore(nextly, slugs.componentIndex),
        collection: scope.entity,
        field: scope.field,
        locale: scope.locale,
        variant: scope.variant,
        // The SAME bounds the renderer draws under. Deriving the index under
        // different ones records a different document than the page serves.
        limits: host.limits(),
      });

      refuseIncompleteWalk(scope, report);
    },
  };
}

/**
 * Refuse a walk that did not finish, so its scope is not recorded as done.
 *
 * `rebuildPageBuilderUsageIndexes` RESOLVES on a partial repair — it returns
 * what happened rather than throwing, because a rebuild is also run as a repair
 * where a caller wants the counts. A backfill cannot use that answer the same
 * way: the next thing it does is write a row saying this scope is finished, and
 * no later pass revisits a recorded scope. So a resolved-but-partial walk is
 * recorded permanently, and every count over it then reads as whole while the
 * documents it missed have no rows at all.
 *
 * Throwing is what leaves the scope outstanding. The sweep is re-queued and the
 * queue is durable, so refusing costs a tick and claims nothing.
 *
 * Three fields say a walk did not finish, and only the first is an error:
 *
 * - `failure` — a target write or an orphan sweep rejected.
 * - `unrepaired` — documents whose rows could not be brought into agreement.
 * - `undetermined` — documents that could not be read whole. These DO leave a
 *   marker behind, so a count over them already reports itself a floor; they
 *   are refused anyway because a scope recorded as done is never walked again,
 *   and a document that was merely too big for one pass may be readable on the
 *   next.
 *
 * Refusing only on `failure` would leave the narrower version of exactly the
 * defect this exists to prevent.
 */
function refuseIncompleteWalk(
  scope: BackfillScope,
  report: ClassUsageRebuildReport
): void {
  if (
    report.failure === undefined &&
    report.unrepaired === 0 &&
    report.undetermined === 0
  ) {
    return;
  }

  const where = `${scope.entity}.${scope.field} (${scope.locale || "shared"}, ${scope.variant})`;
  throw new Error(
    `[page-builder] the usage backfill could not walk ${where} whole — ` +
      `${report.unrepaired} unrepaired, ${report.undetermined} undetermined — ` +
      "so the scope is left outstanding rather than recorded as finished",
    report.failure === undefined ? undefined : { cause: report.failure }
  );
}
