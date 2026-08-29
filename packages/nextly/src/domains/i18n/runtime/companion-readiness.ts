/**
 * Whether an entity's companion `_locales` table is physically ready to be read and written.
 *
 * One question, asked by provisioning, by every localized write, and by the read-back that
 * populates a response. It used to be answered independently at each of those points, by querying
 * the database — an uncached existence probe per write, plus a full introspection whenever that
 * probe came back negative. An entry whose dynamic zone holds K distinct localized field-group
 * types paid `1 + K` round trips before its transaction and K more inside it. Local SQLite hides
 * that; managed PostgreSQL at a few milliseconds' latency does not, and the cost grows with the
 * complexity of the content, which is the wrong direction for a page builder.
 *
 * It is also the wrong layer. Physical readiness is schema state: it changes on sync, migrate and
 * boot, and essentially never per request.
 *
 * ## Three states, not a boolean
 *
 * A boolean would remove the existence probe and leave the introspection, which is most of the
 * cost — because "no companion" splits into two situations that want opposite behaviour.
 *
 * | State | Physical shape | What callers do |
 * |---|---|---|
 * | `ready` | companion exists | read and write through the companion |
 * | `pre-migration` | no companion, main still carries the translatable columns | the main-table fallback is legitimate |
 * | `broken` | no companion and main does not carry them | refuse, with an actionable remedy |
 *
 * ## Only `ready` is remembered
 *
 * Caching every answer would trade one problem for another: `db:sync` and `nextly migrate` run in
 * a different process from the server, so an in-memory verdict of `pre-migration` can outlive the
 * migration that made it wrong, and the window is no longer "between the check and the write" but
 * "until this process next reloads".
 *
 * So the verdict that is cached is the one that is both common and safe to be stale about.
 * `ready` is the healthy steady state, which is where the whole per-write cost lives, and it is
 * reached by creating a table — something no ordinary operation undoes. The abnormal states are
 * re-resolved every time, so an entity mid-transition keeps exactly the freshness it has today.
 * The result: zero queries on the path that matters, and no new staleness on the path that does
 * not.
 *
 * A `ready` verdict that has gone stale (the companion was dropped out from under a running
 * process) surfaces as a driver error on the next statement, not as silently misplaced content.
 * Provisioning paths that drop or replace a companion call {@link forgetCompanionReadiness}.
 *
 * ## Never resolved inside a transaction
 *
 * Resolving issues a query, and a query against a missing relation marks the whole PostgreSQL
 * transaction aborted — after which the real write dies with `current transaction is aborted` and
 * the reported error names an innocent statement. Callers already inside a transaction use
 * {@link cachedCompanionReadiness}, which cannot query. The write paths resolve before they open
 * one, so by the time the in-transaction read-back asks, the answer is already known.
 *
 * @module domains/i18n/runtime/companion-readiness
 */

import type { CompanionIntrospectAdapter } from "./companion-io";

export type CompanionReadiness = "ready" | "pre-migration" | "broken";

/**
 * Remembered `ready` verdicts, per adapter, by companion table name.
 *
 * Keyed on the adapter rather than on the table name alone, because a table name does not identify
 * a table. One process can hold two adapters — a second database, a test harness booting a fresh
 * one, an instance replaced on reload — and `dc_posts_locales` in each is a different object. A
 * verdict shared between them lets the first database vouch for a companion the second has never
 * provisioned, and the reads and writes that follow address a table that is not there instead of
 * taking the pre-migration fallback.
 *
 * A `WeakMap` rather than a keyed record, so identity does the scoping and a discarded adapter
 * takes its verdicts with it. There is nothing to clear on shutdown and nothing to leak.
 *
 * On `globalThis` for the same reason the schema-snapshot caches are: Turbopack re-executes
 * modules on every HMR cycle, so a module-scoped map would be emptied constantly and the cache
 * would never pay for itself — while the adapters it keys on survive that re-execution.
 */
