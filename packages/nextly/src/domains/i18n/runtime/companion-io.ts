/**
 * Entity-agnostic companion `_locales` I/O helpers (i18n).
 *
 * The localized read/write engine originally lived only in the collection services. These
 * helpers factor the parts that are identical for collections, singles, AND components — the
 * companion schema shape, the split of a write into shared-vs-translatable columns, the
 * per-(parent, locale) upsert, and the physical-existence probe — so every entity type routes
 * translatable values to its companion the same way. The read side already has a shared helper
 * (`populateCompanionFields` in `../companion-join`); this module is the schema + write seam.
 *
 * @module domains/i18n/runtime/companion-io
 */

import type {
  SqlParam,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { VersionScopeKind } from "../../../schemas/versions/types";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { toSnakeCase as toCanonicalSnakeCase } from "../../schema/services/field-column-descriptor";
import { resolveLocalizedFieldNames } from "../classify-fields";
import {
  COMPANION_STRUCTURAL_COLUMNS,
  COMPANION_UPDATED_AT_COLUMN,
} from "../companion-columns";
import type { LocalizedFieldRef } from "../companion-join";
import { claimGuardCondition } from "../migration/transition-state";
import type {
  I18nTransitionKind,
  TransitionStateStore,
} from "../migration/transition-state";

import { buildCompanionRuntimeTable } from "./companion-registration";
import { encodeStamp } from "./companion-stamp-column";

/**
 * A held transition, plus the condition a statement can carry to prove it is still held.
 *
 * The two travel together because they are only correct together: the token settles the claim
 * afterwards, and the guard is what keeps the one destructive statement from running for a claim
 * that has since moved on.
 */
interface CompanionClaim {
  token: string;
  guard: { key: string; value: string };
}

/** Minimal field shape the companion I/O needs. */
interface CompanionFieldLike {
  name: string;
  type: string;
  localized?: boolean;
}

/**
 * The companion `_locales` runtime schema for a localized entity — the queryable Drizzle table
 * plus the metadata the read/write helpers need. Identical shape for every entity type.
 */
export interface CompanionSchema {
  /** Queryable Drizzle table object for `<mainTable>_locales`. */
  table: unknown;
  /** Physical companion table name (e.g. `single_settings_locales`). */
  companionTableName: string;
  /** Translatable fields (API name + snake_case companion column). */
  localizedFields: LocalizedFieldRef[];
  /** Whether the companion carries a per-locale `_status` column (entity has Draft/Published). */
  hasStatus: boolean;
  /**
   * Whether the companion carries the per-locale `_updated_at` column (i18n B2).
   *
   * Unconditionally `true`, because unlike `_status` this column is part of every companion's
   * declared shape rather than a consequence of the entity's configuration. It is still a FIELD
   * rather than a literal at each reader, for two reasons: readers then treat it exactly as they
   * treat `hasStatus`, so neither can be passed while the other is forgotten; and if it ever
   * becomes conditional, one definition changes instead of every call site.
   *
   * This is the DECLARED shape, not an introspection — the same contract `hasStatus` reports. A
   * database whose companion physically predates the column is brought into step by
   * `reconcileCompanionColumns`; until it is, a staleness query against that collection fails, and
   * the worklist already reports a collection whose read failed as one this answer did not cover.
   * That is the honest outcome: it never claims a clean backlog for a collection it could not ask.
   */
  hasUpdatedAt: boolean;
}

/**
 * snake_case a field name for its physical companion column (`metaTitle` → `meta_title`). Reuses
 * the canonical descriptor conversion so the companion column name matches exactly what the
 * DDL/runtime-schema path produces — otherwise a field with an uppercase acronym like `URLTitle`
 * would be created as `u_r_l_title` by the DDL but looked up as `urltitle` here, and reads/writes
 * would miss the companion column entirely.
 */
function toColumn(name: string): string {
  return toCanonicalSnakeCase(name);
}

/**
 * Build the companion schema for a localized entity from its physical inputs. Entity-agnostic:
 * the caller supplies the resolved table name (`dc_*` / `single_*` / `comp_*`) and fields, so this
 * works for collections, singles, and components alike. Returns `null` when the entity has no
 * translatable fields (nothing lives in a companion).
 */
export function buildCompanionSchema(args: {
  slug: string;
  tableName: string;
  fields: CompanionFieldLike[];
  dialect: SupportedDialect;
  status?: boolean;
}): CompanionSchema | null {
  const localizedFields: LocalizedFieldRef[] = resolveLocalizedFieldNames(
    args.fields,
    true
  ).map(name => ({ name, column: toColumn(name) }));
  if (localizedFields.length === 0) return null;

  const companion = buildCompanionRuntimeTable({
    slug: args.slug,
    tableName: args.tableName,
    fields: args.fields,
    dialect: args.dialect,
    localized: true,
    status: args.status === true,
  });
  if (!companion) return null;

  return {
    table: companion.table,
    companionTableName: companion.companionTableName,
    localizedFields,
    hasStatus: args.status === true,
    hasUpdatedAt: true,
  };
}

/**
 * Split a write payload into the values that stay on the main table (shared) and the values that
 * belong on the companion row (translatable). Keys not present in `data` are omitted from both
 * (partial updates touch only what was provided).
 */
export function splitLocalizedWrite(
  data: Record<string, unknown>,
  localizedFields: LocalizedFieldRef[]
): { main: Record<string, unknown>; companion: Record<string, unknown> } {
  // Match a payload key by EITHER the camelCase field name or the snake_case companion column.
  // Component writes pass camelCase field names; single/collection writes pass a payload that has
  // already been `keysToSnakeCase`-converted, so a field like `metaTitle` arrives as `meta_title`.
  // Recognizing both routes translatable values to the companion in every path.
  const columnByKey = new Map<string, string>();
  for (const f of localizedFields) {
    columnByKey.set(f.name, f.column);
    columnByKey.set(f.column, f.column);
  }
  const main: Record<string, unknown> = {};
  const companion: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const column = columnByKey.get(key);
    if (column) {
      companion[column] = value;
    } else {
      main[key] = value;
    }
  }
  return { main, companion };
}

