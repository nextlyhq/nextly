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

import { blocksFieldSurvey } from "./class-usage-blocks-fields";
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
  /**
   * The Direct API, resolved when a pass actually needs it.
   *
   * A PROMISE because the plugin entry that supplies it must not import
   * `nextly/runtime` at module scope: that entry is isomorphic and reachable
   * from a browser bundle, and the runtime graph reaches a dozen Node built-ins.
   */
  nextly: () => Promise<ClassUsageDirectApi>;
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
  /**
   * Whether any Single declares a blocks field.
   *
   * A Single's content cannot be indexed at all — a plugin has no supported way
   * to READ one, since the available path creates the row when it is absent, so
   * `writeTargetOf` declines every `single:` hook and no scope is enumerated.
   * The backfill therefore cannot make the index cover such a site however many
   * collection scopes it finishes, and completeness must not claim otherwise.
   */
  singlesHoldBlocks: () => Promise<boolean>;
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
  return (await backfillSurvey(host)).scopes;
}

/** What one registry walk found: the scopes, and whether any content is out of reach. */
export interface BackfillSurvey {
  scopes: readonly BackfillScope[];
  /**
   * Whether any tracked collection declares a blocks field no scope can cover.
   *
   * A blocks field nested under a named group has no addressable subject, so no
   * scope is enumerated for it and no hook reconciles it — see
   * {@link blocksFieldSurvey}. Unlike a Single, nothing else reports it, so
   * "every scope walked" would be vacuously true for a collection whose only
   * blocks field is nested, and health would call an index that never saw those
   * references exact.
   *
   * Answered from the SAME walk that builds the scopes, because a second walk
   * over the registry is a second answer to one question and would also double
   * the registry reads a health render costs.
   */
  unaddressable: boolean;
}

/**
 * The scopes a backfill must cover, and what it cannot reach, in one walk.
 *
 * {@link backfillScopes} is the narrow view, derived from this.
 */
export async function backfillSurvey(
  host: BackfillHost
): Promise<BackfillSurvey> {
  const slugs = await host.collectionSlugs();
  if (slugs === undefined) {
    throw new Error(
      "[page-builder] the usage backfill could not read the collection registry, so it cannot tell an unindexed scope from a site that has none"
    );
  }

  const locales = host.locales();
  const scopes: BackfillScope[] = [];
  let unaddressable = false;

  for (const slug of slugs) {
    const collection = await host.resolveCollection(slug);
    // A slug the registry no longer resolves contributes no scopes. Skipped
    // rather than refused: a collection removed while a backfill is in flight
    // is an ordinary event, and its rows are the delete hook's to clear.
    if (collection === null || collection === undefined) continue;

    const survey = blocksFieldSurvey(collection);
    const fields = survey.addressable;
    // Recorded before the early return below, so a collection whose ONLY blocks
    // field is nested — which contributes no scope — still reports that the
    // index cannot cover it.
    if (survey.unaddressable) unaddressable = true;
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

  return { scopes, unaddressable };
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
    state: async () =>
      usageBackfillStateStore(
        await host.nextly(),
        host.slugs().backfillState,
        // Read PER PASS, like every other host accessor: a host can reconfigure
        // the bounds while a backfill is in flight, and the pass that notices
        // should be the next one rather than whichever one happened to build
        // the store.
        backfillGeneration({
          limits: host.limits(),
          classIndex: host.slugs().classIndex,
          componentIndex: host.slugs().componentIndex,
        })
      ),
    rebuild: async scope => {
      const nextly = await host.nextly();
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
 * ## What refuses, and why `undetermined` does NOT
 *
 * `failure` and `unrepaired` leave NO TRACE in the index. A target write that
 * rejected, or a document whose rows could not be brought into agreement, is
 * simply missing — and nothing downstream can tell a missing row from a
 * document that references nothing. Those must refuse, or the scope is recorded
 * over a hole nobody can see.
 *
 * `undetermined` is the opposite case and refusing it was a mistake worth
 * naming, because it was made HERE while fixing the first two. A document that
 * exceeds its walk bound leaves an `unreadable` MARKER, and `readUsageIndexHealth`
 * reads those — so the index already reports itself incomplete, by a mechanism
 * that survives the scope being recorded.
 *
 * Refusing it as well produced a worse failure than the one being fixed.
 * Exceeding a bound is DETERMINISTIC: the same document exceeds it on every
 * pass, so the scope could never be recorded, the sweep re-queued for ever, and
 * every drain rescanned the whole collection — a backfill that cannot finish,
 * monopolising a queue it shares with every other job. The marker is what makes
 * recording safe, and a later save or a change of limits generation is what
 * makes the document readable again.
 */
export function refuseIncompleteWalk(
  scope: BackfillScope,
  report: ClassUsageRebuildReport
): void {
  if (report.failure === undefined && report.unrepaired === 0) return;

  const where = `${scope.entity}.${scope.field} (${scope.locale || "shared"}, ${scope.variant})`;
  throw new Error(
    `[page-builder] the usage backfill could not walk ${where} whole — ` +
      `${report.unrepaired} unrepaired — ` +
      "so the scope is left outstanding rather than recorded as finished",
    report.failure === undefined ? undefined : { cause: report.failure }
  );
}
