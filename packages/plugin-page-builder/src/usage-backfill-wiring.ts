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

import {
  blocksFieldSurvey,
  singleUsageDeclaration,
} from "./class-usage-blocks-fields";
import {
  walkPageBuilderUsageIndexes,
  type ClassUsageRebuildReport,
} from "./class-usage-index-rebuild";
import { classUsageIndex } from "./class-usage-reconcile";
import {
  singleRebuildDocumentStore,
  usageRebuildDocumentStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";
import { componentUsageIndex } from "./component-usage";
import type { SingleToWalk } from "./host-rewrite/site";
import { lastIdOf } from "./paged-walk";
import type { BackfillStateStore } from "./usage-backfill";
import type { GoneScopeRun, UsageBackfillDeps } from "./usage-backfill-job";
import {
  backfillGeneration,
  backfillScopeKey,
  backfillScopesFor,
  GONE_SCOPES_SWEPT_KEY,
  type BackfillScope,
} from "./usage-backfill-scope";
import {
  forgetScopeProgress,
  type UsageBookkeeping,
  type UsageRun,
} from "./usage-bookkeeping";
import type { UsageRowReader } from "./usage-count";
import {
  fencedUsageTableStore,
  forgetUsageRows,
  usageTableOf,
  usageTableRows,
  type UsageDb,
  type UsageTable,
} from "./usage-index-tables";

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
   * Every live Single whose declaration holds a blocks field, or `undefined`
   * when the Singles registry could not be read whole, which is a refusal for
   * the reason an unreadable collection registry is one.
   */
  singles: () => Promise<readonly SingleToWalk[] | undefined>;
  /** The site's configured locales, read per pass. */
  locales: () => readonly string[];
  /** The bounds the renderer draws under. */
  limits: () => DocumentLimits;
  /** The plugin's own database, which the index rows live in. */
  db: UsageDb;
  /** The run, its progress and the dirty mark, in the plugin's own tables. */
  bookkeeping: () => UsageBookkeeping;
}

/** The derivation the host's index is built under, read now. */
export function hostGeneration(host: BackfillHost): string {
  return backfillGeneration({
    limits: host.limits(),
    classIndex: usageTableOf(classUsageIndex).name,
    componentIndex: usageTableOf(componentUsageIndex).name,
  });
}

/**
 * One run's progress, as the pure backfill reads and writes it.
 *
 * Every write goes through the run's token, so once a newer run has started
 * each of them is refused. The cursors and the completed set are the ones the
 * run started with, kept current as this pass moves them.
 */