/** Minimal adapter surface the write helpers need — matches DrizzleAdapter. */
interface CompanionWriteAdapter {
  dialect: SupportedDialect;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Upsert the companion `_locales` row for `(parentId, locale)` with the provided localized
 * columns. Only the supplied columns are written; other locales' rows and other columns on this
 * row are untouched. Uses the composite PK `(_parent, _locale)` as the conflict target. No-op when
 * `companionData` is empty. Optionally stamps a per-locale `_status` (entities with Draft/Published).
 */
/**
 * How a companion write treats `_updated_at` (i18n B2).
 *
 * - `"stamp"` (default) — write the current time when the write carries translated content.
 * - `"omit"` — leave the column out of the statement entirely, for a companion that physically
 *   predates it. On an existing row this PRESERVES whatever stamp is there.
 * - `"clear"` — write NULL, for an archive replay, where the content being written is older than
 *   whatever the row currently holds and its true chronology is unknown.
 *
 * `"omit"` and `"clear"` are distinct because the conflict clause updates only the columns named:
 * omitting leaves an existing stamp standing, which is exactly wrong when the content beside it
 * is being replaced with something older.
 */
export type CompanionStampMode = "stamp" | "omit" | "clear";

/**
 * The `_updated_at` a companion write should carry, or nothing at all (i18n B2).
 *
 * Exported because TWO write paths reach the companion and both must answer this the same way.
 * The update path goes through {@link upsertCompanionRow}; the collection CREATE path inserts the
 * row directly through its transaction, so it spreads this in instead. A rule computed separately
 * at each would be one edit away from disagreeing, and the disagreement is silent: a locale
 * written by the path that forgot keeps a NULL stamp, reads as UNKNOWN, and is never reported
 * stale. Nobody notices a warning that does not appear.
 *
 * 🔴 CONTENT decides the stamp, not the write. `_updated_at` answers "when was this language last
 * WRITTEN", and a lifecycle transition writes no language. Stamping a `_status`-only change would
 * move the source's timestamp past every target and report the whole site as needing review on an
 * action that changed not one word — and publishing a stale target would clear its warning while
 * the translation still said what it said.
 *
 * Structural columns are subtracted rather than `_status` alone, so a further structural column
 * added later cannot be mistaken for content. Note `_status` arrives BOTH ways — inside
 * `companionData` on an ordinary update, and as the separate `status` argument — so testing the
 * argument alone would miss the common path.
 *
 * @returns `{ _updated_at }` when the write carries translated content, `{}` otherwise, so the
 *   caller can spread it unconditionally.
 */
export function companionContentStamp(
  companionData: Record<string, unknown>,
  companionTableName: string,
  dialect: SupportedDialect,
  now?: Date
): Record<string, unknown> {
  const writesContent = Object.keys(companionData).some(
    column => !COMPANION_STRUCTURAL_COLUMNS.has(column)
  );
  if (!writesContent) return {};
  return {
    // 🔴 Encoded the way Drizzle would encode it, not handed to the driver raw.
    //
    // A `Date` bound straight to a driver writes the LOCAL wall clock into a column that records
    // no time zone, while every timestamp Drizzle writes is UTC. On a UTC server the two agree and
    // nothing looks wrong, which is why the difference survives CI — and this comparison reads
    // BOTH bases, because the back-fill seeds from Drizzle-written version rows. A mixed pair can
    // order backwards, which inverts the staleness answer rather than degrading it.
    [COMPANION_UPDATED_AT_COLUMN]: encodeStamp(
      new Date(now?.getTime() ?? Date.now()),
      companionTableName,
      dialect
    ),
  };
}

export async function upsertCompanionRow(
  adapter: CompanionWriteAdapter,
  companionTableName: string,
  parentId: string,
  locale: string,
  companionData: Record<string, unknown>,
  status?: string,
  options: { now?: Date; updatedAt?: CompanionStampMode } = {}
): Promise<void> {
  const withStatus =
    status !== undefined
      ? { ...companionData, _status: status }
      : companionData;
  // Counted BEFORE the timestamp is added, so "nothing to write" still means nothing to write.
  // Stamping first would turn every no-op call into a real write that moves `_updated_at` without
  // any content changing — and since staleness is `source._updated_at > target._updated_at`, that
  // is not a harmless extra row touch: it would mark every other locale stale against a source
  // that nobody edited.
  if (Object.keys(withStatus).length === 0) return;

  // i18n B2: when THIS locale was last written. Bound as a `Date`, which every dialect handles —
  // node-postgres and mysql2 serialize it natively, and the SQLite adapter converts it to epoch
  // seconds in `sanitizeSqliteValue`, on BOTH surfaces this function runs over (the adapter's
  // `executeQuery` and a transaction's `execute` via `companionWriteVia`). Verified rather than
  // assumed: the two paths sanitize in different functions, and a `Date` that survived one and
  // not the other would work in a test and throw in production.
  //
  // Opt-out rather than opt-in, because the failure of forgetting is silent. A locale written
  // through a path that skipped the stamp keeps a NULL `_updated_at`, reads as UNKNOWN, and is
  // never reported stale — the warning simply never fires for it, and nobody notices a warning
  // that does not appear.
  //
  // The two non-default modes look alike and are NOT interchangeable, which is why they are named
  // rather than expressed as one boolean.
  //
  // `"omit"` leaves the column out of the statement, for a companion that physically predates it
  // where naming it would fail outright. On an existing row that PRESERVES whatever stamp is
  // there.
  //
  // `"clear"` writes NULL, for an archive replay. Preserving would be wrong there: this upsert
  // replaces a row's content with OLDER archived text, so a locale translated after localization
  // was re-enabled but before `i18n:restore` ran would keep its recent stamp on restored content
  // and read as current. Omitting the column looks like the same thing and is not, because the
  // conflict clause updates only the columns named — the untouched stamp survives.
  //
  // 🔴 CONTENT decides the stamp, not the write. `_updated_at` answers "when was this language
  // last WRITTEN", and a lifecycle transition writes no language. Publishing the source locale is
  // a `_status` change and nothing else — stamping it would move the source's timestamp past
  // every target's and report the whole site as needing review, on an action that changed not one
  // word. The reverse is as bad: publishing a stale target would clear its warning while the
  // translation still says what it said.
  //
  // Structural columns are subtracted rather than `_status` alone, so a further one added to the
  // companion later cannot be mistaken for content by this test. Note `_status` arrives BOTH ways
  // — inside `companionData` on an ordinary update, and as the `status` argument — so testing the
  // argument alone would miss the common path.
  //
  // This also settles a divergence between endpoints: `publishAllLocales` writes `_status` with a
  // raw UPDATE that never reaches this function, so a publish through that path could not stamp
  // anyway. Two lifecycle transitions now behave the same way whichever endpoint performs them.
  const withStamp =
    options.updatedAt === "omit"
      ? withStatus
      : options.updatedAt === "clear"
        ? { ...withStatus, [COMPANION_UPDATED_AT_COLUMN]: null }
        : {
            ...withStatus,
            ...companionContentStamp(
              companionData,
              companionTableName,
              adapter.dialect,
              options.now
            ),
          };
  const cols = Object.keys(withStamp);

  const isMysql = adapter.dialect === "mysql";
  const q = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
  const params: unknown[] = [];
  const ph = () =>
    adapter.dialect === "postgresql" ? `$${params.length}` : "?";

  const allCols = ["_parent", "_locale", ...cols];
  const valuePlaceholders = allCols
    .map(c => {
      params.push(
        c === "_parent" ? parentId : c === "_locale" ? locale : withStamp[c]
      );
      return ph();
    })
    .join(", ");

  const conflict = isMysql
    ? `ON DUPLICATE KEY UPDATE ${cols.map(c => `${q(c)} = VALUES(${q(c)})`).join(", ")}`
    : `ON CONFLICT (${q("_parent")}, ${q("_locale")}) DO UPDATE SET ${cols
        .map(c => `${q(c)} = excluded.${q(c)}`)
        .join(", ")}`;

  await adapter.executeQuery(
    `INSERT INTO ${q(companionTableName)} (${allCols.map(q).join(", ")}) ` +
      `VALUES (${valuePlaceholders}) ${conflict}`,
    params
  );
}

/**
 * Present a transaction as the write surface {@link upsertCompanionRow} takes.
 *
 * There is exactly one difference between an adapter and a transaction here: the NAME of the
 * raw-SQL method. `CompanionWriteAdapter.executeQuery` and `TransactionContext.execute` have the
 * same `(sql, params) => Promise<T[]>` shape; only the dialect has to be supplied separately,
 * because a transaction does not carry one.
 *
 * That difference is the entire reason a SECOND hand-written companion upsert existed inside
 * `collection-mutation-service.ts` — the collection write path holds a `tx`, could not pass it
 * here, and grew its own copy of the same INSERT ... ON CONFLICT. Naming the difference in one
 * place is what lets one upsert serve both, so a column added to the companion row (i18n B2's
 * `_updated_at`) is written by every path rather than by whichever one the author remembered.
 *
 * @param tx - The caller's open transaction; writes land on its connection, not a pooled one.
 * @param dialect - Read from the calling service, since a transaction does not expose it.
 */
export function companionWriteVia(
  tx: {
    execute<T = unknown>(sql: string, params?: SqlParam[]): Promise<T[]>;
  },
  dialect: SupportedDialect
): CompanionWriteAdapter {
  return {
    dialect,
    // The cast is the one place the two surfaces disagree: `executeQuery` declares `unknown[]`
    // and `execute` declares `SqlParam[]`. The values are companion column values plus the
    // parent id and locale, which is exactly what the previous call site already passed — it
    // simply passed them through a `tx: any`, so nothing checked them at all. Narrowing here
    // is stricter than what it replaces, not looser.
    executeQuery: <T = unknown>(
      sql: string,
      params?: unknown[]
    ): Promise<T[]> => tx.execute<T>(sql, params as SqlParam[] | undefined),
  };
}

/**
 * Adapter surface for asking about a table's PHYSICAL shape: the Drizzle handle, which the
 * shared introspection helper needs. Separate from {@link CompanionWriteAdapter} so the
 * read/write helpers, which never introspect, keep their narrower contract.
 */
export interface CompanionIntrospectAdapter extends CompanionWriteAdapter {
  getDrizzle<T = unknown>(): T;
}

/**
 * Add localized columns an EXISTING companion is missing. No-op when the companion is absent —
 * creating it is {@link ensureCompanionTable}'s job.
 *
 * Needed because a companion is created once and then never revisited, while the entity's field
 * list keeps moving. Marking a further field localized on an already-localized entity leaves the
 * companion a column short, and the write splits that value straight into a column that is not
 * there.
 *
 * **Additive only, deliberately.** A field that stops being localized leaves its companion column
 * in place rather than dropping it: this runs unattended, and `db:sync` persists registry metadata
 * BEFORE its destructive prompt, so a drop here would execute even for an operator who then
 * declined the change. An unused column is recoverable; a dropped one is not.
 *
 * Issues DDL, so it belongs to `db:sync` and never to boot — a running deployment must not alter
 * its own schema because a config file changed.
 */
/**
 * The version scope an i18n entity kind records its history under, or `undefined` when it records
 * none — which is what decides whether `_updated_at` can be back-filled for it (i18n B2).
 *
 * Stated once rather than at each call site, because the two are the same question and a second
 * spelling of it would let one unattended path seed a companion the other leaves blank, for the
 * same entity, with nothing to indicate which ran.
 *
 * `fieldGroup` maps to `undefined` structurally: `nextly_versions.scope_kind` has no member for
 * it, so there is no history to read and NULL is the true answer rather than a gap.
 *
 * `single` maps to `undefined` by SCOPE, not by structure — Singles do have version history, and
 * seeding from it would work. It is withheld because nothing surfaces the signal for a Single:
 * there is no Singles worklist, so a back-fill there would populate a column no screen reads,
 * while committing every future reader to whatever it happened to seed.
 *
 * This bounds the BACK-FILL alone. `upsertCompanionRow` stamps every companion write whatever the
 * entity, so Singles accumulate truthful timestamps from now on; only their history stays
 * unknown, which is the same state any locale with no durable versions is in.
 */
export function versionScopeForEntityKind(
  kind: I18nTransitionKind
): VersionScopeKind | undefined {
  return kind === "collection" ? "collection" : undefined;
}

export async function reconcileCompanionColumns(
  adapter: CompanionIntrospectAdapter,
  args: {
    /**
     * Which builder made the main table. This function CREATES or ALTERS the physical companion, so
     * its columns have to match the ones the main table's builder would produce — a translatable
     * field bounded here while the same declaration is unbounded on main refuses in one language
     * what it accepts in another.
     */
    builtBy: ColumnOrigin;
    slug: string;
    tableName: string;
    fields: CompanionFieldLike[];
    dialect: SupportedDialect;
    status?: boolean;
    /**
     * Which version scope this entity's history is recorded under, enabling the `_updated_at`
     * back-fill (i18n B2). Omit for an entity with no version history — a field group — where
     * NULL is the true answer rather than a gap.
     */
    versionScope?: VersionScopeKind;
  },
  onError?: (error: unknown) => void
): Promise<void> {
  const companionTableName = `${args.tableName}_locales`;
  // Hoisted so the concurrency recheck in the catch can reuse it.
  const localizedNames = new Set(resolveLocalizedFieldNames(args.fields, true));
  const desired = args.fields.filter(f => localizedNames.has(f.name));
  try {
    if (!(await companionTableExists(adapter, companionTableName))) return;
    if (desired.length === 0) return;

    const { introspectLiveSnapshot } = await import(
      "../../schema/pipeline/diff/introspect-live"
    );
    const snapshot = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      adapter.dialect,
      [companionTableName]
    );
    const present = new Set(
      snapshot.tables
        .find(t => t.name === companionTableName)
        ?.columns.map(c => c.name) ?? []
    );
    // `_status` is deliberately NOT reconciled here. Adding the column is one statement and
    // backfilling the default-locale row from the main row is another, and the pair cannot be
    // made retryable from physical shape alone: when the ADD lands and the backfill does not,
    // every later run sees the column present, concludes the companion is in step, and leaves
    // previously published content reading as draft while reporting success. MySQL commits DDL
    // implicitly, so the two cannot be made atomic there either.
    //
    // Deciding it correctly needs a record of whether the backfill has run — the localization
    // transition state this codebase does not keep yet. Until it does, switching Draft/Published
    // on for an already-localized entity belongs to the migration path, which fails loudly on a
    // missing column rather than silently hiding published rows.
    //
    // The localized-column reconcile below has no such weakness: a missing column is visible on
    // every run, so a partial apply simply finishes on the next one.
    const hasStatus = present.has("_status");

    // i18n B2: `_updated_at` IS reconciled here, and the contrast with `_status` above is the
    // whole justification rather than an inconsistency.
    //
    // `_status` cannot be added unattended because ADD-then-back-fill is not retryable from
    // physical shape alone: if the ADD lands and the back-fill does not, every later run sees the
    // column present, concludes the companion is in step, and leaves published content reading as
    // draft. The half-applied state is a LIE that repairs itself into permanence.
    //
    // `_updated_at`'s half-applied state is NULL, and NULL already means UNKNOWN to the only
    // thing that reads it — the staleness comparison, which answers "not stale and not known"
    // rather than "fine". The back-fill is guarded by `WHERE _updated_at IS NULL`, so a later run
    // finishes what a partial one started. Nothing degrades into a false statement, so the
    // reasoning that keeps `_status` out does not reach this column.
    const hasUpdatedAt = present.has(COMPANION_UPDATED_AT_COLUMN);

    // Draft/Published was switched on after this companion was created, so `_status` is now
    // required and absent. Reconciling it is unsafe for the reasons above — but returning
    // quietly is worse than either: the caller persists `status: true`, reports success, and
    // every later per-locale status read or write hits a column that is not there. Report it
    // so `db:sync` exits non-zero and the operator learns now rather than at the next publish.
    //
    // Only this direction is a problem. Status switched OFF while the column remains is
    // harmless: the column is simply unused, and the additive policy keeps it.
    if (args.status === true && !hasStatus) {
      onError?.(
        new Error(
          `The translations table ${companionTableName} predates Draft/Published being enabled ` +
            `for "${args.slug}", so it has no _status column. Run \`nextly migrate\` to add it: ` +
            `an unattended sync cannot, because adding the column and back-filling the ` +
            `default locale's status cannot be retried safely if only the first half lands.`
        )
      );
      return;
    }

    // Nothing missing — the overwhelmingly common case, and worth leaving before the statement
    // builder runs. `hasUpdatedAt` is part of the condition rather than a separate check: a
    // companion whose translated columns are all present but which predates `_updated_at` still
    // has work to do, and testing the localized columns alone would return here and leave every
    // such companion permanently unstamped.
    //
    // 🔴 An entity with a VERSION SCOPE never leaves here, and that is deliberate. Its
    // `_updated_at` back-fill owes a statement whose completion physical shape cannot report: a
    // successfully back-filled row whose locale had no durable history is NULL, exactly like one
    // that was never seeded. So the reconcile re-issues the guarded UPDATE rather than inferring
    // completion from the column being present — see `buildUpdatedAtBackfill`. An entity with no
    // version scope emits no back-fill at all, so for it this stays a plain early return.
    const columnsInStep =
      hasUpdatedAt && desired.every(f => present.has(toColumn(f.name)));
    if (columnsInStep && args.versionScope === undefined) return;

    // Feed the canonical builder the columns that already exist as `oldLocalized`, so what it
    // emits is exactly the difference. `old` is a subset of `new` by construction here, which
    // is what keeps the result additive.
    const { buildCompanionReconcileStatements } = await import(
      "../migration/reconcile-companion"
    );
    const statements = buildCompanionReconcileStatements({
      slug: args.slug,
      tableName: args.tableName,
      oldLocalized: desired.filter(f => present.has(toColumn(f.name))),
      newLocalized: desired,
      dialect: args.dialect,
      // Report the companion's ACTUAL status shape on both sides, so the builder sees no status
      // change and emits only the column difference — never an ADD or DROP of `_status`.
      builtBy: args.builtBy,
      status: hasStatus,
      companionHasStatus: hasStatus,
      // Introspected, so `false` is a measurement rather than a default. The builder distinguishes
      // it from `undefined` — "nobody looked" — precisely because an unconditional ADD COLUMN
      // would fail on every companion that already has the column.
      companionHasUpdatedAt: hasUpdatedAt,
      versionScope: args.versionScope,
      companionExists: true,
    });
    for (const stmt of statements) {
      await adapter.executeQuery(stmt);
    }
  } catch (error) {
    // Same check-then-act window as the create path: a concurrent sync or reload may have added
    // the very columns this run was adding, and `ADD COLUMN` is not idempotent. Treat "the shape
    // we wanted is now present" as success, whoever produced it.
    //
    // 🔴 SHAPE only. This says nothing about the `_updated_at` back-fill having run, and must not
    // be read as though it did — a back-filled row whose locale had no durable history is NULL,
    // exactly like one never seeded, so no introspection can report that. The back-fill is
    // re-issued on the next reconcile instead of being inferred complete here.
    if (await companionShapeIsPresent(adapter, companionTableName, desired))
      return;
    onError?.(error);
  }
}