interface ReadinessCacheBag {
  __nextly_companionReadiness?: WeakMap<object, Map<string, number>>;
  /**
   * Positive column verdicts, per adapter, by companion table and then by column.
   *
   * Nested rather than keyed on a joined `table:column` string so that forgetting one companion
   * drops every column verdict for it in one operation. A provisioning path that replaces a
   * companion invalidates a TABLE, and it must not leave behind a verdict claiming the
   * replacement carries a column nobody has looked at.
   */
  __nextly_companionColumns?: WeakMap<object, Map<string, Map<string, number>>>;
}

/**
 * How long a positive verdict is trusted before it is checked again.
 *
 * A companion is dropped by a disable migration, and `nextly migrate` runs in its own process —
 * one that cannot reach into a running server's memory. During a rolling deployment an old worker
 * would otherwise keep a verdict that the database no longer supports for as long as it lives, and
 * every localized read and write would fail at the driver instead of falling back to the main
 * table. There is no invalidation channel between those processes, so the staleness is bounded by
 * time instead.
 *
 * Thirty seconds costs one plan-only `SELECT` per entity per window on the paths that resolve —
 * against one per write before any of this — and keeps a stale verdict shorter than a deployment.
 */
const VERDICT_TTL_MS = 30_000;

/**
 * Anything that identifies one database connection. Narrower than the adapter on purpose: the
 * cache needs identity, not capability, so every caller can pass what it already holds.
 */
export type ReadinessScope = object;

function readyTables(scope: ReadinessScope): Map<string, number> {
  const bag = globalThis as ReadinessCacheBag;
  bag.__nextly_companionReadiness ??= new WeakMap<
    object,
    Map<string, number>
  >();
  let tables = bag.__nextly_companionReadiness.get(scope);
  if (!tables) {
    tables = new Map<string, number>();
    bag.__nextly_companionReadiness.set(scope, tables);
  }
  return tables;
}

/** Whether a verdict is recent enough to act on without checking it again. */
function isFresh(verifiedAt: number | undefined): boolean {
  return verifiedAt !== undefined && Date.now() - verifiedAt < VERDICT_TTL_MS;
}

/**
 * The remembered verdict, or undefined when there is none. Never queries, so it is the only form
 * safe to call from inside an open transaction.
 *
 * Undefined is not "not ready" — it means nothing has resolved this entity yet. A caller inside a
 * transaction cannot find out, so it must behave as it would for a companion it cannot use: skip
 * the join rather than attempt one. That is safe because every path that opens a write transaction
 * resolves readiness before opening it, which is also what keeps the verdict this reads fresh.
 */
export function cachedCompanionReadiness(
  scope: ReadinessScope,
  companionTableName: string
): CompanionReadiness | undefined {
  return readyTables(scope).has(companionTableName) ? "ready" : undefined;
}

/**
 * Resolve readiness, querying only when the answer is not already known to be `ready`.
 *
 * MUST NOT be called inside an open transaction — see the module comment.
 *
 * `localizedColumns` are the physical column names the entity's translatable fields map to. They
 * decide the difference between `pre-migration` and `broken`: the fallback can only work while the
 * main table still has somewhere to put the values, and an entity localized from birth never had
 * those columns, so writing to main would reach the driver and fail as an opaque 500.
 */
export async function resolveCompanionReadiness(
  adapter: CompanionIntrospectAdapter,
  args: {
    companionTableName: string;
    mainTableName: string;
    localizedColumns: readonly string[];
  }
): Promise<CompanionReadiness> {
  if (await isCompanionReady(adapter, args.companionTableName)) return "ready";
  // Deliberately not remembered. The companion may be created by another process at any moment,
  // and remembering this would keep serving the pre-migration answer until the next reload.
  const { mainTableHasColumns } = await import("./companion-io");
  return (await mainTableHasColumns(
    adapter,
    args.mainTableName,
    args.localizedColumns
  ))
    ? "pre-migration"
    : "broken";
}

