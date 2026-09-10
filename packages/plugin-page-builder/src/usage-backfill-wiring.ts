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
import { rebuildPageBuilderUsageIndexes } from "./class-usage-index-rebuild";
import {
  classUsageIndexStore,
  usageBackfillStateStore,
  usageRebuildDocumentStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";
import type { UsageBackfillDeps } from "./usage-backfill-job";
import { backfillScopesFor, type BackfillScope } from "./usage-backfill-scope";

/** What the wiring must be able to ask of the host, named structurally. */
export interface BackfillHost {
  /** The trusted Direct API, resolved per pass rather than captured. */
  nextly: () => ClassUsageDirectApi;
  /** Every collection slug the site declares. */
  collectionSlugs: () => readonly string[] | undefined;
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
  const slugs = host.collectionSlugs();
  if (slugs === undefined) {
    throw new Error(
      "[page-builder] the usage backfill could not enumerate the site's collections, so it cannot tell an unindexed scope from a site that has none"
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
      usageBackfillStateStore(host.nextly(), host.slugs().backfillState),
    rebuild: async scope => {
      const nextly = host.nextly();
      const slugs = host.slugs();
      await rebuildPageBuilderUsageIndexes({
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
    },
  };
}