/**
 * Does the live companion now carry every column this reconcile wanted?
 *
 * Answers only the physical shape, and answers `false` when it cannot look: a table that cannot
 * be re-read has not been shown to be healthy, so the caller reports its original error rather
 * than swallowing it on the strength of a failed check.
 */
async function companionShapeIsPresent(
  adapter: CompanionIntrospectAdapter,
  companionTableName: string,
  desired: CompanionFieldLike[]
): Promise<boolean> {
  try {
    const { introspectLiveSnapshot } = await import(
      "../../schema/pipeline/diff/introspect-live"
    );
    const after = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      adapter.dialect,
      [companionTableName]
    );
    const now = new Set(
      after.tables
        .find(t => t.name === companionTableName)
        ?.columns.map(c => c.name) ?? []
    );
    return (
      now.has(COMPANION_UPDATED_AT_COLUMN) &&
      desired.every(f => now.has(toColumn(f.name)))
    );
  } catch {
    return false;
  }
}

/**
 * Whether the main table still physically carries ALL of `columnNames`.
 *
 * This answers one question for every entity type: **can the pre-companion fallback actually
 * persist anything?** While the companion is missing, a write in the default language is meant
 * to stay on the main table — but that is only true for an entity whose columns are still
 * there. An entity localized from creation (or one whose migration has run) keeps them only on
 * the companion, and its registered runtime table omits them, so the write carries keys the
 * table has no columns for. Measured on all three dialects, that surfaces as a driver error
 * and a 500 rather than a wrong value — the write does not quietly commit. Answering the
 * question up front turns that opaque failure into a refusal the caller can act on.
 *
 * Goes through the same introspection the schema pipeline uses rather than a `SELECT ... LIMIT 0`
 * probe. That matters beyond convention: a probe cannot tell "this column does not exist" from
 * "the database is unreachable", so a transient failure would read as a missing column and
 * produce a misleading "translations are not ready" refusal instead of the real error.
 * Introspection fails loudly, and this deliberately does not catch.
 *
 * MUST be called before the caller opens its transaction. It borrows a connection from the pool,
 * so running it inside one waits for a connection that cannot be released until that transaction
 * finishes — starvation on a small pool. Resolving it first also keeps a refusal exactly as
 * raised: errors leaving a transaction callback pass through the adapter's error classification,
 * which rewraps anything that is not already a `DatabaseError`.
 */