/**
 * Whether the companion is there, for callers that do not care why it might not be.
 *
 * Some decisions only branch on `ready`: whether to seed a localized default into the companion,
 * whether an entity has a per-locale publish lifecycle. Telling `pre-migration` from `broken`
 * costs a full table introspection, and paying for an answer the caller then discards is the kind
 * of waste this module exists to remove.
 *
 * Caches a positive result exactly as {@link resolveCompanionReadiness} does — it is the same
 * observation — so a later caller that does need all three states gets `ready` for free.
 */
export async function isCompanionReady(
  adapter: CompanionIntrospectAdapter,
  companionTableName: string
): Promise<boolean> {
  const tables = readyTables(adapter);
  if (isFresh(tables.get(companionTableName))) return true;
  const { companionTableExists } = await import("./companion-io");
  if (!(await companionTableExists(adapter, companionTableName))) {
    // Checked and gone. Dropping it here is what stops an expired verdict lingering as a
    // half-truth for a caller that can only read.
    tables.delete(companionTableName);
    return false;
  }
  tables.set(companionTableName, Date.now());
  return true;
}

/**
 * The message a caller gets when its localized write is refused because the companion is not
 * there, phrased for the environment it is running in.
 *
 * One message served both, and it named the wrong command in the one that matters. Boot
 * deliberately refuses to run DDL in production — a running deployment must not alter its own
 * schema because a config file changed — so `db:sync`, which is a development tool, cannot be the
 * remedy there. `nextly migrate` is. Telling an operator to run something that will not help is
 * worse than saying nothing, because it costs them the time to try it before they start looking
 * for the real answer.
 *
 * In development the reverse is true: the reload path provisions the companion in-process, so this
 * refusal should be close to unreachable, and when it does appear the operator can act at once.
 *
 * `subject` names what could not be written ("collection", "single", "field group") so the message
 * reads naturally at each call site without three copies of the sentence drifting apart.
 */
export function companionNotReadyMessage(subject: string): string {
  const remedy =
    process.env.NODE_ENV === "production"
      ? "Run `nextly migrate` to create its translation table."
      : "Restart the app (or re-run `nextly db:sync`) to create its translation table, then try again.";
  return `Translations are not ready for this ${subject} yet. ${remedy}`;
}

/** The parts of a loaded companion schema that readiness is decided from. */
export interface ReadinessSubject {
  companionTableName: string;
  localizedFields: readonly { column: string }[];
}

/**
 * Readiness for an already-loaded companion schema.
 *
 * Every caller has one of these — it is what `loadCompanionSchema` returns — and every caller
 * would otherwise repeat the same three lines to derive the main table's name and the column list
 * from it. The main table is the companion's name without its `_locales` suffix, which is the
 * naming rule the companion is built from, so deriving it here keeps that rule in one place.
 */
export function resolveCompanionSchemaReadiness(
  adapter: CompanionIntrospectAdapter,
  companion: ReadinessSubject
): Promise<CompanionReadiness> {
  return resolveCompanionReadiness(adapter, {
    companionTableName: companion.companionTableName,
    mainTableName: companion.companionTableName.replace(/_locales$/, ""),
    localizedColumns: companion.localizedFields.map(f => f.column),
  });
}

/**
 * Forget a remembered verdict for one connection, or all of that connection's when given no name.
 *
 * Called by anything that removes or replaces a companion — disabling localization, tearing an
 * entity down, a migration reset. Creating one needs no call: `ready` is only ever recorded by
 * observing the table, so an entity that has just gained a companion simply has nothing remembered
 * and resolves on its next write.
 *
 * Only ever affects the connection passed in. Another adapter's verdicts describe another
 * database and are not this caller's to discard.
 */
export function forgetCompanionReadiness(
  scope: ReadinessScope,
  companionTableName?: string
): void {
  if (companionTableName === undefined) {
    readyTables(scope).clear();
    columnVerdicts(scope).clear();
    return;
  }
  readyTables(scope).delete(companionTableName);
  // Column verdicts describe THIS table, so they die with it. Keeping them would let a replaced
  // companion inherit the shape of the one it replaced, which is the exact claim this whole
  // module exists to stop being made from memory.
  columnVerdicts(scope).delete(companionTableName);
}