function runStateStore(
  bookkeeping: UsageBookkeeping,
  run: UsageRun
): BackfillStateStore {
  const done = new Set(run.done);
  const cursors = new Map(run.cursors);
  return {
    completed: () => Promise.resolve(done),
    record: async key => {
      await bookkeeping.complete(run.token, key);
      done.add(key);
      cursors.delete(key);
    },
    cursorOf: key => cursors.get(key),
    checkpoint: async (key, cursor) => {
      await bookkeeping.checkpoint(run.token, key, cursor);
      cursors.set(key, cursor);
    },
    fenced: write => bookkeeping.fenced(run.token, write),
    // Nothing to clear on a clean run, and nothing written: a finished site's
    // sweep stays a read.
    finish: async () => {
      if (run.dirty) await bookkeeping.finish(run.token);
    },
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
   * Whether any tracked collection or Single declares a blocks field no scope
   * can cover.
   *
   * A blocks field nested under a named group has no addressable subject, so no
   * scope is enumerated for it and no hook reconciles it — see
   * {@link blocksFieldSurvey}. Nothing else reports it, so "every scope walked"
   * would be vacuously true for a document whose only blocks field is nested,
   * and health would call an index that never saw those references exact.
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
    // is an ordinary event, and its rows are cleared once the run has walked
    // every scope, as any gone scope's are (`forgetGoneScopes`).
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

  const singles = await host.singles();
  if (singles === undefined) {
    throw new Error(
      "[page-builder] the usage backfill could not read the Singles registry, so it cannot tell an unindexed Single from a site that has none"
    );
  }
  for (const single of singles) {
    const survey = blocksFieldSurvey(singleUsageDeclaration(single));
    if (survey.unaddressable) unaddressable = true;
    // Both forms, whatever the Single's versioning: the registry listing does
    // not say whether a Single keeps a working draft, and the draft read
    // answers absent for one that does not, which records nothing.
    scopes.push(
      ...backfillScopesFor({
        scope: "single",
        collection: single.slug,
        fields: survey.addressable,
        locales,
        hasDrafts: true,
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
    state: async () => {
      // The generation is read PER PASS, like every other host accessor: a
      // host can reconfigure the bounds while a backfill is in flight, and the
      // pass that notices starts a new run, which fences the old one's writes.
      const bookkeeping = host.bookkeeping();
      return runStateStore(
        bookkeeping,
        await bookkeeping.begin(hostGeneration(host))
      );
    },
    rebuild: async (scope, walk) => {
      const nextly = await host.nextly();
      const { report, finished } = await walkPageBuilderUsageIndexes(
        {
          documents:
            scope.scope === "single"
              ? singleRebuildDocumentStore(nextly)
              : usageRebuildDocumentStore(nextly),
          // Fenced by the run: a pass a newer run replaced writes nothing.
          classIndex: fencedUsageTableStore(
            host.db,
            usageTableOf(classUsageIndex),
            write => walk.fenced(write)
          ),
          componentIndex: fencedUsageTableStore(
            host.db,
            usageTableOf(componentUsageIndex),
            write => walk.fenced(write)
          ),
          scope: scope.scope,
          collection: scope.entity,
          field: scope.field,
          locale: scope.locale,
          variant: scope.variant,
          // The SAME bounds the renderer draws under. Deriving the index under
          // different ones records a different document than the page serves.
          limits: host.limits(),
        },
        walk
      );

      refuseIncompleteWalk(scope, report);
      return { finished };
    },
  };
}

/**
 * Remove the rows and progress of every scope that no scope existing now
 * names: a collection or Single removed from the site, a blocks field it no
 * longer has, drafts it no longer keeps, a language it no longer stores the
 * field in. No walk visits those rows, so without this they would keep
 * counting towards their components and classes for good, and a component
 * they name could never be deleted; and the progress left behind would read
 * a scope that comes back as already walked.
 *
 * Asked only once every scope has been walked, from the scopes that pass
 * read, so content a registry could not list is never taken for gone:
 * reading a registry failed the pass before this point. The registries are
 * read again here and a scope either reading names is kept, so content made
 * while the pass walked is not taken for gone either. Every row is read, to
 * the end of each table. Each gone scope's rows in both indexes, and the
 * progress recorded for it, are removed in one transaction fenced by the
 * run, so a scope that comes back is walked again rather than read as
 * walked.
 *
 * Every run sweeps once, on the pass that finds every scope walked, and
 * records that it has in its progress: a run with nothing left to walk, such
 * as one started over a site whose last blocks field is gone, sweeps all the
 * same, since no progress of a new run says the tables are clean. After that
 * a pass reads nothing unless a scope the run recorded is gone, so a site
 * whose content stays put pays no table read per pass.
 */
export async function forgetGoneScopes(
  host: BackfillHost,
  scopes: readonly BackfillScope[],
  fenced: BackfillStateStore["fenced"],
  run: GoneScopeRun,
  /** How each table's rows are read; another reader only in a test. */
  rowsOf: (table: UsageTable) => UsageRowReader = table =>
    usageTableRows(host.db, table)
): Promise<void> {
  const named = new Set(scopes.map(backfillScopeKey));
  const recordedGone = [...run.completed].filter(
    key => key !== GONE_SCOPES_SWEPT_KEY && !named.has(key)
  );
  const swept = run.completed.has(GONE_SCOPES_SWEPT_KEY);
  if (swept && recordedGone.length === 0) return;
  const live = new Set([
    ...named,
    ...(await backfillScopes(host)).map(backfillScopeKey),
  ]);
  const tables = [
    usageTableOf(classUsageIndex),
    usageTableOf(componentUsageIndex),
  ];
  const gone = new Map<string, BackfillScope | null>();
  for (const key of recordedGone) {
    if (!live.has(key)) gone.set(key, null);
  }
  for (const table of tables) {
    for (const scope of await goneScopes(rowsOf(table), live)) {
      gone.set(backfillScopeKey(scope), scope);
    }
  }
  for (const [key, scope] of gone) {
    await fenced(async tx => {
      // A scope known only from its progress has no rows: the tables were
      // read to their end and named none.
      if (scope !== null) {
        for (const table of tables) {
          await forgetUsageRows(tx, table, {
            scope: { equals: scope.scope },
            entity: { equals: scope.entity },
            field: { equals: scope.field },
            locale: { equals: scope.locale },
            variant: { equals: scope.variant },
          });
        }
      }
      await forgetScopeProgress(tx, key);
    });
  }
  if (!swept) await run.markSwept();
}

/**
 * The scopes a table holds rows for that are not among `live`, of either
 * kind, read to the table's end a page at a time by id. Collected whole
 * before any is removed.
 */
export async function goneScopes(
  rows: UsageRowReader,
  live: ReadonlySet<string>
): Promise<BackfillScope[]> {
  const gone = new Map<string, BackfillScope>();
  let after: string | undefined;
  for (let page = 1; ; page += 1) {
    const found = await rows({
      where: {},
      page,
      ...(after === undefined ? {} : { after }),
    });
    for (const scope of found.items.map(scopeOfRow)) {
      if (scope !== null && !live.has(backfillScopeKey(scope))) {
        gone.set(backfillScopeKey(scope), scope);
      }
    }
    const next = lastIdOf(found.items);
    if (!found.hasNext) return [...gone.values()];
    // A page that names no id to resume after cannot move the read on, and
    // reading it again would never end: refused, so the run does not finish
    // and health stays not whole.
    if (next === undefined || next === after) {
      throw new Error(
        "[page-builder] the usage index's rows could not be read to their end, so the rows of scopes that are gone were not all removed"
      );
    }
    after = next;
  }
}

/** The scope a stored row is filed under, or `null` for one this cannot read. */
function scopeOfRow(item: unknown): BackfillScope | null {
  if (typeof item !== "object" || item === null) return null;
  const row = item as Record<string, unknown>;
  const scope = scopeKindOf(row.scope);
  const names = subjectNamesOf(row);
  const variant = variantOf(row.variant);
  return scope === null || names === null || variant === null
    ? null
    : { scope, ...names, variant };
}

/** A row's `scope` column, when it names one of the two kinds. */
function scopeKindOf(value: unknown): BackfillScope["scope"] | null {
  return value === "collection" || value === "single" ? value : null;
}

/** A row's `variant` column, when it names one of the two forms. */
function variantOf(value: unknown): BackfillScope["variant"] | null {
  return value === "published" || value === "draft" ? value : null;
}

/** A row's document, field and language columns, when each is a string. */
function subjectNamesOf(
  row: Record<string, unknown>
): Pick<BackfillScope, "entity" | "field" | "locale"> | null {
  const { entity, field, locale } = row;
  return typeof entity === "string" &&
    typeof field === "string" &&
    typeof locale === "string"
    ? { entity, field, locale }
    : null;
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

  const where = `${scope.scope === "single" ? "Single " : ""}${scope.entity}.${scope.field} (${scope.locale || "shared"}, ${scope.variant})`;
  throw new Error(
    `[page-builder] the usage backfill could not walk ${where} whole — ` +
      `${report.unrepaired} unrepaired — ` +
      "so the scope is left outstanding rather than recorded as finished",
    report.failure === undefined ? undefined : { cause: report.failure }
  );
}