export async function mainTableHasColumns(
  adapter: CompanionIntrospectAdapter,
  tableName: string,
  columnNames: readonly (string | undefined)[]
): Promise<boolean> {
  const wanted = columnNames.filter((c): c is string => Boolean(c));
  if (wanted.length === 0) return false;
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [tableName]
  );
  const table = snapshot.tables.find(t => t.name === tableName);
  if (!table) return false;
  const present = new Set(table.columns.map(c => c.name));
  // EVERY column, not just one. A partially migrated main table — an older field keeping its
  // legacy column while a newer localized field never had one — would otherwise pass on the
  // first column and then fail at the driver on a later one, which is the opaque 500 this
  // check exists to replace with an actionable refusal.
  return wanted.every(c => present.has(c));
}

// Whether a probe error is a verified "this TABLE does not exist" for the
// current dialect, as opposed to a transient/connection/permission error or a
// different missing resource (a missing DATABASE, schema, column, or role). The
// match is table-specific on purpose: a bare `does not exist` substring also
// matches `database "x" does not exist`, which must propagate rather than be
// misread as an absent companion table. The wording is the dialect's own:
// Postgres `relation "x" does not exist`, SQLite `no such table: x`, MySQL
// `Table 'db.x' doesn't exist`.
function isMissingTableError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    /relation .* does not exist/.test(message) ||
    message.includes("no such table") ||
    /table .* doesn't exist/.test(message)
  );
}

/**
 * Whether the companion `_locales` table physically exists (its migration has
 * run). Returns false ONLY for a verified missing-table error; any other probe
 * failure (transient, connection, permission) is rethrown, so a caller gating a
 * write on this never mistakes an unavailable database for an absent table and
 * silently skips the write.
 *
 * Stays a plan-only probe while its column-level sibling reads the catalog, and the difference
 * is the call frequency rather than a preference. This one backs the cached readiness verdict
 * that every localized write consults, so it runs once per entity per cache window on the
 * request path; a catalog read there would reintroduce exactly the per-write introspection cost
 * `companion-readiness` exists to remove. The column probes run on schema changes and
 * migrations, where one extra round trip is not measurable. It is also already safe in the way
 * a bare `catch` is not: {@link isMissingTableError} verifies the dialect's own wording for an
 * absent RELATION, and everything else propagates.
 */