/** Test seam: drop every verdict for this connection and re-verify on the next resolve. */
export function expireCompanionReadiness(scope: ReadinessScope): void {
  for (const table of readyTables(scope).keys()) {
    readyTables(scope).set(table, 0);
  }
  for (const columns of columnVerdicts(scope).values()) {
    for (const column of columns.keys()) columns.set(column, 0);
  }
}

function columnVerdicts(
  scope: ReadinessScope
): Map<string, Map<string, number>> {
  const bag = globalThis as ReadinessCacheBag;
  bag.__nextly_companionColumns ??= new WeakMap<
    object,
    Map<string, Map<string, number>>
  >();
  let tables = bag.__nextly_companionColumns.get(scope);
  if (!tables) {
    tables = new Map<string, Map<string, number>>();
    bag.__nextly_companionColumns.set(scope, tables);
  }
  return tables;
}

/**
 * The remembered verdict for one column, or `undefined` when there is none. Never queries, so it
 * is the only form safe to call from inside an open transaction.
 *
 * 🔴 `undefined` is NOT "the column is absent". It means nothing has established either way, and
 * a caller that cannot find out must behave as it would for a companion that lacks the column:
 * omit whatever names it. That is the conservative direction — omitting the staleness inputs
 * reports UNKNOWN, while naming a column that is not there fails the whole query for that
 * collection.
 *
 * Only `true` is ever returned, because only `true` is ever stored. See
 * {@link resolveCompanionColumn}.
 */
export function cachedCompanionColumn(
  scope: ReadinessScope,
  companionTableName: string,
  column: string
): true | undefined {
  const columns = columnVerdicts(scope).get(companionTableName);
  return isFresh(columns?.get(column)) ? true : undefined;
}

/**
 * Whether an existing companion physically carries `column`, remembering only that it does.
 *
 * 🔴 MUST NOT be called inside an open transaction. It queries, and a query that fails marks the
 * whole PostgreSQL transaction aborted, after which the real statement dies with
 * `current transaction is aborted` naming an innocent one. Callers resolve before they open one;
 * inside a transaction they read {@link cachedCompanionColumn}, which cannot query.
 *
 * 🔴 ONLY THE POSITIVE ANSWER IS REMEMBERED, and the asymmetry is the whole design — the same one
 * {@link resolveCompanionReadiness} makes about `ready`, for the same reason.
 *
 * A column is added by a migration and never removed: the reconcile is additive by policy, and a
 * field that stops being localized leaves its column in place rather than dropping it. So `true`
 * describes a state nothing ordinary undoes, and a stale `true` is bounded by the TTL anyway.
 *
 * `false` is the opposite. `nextly migrate` runs in a different process from the server, so a
 * negative verdict can outlive the migration that made it wrong — and it would keep the staleness
 * read switched off for that collection until the process reloads, which is a feature silently
 * absent rather than an error anyone sees. Re-asking costs one introspection per resolve on a
 * path that is not the request path.
 */
export async function resolveCompanionColumn(
  adapter: CompanionIntrospectAdapter,
  companionTableName: string,
  column: string
): Promise<boolean> {
  if (cachedCompanionColumn(adapter, companionTableName, column)) return true;
  const { companionHasColumn } = await import("./companion-io");
  // Deliberately not caught. `companionHasColumn` answers from the table's own column list, so
  // absent is absent and anything that stops the list being read is a failure rather than a claim
  // about the schema — see its own comment. Swallowing here would rebuild exactly the collapse it
  // was changed to remove.
  const present = await companionHasColumn(adapter, companionTableName, column);
  if (!present) return false;
  let columns = columnVerdicts(adapter).get(companionTableName);
  if (!columns) {
    columns = new Map<string, number>();
    columnVerdicts(adapter).set(companionTableName, columns);
  }
  columns.set(column, Date.now());
  return true;
}