export async function companionTableExists(
  adapter: CompanionWriteAdapter,
  companionTableName: string
): Promise<boolean> {
  const q =
    adapter.dialect === "mysql"
      ? `\`${companionTableName}\``
      : `"${companionTableName}"`;
  try {
    await adapter.executeQuery(`SELECT 1 FROM ${q} LIMIT 0`);
    return true;
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/**
 * Whether an EXISTING companion physically has the per-locale `_status` column. Used by the
 * runtime reconcile to decide whether a later Draft/Published toggle must ADD/DROP `_status`
 * on an already-provisioned companion.
 */
export async function companionHasStatusColumn(
  adapter: CompanionIntrospectAdapter,
  companionTableName: string
): Promise<boolean> {
  return companionHasColumn(adapter, companionTableName, "_status");
}

/**
 * Whether an EXISTING companion physically carries `column`.
 *
 * Answered by reading the table's column list, through the same introspection the companion
 * reconcile uses. The alternative — a plan-only `SELECT … LIMIT 0` and a `catch` — is cheaper by
 * one round trip and wrong in two ways that matter here.
 *
 * 🔴 A `catch` cannot tell ABSENT from UNREACHABLE, and the two want opposite behaviour. A
 * transient connection failure, or a role that may write but not select, would answer `false` —
 * "this companion has no such column" — and every caller treats that as a fact about the schema.
 * The archive replay is where it bites: `false` makes it choose `"omit"` over `"clear"`, so an
 * existing locale row keeps its NEWER timestamp while its content is replaced with OLDER archived
 * material, and the translation reads as current when it is not. A column list has no such
 * ambiguity — the column is in it or it is not — and anything that stops the question being
 * answered at all propagates instead of being flattened into a schema claim.
 *
 * The second reason is the repository's: database access is Drizzle only, and this was the last
 * hand-built statement on the localization write path.
 *
 * 🔴 MUST NOT be called inside an open transaction. A failed query marks the whole PostgreSQL
 * transaction aborted, after which the real statement dies with `current transaction is aborted`
 * and the error names an innocent one. That is the same hazard `companion-readiness` documents,
 * and it is why callers probe BEFORE they open one.
 *
 * A companion that does not exist has no columns, so it answers `false` — unchanged from the
 * probe this replaces, where the statement failed on the missing relation.
 */
export async function companionHasColumn(
  adapter: CompanionIntrospectAdapter,
  companionTableName: string,
  column: string
): Promise<boolean> {
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [companionTableName]
  );
  return (
    snapshot.tables
      .find(t => t.name === companionTableName)
      ?.columns.some(c => c.name === column) ?? false
  );
}

/**
 * Boot/db:sync helper: physically create the companion `<tableName>_locales` table if it does
 * not already exist. CREATION ONLY — the table is left empty, so an entity that already holds
 * content on its main table will read null for every localized field until that content is
 * copied across; a successful return is not evidence that it was. Idempotent and safe to run on
 * every boot — a no-op once the table exists (or when the entity has no translatable fields).
 * This is the
 * db:sync/dev-boot counterpart to the migration-owned companion creation (`nextly migrate`), so a
 * code-first localized collection / single / component gets a working companion without a manual
 * migrate step. Best-effort: a failure (e.g. main table not yet created) is swallowed so it
 * retries on the next boot.
 *
 * Returns whether THIS call created the table. Only true at the one moment an entity crosses from
 * unlocalized to localized, which is the only moment the current default locale is a safe answer
 * to "what language is the content on the main table in". Callers that record the transition read
 * this rather than assuming, because writing that record for a companion which already existed
 * would attach today's default to content written under some earlier one.
 */
/**
 * The entity's translatable columns that the MAIN table physically carries.
 *
 * Two callers, one question. Creation asks "would an empty companion here hide something" —
 * columns on main mean content may already be there, and once a companion exists every read
 * resolves through it. Disabling asks which columns it must not re-add but must still restore.
 * Both are the same physical fact, so they read it the same way rather than each introspecting
 * to its own shape.
 */
/** One translatable column the main table carries, and whether it accepts nulls. */
export interface MainColumnPresence {
  name: string;
  /**
   * False for a column that was required before localization. Once the companion exists its value
   * is written there instead, so the main insert omits it and the constraint fails every create.
   */
  nullable: boolean;
}

export async function localizedColumnsOnMain(
  adapter: CompanionIntrospectAdapter,
  tableName: string,
  localized: readonly CompanionFieldLike[]
): Promise<MainColumnPresence[]> {
  if (localized.length === 0) return [];
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [tableName]
  );
  const present = new Map(
    snapshot.tables
      .find(t => t.name === tableName)
      ?.columns.map(c => [c.name, c.nullable !== false] as const) ?? []
  );
  return localized
    .map(f => toColumn(f.name))
    .filter(column => present.has(column))
    .map(name => ({ name, nullable: present.get(name) === true }));
}

/**
 * The translatable columns that BOTH the main table and its companion physically carry.
 *
 * Copying a value in either direction needs a column at each end, and the two paths that copy —
 * restoring main from the companion when localization is turned off, and refreshing a stale
 * companion when it is turned back on — need the same intersection. Resolved in a single
 * introspection so the two sides cannot be observed at different moments, and shared so a column
 * counted as present by one copy direction is present for the other.
 *
 * Field flags are not consulted. Turning localization off usually clears them, and what can be
 * copied is decided by what exists.
 */
export async function localizedColumnsOnBothTables(
  adapter: CompanionIntrospectAdapter,
  tableName: string,
  companionTableName: string,
  fields: readonly CompanionFieldLike[]
): Promise<{
  companionExists: boolean;
  columns: string[];
  /**
   * Whether main carries `status` AND the companion carries `_status`.
   *
   * Publishing state is per-locale while an entity is localized, so it moves in the same
   * directions the values do and has to travel with them. Reported from this snapshot rather
   * than probed separately, for the reason the whole helper exists: an entity can gain or lose
   * Draft/Published in the same edit that changes its localization, and a status answer taken at
   * a different moment than the column list can describe a different table.
   */
  statusOnBoth: boolean;
}> {
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [tableName, companionTableName]
  );
  const columnsOf = (table: string) =>
    snapshot.tables.find(t => t.name === table)?.columns.map(c => c.name);
  const onMain = new Set(columnsOf(tableName) ?? []);
  const companionColumns = columnsOf(companionTableName);
  const onCompanion = new Set(companionColumns ?? []);
  const { fieldToLocalizedColumnSpec } = await import(
    "../migration/field-to-column-spec"
  );
  return {
    // Reported from the same snapshot as the columns, so a caller that has to decide whether the
    // companion is there at all cannot get that answer from a different moment than the columns
    // it then acts on.
    companionExists: companionColumns !== undefined,
    columns: fields
      .map(
        f => fieldToLocalizedColumnSpec(f, adapter.dialect, "codeFirst")?.name
      )
      .filter((name): name is string => typeof name === "string")
      .filter(name => onMain.has(name) && onCompanion.has(name)),
    statusOnBoth: onMain.has("status") && onCompanion.has("_status"),
  };
}

/**
 * Whether creating a companion here would hide anything.
 *
 * Content is what makes it unsafe, not shape. A table that does not exist, or exists with no rows,
 * has nothing to mask — and that is the ordinary case for a new entity, which must be free to get
 * its companion from any caller or its localized writes are refused forever.
 *
 * With rows present, either of two things is enough to defer: translatable columns on the main
 * table hold values an empty companion would mask, and a Draft/Published entity needs a
 * default-locale row carrying each row's status or its published rows drop out of locale-aware
 * reads. The seeding plan treats both as work.
 *
 * The row probe is a raw statement, like the existence probe above it and for the same reason:
 * there is no table object to query through here. Both go when readiness moves to load time.
 */
async function creatingWouldHideContent(
  adapter: CompanionIntrospectAdapter,
  args: { tableName: string; status?: boolean },
  localized: readonly CompanionFieldLike[]
): Promise<boolean> {
  if (!(await mainTableExists(adapter, args.tableName))) return false;

  const columnsAtRisk = await localizedColumnsOnMain(
    adapter,
    args.tableName,
    localized
  );
  if (args.status !== true && columnsAtRisk.length === 0) return false;

  const q = (id: string) =>
    adapter.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
  const rows = await adapter.executeQuery(
    `SELECT 1 FROM ${q(args.tableName)} LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * What an existing companion still owes, and in which language.
 *
 * Two different situations put content on the main table that the companion does not hold, and
 * they want opposite treatment for the rows the companion DOES hold — which is why this is a
 * shape rather than a locale string.
 */
export interface CompanionSeedDebt {
  /** The language the main table's values are in, as recorded when the transition began. */
  sourceLocale: string;
  /**
   * Whether the companion's existing rows in that locale must be overwritten from main.
   *
   * False while a first copy is still unfinished: the rows already there came from main, and
   * anything written since is a real translation that must survive.
   *
   * True when localization was turned off and back on. Main was authoritative in between, so those
   * rows are stale by definition and leaving them would revert every edit made while it was off.
   */
  overwriteExisting: boolean;
  /**
   * Only copy when the main table still physically carries translatable columns.
   *
   * Set for the operator-requested repair, whose job is to move VALUES that are sitting on main
   * into the companion. Without it, a Draft/Published entity qualifies on the strength of its
   * readable `status` alone and the copy manufactures a default-locale row for every entry that
   * lacks one — including entries deliberately authored in another language only, which have
   * nothing on main to move.
   *
   * Note this does not identify a legacy install. Nothing does: the push leaves translatable
   * columns on main for a from-birth entity too, so physical shape cannot tell a transition that
   * happened before records existed from one that never happened. That is what makes the repair
   * opt-in rather than inferred.
   */
  requireColumnsOnMain?: boolean;
  /**
   * Record the transition, called once the plan is known to describe real work and before any of
   * it runs.
   *
   * Not performed while resolving the debt, because resolving cannot yet tell whether there is
   * anything to do: a repair that turns out to be owed nothing must leave no trace. Ordering is
   * still the module's rule — the record goes in before the statements, since MySQL commits DDL
   * implicitly — because building the plan only reads.
   */
  claim?: () => Promise<CompanionClaim>;
}

/**
 * Turn an entity's recorded transition state into what its existing companion still owes.
 *
 * Every provisioning path needs the same mapping, and getting it wrong is silent: reading
 * `restored` as "nothing owed" leaves a re-enabled entity serving stale rows, and reading `seeded`
 * as owing a copy re-manufactures default-locale rows for entries deliberately authored only in
 * another language. Resolved once here so the paths cannot answer it differently.
 *
 * The locale comes from the record, never from today's configuration. A default locale that
 * changed since must not relabel values written under the old one, which is the reason the
 * transition is recorded rather than inferred.
 */
export async function resolveCompanionSeedDebt(
  store: TransitionStateStore,
  kind: I18nTransitionKind,
  slug: string,
  options: {
    /** The locale the app configures today. What a NEW transition labels main's content with. */
    defaultLocale: string;
    /**
     * Treat an entity with NO record as owing a copy.
     *
     * For installs that transitioned before transitions were recorded. They have a companion and
     * no marker, so nothing can tell whether their content was ever copied across — and the one
     * fact that cannot be re-derived is the language. An operator supplies it by running the
     * repair with their configured default locale, which is the whole of what was missing.
     *
     * Only ever passed by `nextly migrate`. Unattended provisioning must not assume this: a
     * from-birth localized entity is also untracked, and it owes nothing.
     */
    repairUntracked?: boolean;
  }
): Promise<CompanionSeedDebt | null> {
  const { beginI18nTransition, readI18nTransitionState } = await import(
    "../migration/transition-state"
  );
  const recorded = await readI18nTransitionState(store, kind, slug);

  const claimIn = async (
    sourceLocale: string,
    refresh: boolean
  ): Promise<CompanionClaim> => {
    const token = await beginI18nTransition(store, {
      kind,
      slug,
      sourceLocale,
      refresh,
    });
    // Built here because this is where the kind, the slug and the locale are all in hand, and the
    // statement that needs it is several calls down.
    return {
      token,
      guard: claimGuardCondition({
        kind,
        slug,
        sourceLocale,
        token,
        refresh,
      }),
    };
  };
  const claim = (refresh: boolean) => (): Promise<CompanionClaim> =>
    claimIn(options.defaultLocale, refresh);

  // A copy already recorded and unfinished. Continue it in the language it recorded — a default
  // locale that changed since must not relabel values written under the old one.
  //
  // Claimed, even though the record already exists. Resuming is doing the work, and the settlement
  // that follows has to name the claim it closes: without taking the transition over, this run
  // would finish the copy and then be unable to record that it had, leaving the marker `enabling`
  // for every later pass to re-run. Claiming also serialises two runs resuming at once — the one
  // that loses the conditional move stops rather than copying alongside the winner.
  if (recorded.status === "enabling") {
    return {
      sourceLocale: recorded.sourceLocale,
      // Whatever the interrupted claim owed. A re-enable over a companion that outlived a disable
      // records that its copy is destructive, because the state saying so — `restored` — is the one
      // the claim overwrote. Reading it back is what stops a crashed refresh being resumed as an
      // ordinary guarded seed, which would skip the stale rows and settle over them.
      overwriteExisting: recorded.refresh === true,
      claim: () => claimIn(recorded.sourceLocale, recorded.refresh === true),
    };
  }

  // The two cases below are NEW transitions, not continuations, so each records one before any
  // copy runs. Without that the copy would finish and `settleI18nTransition` would then refuse —
  // it has no `enabling` record to settle — leaving the marker untouched and the same failure
  // waiting on every retry. It is also the module's own ordering rule: the record goes in before
  // the statements, because MySQL commits DDL implicitly.

  // The companion outlived a disable. Main has been authoritative ever since and carries no
  // language of its own, so enabling now declares its content to be in TODAY's default — exactly
  // as a first enable does. The restore's locale described what main held at the time and has no
  // claim on what reads will look for once localization is back on; reusing it would label the
  // rows with a locale that may no longer even be configured, and hide every edit made while
  // localization was off.
  if (recorded.status === "restored") {
    return {
      sourceLocale: options.defaultLocale,
      overwriteExisting: true,
      // Recorded on the claim, because claiming replaces the `restored` state that says so.
      claim: claim(true),
    };
  }

  if (recorded.status === "untracked" && options.repairUntracked) {
    return {
      sourceLocale: options.defaultLocale,
      // Never overwriting: rows that already have a default-locale companion row are the ones a
      // previous transition did copy, and their translations must survive the repair.
      overwriteExisting: false,
      // The absence of a record is only evidence of a debt when main still holds the values.
      requireColumnsOnMain: true,
      claim: claim(false),
    };
  }
  return null;
}

/**
 * Finish a copy that an earlier run started and did not complete.
 *
 * The companion already exists, so its CREATE is not reissued — only the copy is, and only for the
 * rows that have no default-locale companion row yet. That `WHERE NOT EXISTS` is what makes this
 * safe to run repeatedly: a partially seeded companion keeps the rows it already has, and a fully
 * seeded one is a no-op. Re-copying instead would either collide on the composite primary key or
 * overwrite translations written since the transition.
 *
 * `overwriteExisting` adds a correlated UPDATE ahead of that insert, for the one case where the
 * rows already present are the stale ones: a companion that outlived a disable. The insert still
 * follows, because rows created while localization was off have no companion row at all.
 *
 * Nothing is dropped from the main table here. The interrupted run may or may not have relaxed or
 * removed its source columns, and the next schema apply reconciles that; this call is responsible
 * for the content, not the shape.
 */
async function resumeInterruptedSeed(
  adapter: CompanionIntrospectAdapter,
  args: {
    slug: string;
    tableName: string;
    dialect: SupportedDialect;
    /** Which builder made the main table — forwarded to the create it resumes. */
    builtBy: ColumnOrigin;
    status?: boolean;
    sourceLocale?: string;
    overwriteExisting?: boolean;
    requireColumnsOnMain?: boolean;
    claim?: () => Promise<CompanionClaim>;
    settleTransition?: (token: string | undefined) => Promise<boolean>;
  },
  newLocalized: CompanionFieldLike[],
  companionTableName: string,
  onError?: (error: unknown) => void
): Promise<boolean> {
  // The guard belongs to THIS path: it has read the transition record, so it knows the rows the
  // companion already holds are an interrupted copy to be kept rather than the stale remains of a
  // disable. The initial-create path has no such record and asks for the plain seed.
  const plan = await buildSeedingCreateStatements(adapter, args, newLocalized, {
    guardSeed: true,
  });
  if (!plan) return false;

  // Everything the plan emits except the CREATE, which the interrupted run already ran.
  const copy = plan.filter(statement => !statement.startsWith("CREATE TABLE"));
  if (copy.length === 0) return false;

  try {
    // The plan is real, so the transition is recorded — before the first statement, and only now
    // that there is something for it to describe.
    const claimed = await args.claim?.();
    if (args.overwriteExisting) {
      const { columns, statusOnBoth } = await localizedColumnsOnBothTables(
        adapter,
        args.tableName,
        companionTableName,
        newLocalized
      );
      // Publishing state moves while localization is off too, and the surviving companion row
      // keeps whatever `_status` it held when it was last the authority. Refreshed alongside the
      // values, and only when BOTH tables physically carry the column — the entity may have gained
      // or lost Draft/Published in the same period. Read from the same snapshot as the columns, so
      // the two cannot describe the table at different moments.
      const refreshStatus = args.status === true && statusOnBoth;
      if (columns.length > 0 || refreshStatus) {
        // Through the query builder, not a generated statement string: this is a runtime data
        // move, and only the migration FILE needs SQL text. The seed statements below still go
        // through `executeQuery` because they carry DDL, which Drizzle cannot express.
        const { refreshDefaultLocaleFromMain } = await import(
          "./companion-copy"
        );
        await refreshDefaultLocaleFromMain(adapter, {
          tableName: args.tableName,
          companionTableName,
          fields: newLocalized,
          dialect: args.dialect,
          locale: args.sourceLocale ?? "",
          columns,
          status: refreshStatus,
          refreshStatus,
          // The claim, carried into the statement. This copy overwrites the companion's
          // default-locale rows, so a run displaced between claiming and reaching here would
          // destroy translations the run that displaced it has already seeded. Checking ownership
          // beforehand cannot prevent that; a condition the database evaluates with the update can.
          guard: claimed?.guard,
        });
      }
    }
    for (const statement of copy) {
      // Issued as generated. The seed carries its guard from `buildLocalizationUpStatements`,
      // which this path asks for — matching on a statement's leading text to decide whether to
      // rewrite it made the guard a property of whoever executed the statement rather than of the
      // statement itself.
      await adapter.executeQuery(statement);
    }
    // The interrupted run's debt is discharged, so the record stops describing one.
    // A settlement that did not land means this run no longer holds the transition: someone took
    // it over while the copy ran. Reporting success would let the schema apply that follows drop
    // the main-table columns, and the taker may not have copied their values anywhere yet.
    if (
      args.settleTransition &&
      !(await args.settleTransition(claimed?.token))
    ) {
      onError?.(
        NextlyError.conflict({
          reason: "state",
          message:
            `Localization for "${args.slug}" was taken over by another process while its ` +
            `content was being copied, so this run could not record that the copy finished.`,
          logContext: { slug: args.slug },
        })
      );
      return false;
    }
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

/**
 * Whether an entity's MAIN table is physically present.
 *
 * Asked through the canonical introspection helper rather than by running a probe query and
 * catching the failure: that shape is valid on SQLite and MySQL and poisons a transaction on
 * PostgreSQL, and it is the pattern the integration harness now fails tests for.
 *
 * Provisioning uses it to tell an entity that may hold content from one the schema apply has not
 * created yet — only the first can be seeded, and only the second has to wait for its main table
 * before a companion can carry a foreign key to it.
 */
export async function mainTableExists(
  adapter: CompanionIntrospectAdapter,
  tableName: string
): Promise<boolean> {
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [tableName]
  );
  return snapshot.tables.some(t => t.name === tableName);
}

/**
 * The create-plus-seed plan, or null when a plain create is what this entity needs.
 *
 * The Schema Builder's localization toggle has always copied the main table's values into the
 * companion as it creates it; the code-first path created an empty table and stopped, so turning
 * localization on in `nextly.config.ts` left existing content sitting on the main table with every
 * read resolving through an empty companion and returning null. Same product, two provisioning
 * paths, opposite outcomes — so this routes the second one through the plan the first already uses.
 *
 * Only the localized columns that PHYSICALLY exist on the main table are seeded from. A field
 * localized in the same change has no main column to copy, and a field name is not a column name
 * (`subTitle` lives at `sub_title`), so the physical shape decides rather than the config.
 *
 * Returns null when there is nothing to copy — no source locale, or no localized column present on
 * main — because then the seeding plan and a plain create produce the same table, and the simpler
 * path is the one already covered by its own tests.
 */
async function buildSeedingCreateStatements(
  adapter: CompanionIntrospectAdapter,
  args: {
    slug: string;
    tableName: string;
    dialect: SupportedDialect;
    /** Which builder made the main table — the companion it creates has to match. */
    builtBy: ColumnOrigin;
    status?: boolean;
    sourceLocale?: string;
    requireColumnsOnMain?: boolean;
  },
  newLocalized: CompanionFieldLike[],
  options: { guardSeed?: boolean } = {}
): Promise<string[] | null> {
  if (!args.sourceLocale) return null;

  const onMain = await localizedColumnsOnMain(
    adapter,
    args.tableName,
    newLocalized
  );
  const present = new Set(onMain.map(c => c.name));

  const { deriveCompanionSpec } = await import(
    "../migration/derive-companion-spec"
  );
  const spec = deriveCompanionSpec({
    slug: args.slug,
    dbName: args.tableName,
    fields: newLocalized,
    dialect: args.dialect,
    builtBy: args.builtBy,
    defaultLocale: args.sourceLocale,
    collectionLocalized: true,
    status: args.status === true,
  });
  if (!spec) return null;

  const columnsOnMain = spec.columns
    .map(c => c.name)
    .filter(name => present.has(name));
  // Whether the main table has been reshaped for Draft/Published YET, which is a different
  // question from whether the entity has it. This copy runs before the schema push, so one
  // configuration edit turning on both localization and Draft/Published reaches here with
  // `spec.status` true and no `status` column to select from.
  const statusOnMain =
    spec.status === true &&
    (await mainTableHasColumns(adapter, args.tableName, ["status"]));
  // A repair moves values that are on main; with none to move there is nothing to repair. Status
  // alone would otherwise qualify and manufacture a row for every entry lacking one.
  if (args.requireColumnsOnMain && columnsOnMain.length === 0) return null;
  // No columns to copy is not the same as nothing to seed. A Draft/Published entity still needs a
  // default-locale companion row carrying the main row's status, or every published row drops out
  // of locale-aware published reads. `buildLocalizationUpStatements` handles the empty column set
  // for exactly that case, so only bail when there is no readable status either.
  if (columnsOnMain.length === 0 && !statusOnMain) return null;

  const { buildLocalizationUpStatements } = await import(
    "../migration/generate-up"
  );
  // Additive only: this runs unattended from boot and `db:sync`, where a dropped column is not
  // something the next boot can put back. The copies left on main are inert once reads resolve
  // through the companion, and `nextly migrate` removes them under supervision.
  return buildLocalizationUpStatements(
    { ...spec, columnsOnMain },
    {
      dropSeededColumns: false,
      guardSeed: options.guardSeed,
      // Retained columns that were required must stop being so, or the first create after this
      // transition fails: the value now goes to the companion, so the main insert omits it.
      relaxColumns: onMain.filter(c => !c.nullable).map(c => c.name),
      statusOnMain,
    }
  );
}

export async function ensureCompanionTable(
  adapter: CompanionIntrospectAdapter,
  args: {
    /**
     * Which builder made the main table. This function CREATES or ALTERS the physical companion, so
     * its columns have to match the ones the main table's builder would produce — a translatable
     * field bounded here while the same declaration is unbounded on main refuses in one language
     * what it accepts in another.
     */
    builtBy: ColumnOrigin;
    slug: string;
    tableName: string;
    fields: CompanionFieldLike[];
    dialect: SupportedDialect;
    status?: boolean;
    /**
     * The language the main table's existing content is in.
     *
     * Supplied turns creation into a TRANSITION: the values already on the main table are copied
     * into the companion as this locale's rows, so content written before localization was
     * enabled stays readable. Omitted creates an empty companion, which is only correct for an
     * entity that has never held content outside a companion.
     */
    sourceLocale?: string;
    /**
     * Durably record that this transition is starting. Called once the companion is known to be
     * absent and BEFORE any statement runs.
     *
     * Before, not after, because MySQL commits DDL implicitly: a crash between creating the table
     * and recording it would leave a companion whose next run sees the table, takes the early
     * return, and never records or completes the transition. The same window makes a failed seed
     * unrecoverable — with the record already written, a later pass can read `enabling` and finish
     * the copy.
     *
     * A failure here abandons the creation rather than proceeding without a record. An unrecorded
     * companion is the state this exists to prevent, and not creating the table leaves the next
     * run free to try again from a clean position.
     */
    recordTransition?: () => Promise<string>;
    /**
     * What an existing companion still owes, or null when it owes nothing.
     *
     * Consulted only when the companion already exists, which normally means there is nothing to
     * do. Two recorded states say otherwise. An unfinished transition: `CREATE TABLE` and the copy
     * that follows are separate statements, and MySQL commits DDL implicitly, so a failure between
     * them leaves a real companion holding none of the entity's content, and every later run would
     * take the early return and leave it hidden for good. A companion that outlived a disable: it
     * is real and its default-locale rows are stale, because main was authoritative while
     * localization was off.
     *
     * Answering here makes both recoverable by running `db:sync` again rather than by hand-editing
     * `nextly_meta`.
     */
    seedIncomplete?: () => Promise<CompanionSeedDebt | null>;
    /**
     * Record that the copy finished, so a later pass stops treating it as owed.
     *
     * Without it the marker stays `enabling` forever and every `db:sync` or reload re-runs the
     * copy — harmless for the rows it already made, but it keeps manufacturing default-locale rows
     * for entries that were deliberately created in another locale only.
     */
    settleTransition?: (token: string | undefined) => Promise<boolean>;
  },
  /**
   * Notified when creation fails. Optional so existing callers are unchanged;
   * without it the previous swallow-and-retry-next-boot behaviour is preserved.
   */
  onError?: (error: unknown) => void
): Promise<boolean> {
  const companionTableName = `${args.tableName}_locales`;
  // Tracked because only a failure of the CREATE itself can be explained away by a concurrent
  // winner. The plan may also carry a seed, and a seed that fails leaves a table this call made —
  // treating that as a lost race would suppress the error and leave the content uncopied, with
  // every later run returning early because the table now exists.
  let created = false;
  // Declared out here so the catch can tell whether this run holds the transition. Losing the
  // CREATE race after claiming is not the same as losing it before.
  let claimToken: string | undefined;
  const localizedNames = new Set(resolveLocalizedFieldNames(args.fields, true));
  const newLocalized = args.fields.filter(f => localizedNames.has(f.name));
  try {
    if (await companionTableExists(adapter, companionTableName)) {
      // An existing companion normally means there is nothing to do. It means the opposite when a
      // transition was recorded and never settled: the table is real and its content is not.
      // The RECORDED locale, not the one configured now. A default locale that changed since the
      // interrupted run must not relabel values written under the old one — that is the whole
      // reason the transition is recorded rather than inferred.
      const owed = (await args.seedIncomplete?.()) ?? null;
      if (owed !== null) {
        return await resumeInterruptedSeed(
          adapter,
          {
            ...args,
            sourceLocale: owed.sourceLocale,
            overwriteExisting: owed.overwriteExisting,
            requireColumnsOnMain: owed.requireColumnsOnMain,
            claim: owed.claim,
          },
          newLocalized,
          companionTableName,
          onError
        );
      }
      return false;
    }
    // Lazy import avoids a cycle (reconcile-companion → migration helpers).
    const { buildCompanionReconcileStatements } = await import(
      "../migration/reconcile-companion"
    );
    // A caller that cannot say which language the main table's content is in must not create the
    // companion over that content. Reads resolve through the companion once it exists, so an empty
    // one hides everything already written — and because creation is a race, the first caller to
    // win decides. Boot-time provisioning has no locale to offer, so it defers here and leaves the
    // entity to the path that does. Nothing is at risk in the meantime: a write in a language
    // other than the default is refused while the companion is absent, so the main table's values
    // cannot be overwritten by one.
    // What makes creating here unsafe is CONTENT, not shape. An entity with no rows has nothing to
    // hide, so a locale-less caller may create its companion freely — which is the ordinary case
    // for a new entity, and refusing it would leave every such entity without a companion and its
    // localized writes refused.
    //
    // With rows present, two things are at stake and either is enough to defer: translatable
    // columns on main hold values that an empty companion would mask, and a Draft/Published entity
    // needs a default-locale row carrying each main row's status or its published rows drop out of
    // locale-aware reads. The seeding plan treats both as work, so this guard has to agree.
    if (
      !args.sourceLocale &&
      (await creatingWouldHideContent(adapter, args, newLocalized))
    ) {
      onError?.(
        new Error(
          `Translations table for "${args.slug}" was not created here: this caller cannot say ` +
            `which language the existing content is in, and creating it empty would hide that ` +
            `content. Run \`nextly db:sync\` (or \`nextly migrate\` in production).`
        )
      );
      return false;
    }
    // Ordered ahead of every statement below. See `recordTransition`.
    claimToken = await args.recordTransition?.();
    const statements =
      (await buildSeedingCreateStatements(adapter, args, newLocalized)) ??
      buildCompanionReconcileStatements({
        slug: args.slug,
        tableName: args.tableName,
        builtBy: args.builtBy,
        oldLocalized: [],
        newLocalized,
        dialect: args.dialect,
        status: args.status === true,
        companionExists: false,
      });
    for (const stmt of statements) {
      await adapter.executeQuery(stmt);
      created = true;
    }
    // Only once every statement landed. Settling earlier would mark a copy complete that a later
    // statement could still fail, and the record would then say the content is in the companion
    // when it is not.
    // As in the resume path: a settlement that did not land means the transition moved on, and the
    // apply that follows must not treat this copy as the one the record describes.
    if (args.settleTransition && !(await args.settleTransition(claimToken))) {
      onError?.(
        NextlyError.conflict({
          reason: "state",
          message:
            `Localization for "${args.slug}" was taken over by another process while its ` +
            `content was being copied, so this run could not record that the copy finished.`,
          logContext: { slug: args.slug },
        })
      );
      return false;
    }
    return true;
  } catch (error) {
    // Another process may have created it between the probe and the CREATE — `db:sync` and a
    // dev boot/HMR reload provision the same companions, and `CREATE TABLE` is not idempotent
    // here. Losing that race is a success: the table the caller wanted now exists. Confirmed by
    // re-checking rather than by reading the error text, so this cannot swallow a real failure
    // that happens to mention the table.
    if (
      !created &&
      (await companionTableExists(adapter, companionTableName).catch(
        () => false
      ))
    ) {
      // Losing the race AFTER claiming is a different situation, and it cannot be reported as a
      // quiet non-creation. This run now holds the marker for a table another run made, and that
      // run may have died between creating it and seeding it — so the companion can be empty
      // while the transition reads as claimed and in progress. A caller told nothing records no
      // preservation failure, and the schema apply that follows is then free to drop the
      // main-table columns whose values have not reached the companion, after which the debt the
      // marker still describes can never be completed.
      //
      // Reported so the apply is abandoned. The next pass finds the table present and the marker
      // `enabling`, which is exactly the resume path, so this recovers rather than dead-ends.
      if (claimToken !== undefined) {
        onError?.(
          NextlyError.conflict({
            reason: "state",
            message:
              `The translations table for "${args.slug}" was created by another process while ` +
              `this one held its transition, so its content may not have been copied across yet.`,
            logContext: { slug: args.slug },
          })
        );
        return false;
      }
      // Reported as not-created on purpose: whoever won the race owns recording why
      // the companion exists, and a second record of the same transition could name
      // a different source locale.
      return false;
    }
    // Best-effort: the main table may not exist yet on a very first boot, where the
    // companion is created on the next boot (or by `nextly migrate`). That case is
    // expected and self-healing. Anything else is NOT — a persistent failure here
    // leaves the entity marked localized with no place to store translations, and
    // swallowing it silently is how that state went unnoticed. Report it through
    // the optional reporter so a caller (db:sync, boot) can surface it; the
    // function still resolves, because refusing to boot over a companion is worse
    // than booting with non-default-locale writes refused.
    onError?.(error);
    return false;
  }
}
