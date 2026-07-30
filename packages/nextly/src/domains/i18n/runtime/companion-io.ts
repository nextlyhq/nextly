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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { toSnakeCase as toCanonicalSnakeCase } from "../../schema/services/field-column-descriptor";
import { resolveLocalizedFieldNames } from "../classify-fields";
import type { LocalizedFieldRef } from "../companion-join";

import { buildCompanionRuntimeTable } from "./companion-registration";

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
export async function upsertCompanionRow(
  adapter: CompanionWriteAdapter,
  companionTableName: string,
  parentId: string,
  locale: string,
  companionData: Record<string, unknown>,
  status?: string
): Promise<void> {
  const withStatus =
    status !== undefined
      ? { ...companionData, _status: status }
      : companionData;
  const cols = Object.keys(withStatus);
  if (cols.length === 0) return;

  const isMysql = adapter.dialect === "mysql";
  const q = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
  const params: unknown[] = [];
  const ph = () =>
    adapter.dialect === "postgresql" ? `$${params.length}` : "?";

  const allCols = ["_parent", "_locale", ...cols];
  const valuePlaceholders = allCols
    .map(c => {
      params.push(
        c === "_parent" ? parentId : c === "_locale" ? locale : withStatus[c]
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
export async function reconcileCompanionColumns(
  adapter: CompanionIntrospectAdapter,
  args: {
    slug: string;
    tableName: string;
    fields: CompanionFieldLike[];
    dialect: SupportedDialect;
    status?: boolean;
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
    // builder runs.
    if (desired.every(f => present.has(toColumn(f.name)))) return;

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
      status: hasStatus,
      companionHasStatus: hasStatus,
      companionExists: true,
    });
    for (const stmt of statements) {
      await adapter.executeQuery(stmt);
    }
  } catch (error) {
    // Same check-then-act window as the create path: a concurrent sync or reload may have added
    // the very columns this run was adding, and `ADD COLUMN` is not idempotent. Re-introspect
    // and treat "the shape we wanted is now present" as success, whoever produced it.
    try {
      const { introspectLiveSnapshot: reread } = await import(
        "../../schema/pipeline/diff/introspect-live"
      );
      const after = await reread(adapter.getDrizzle(), adapter.dialect, [
        companionTableName,
      ]);
      const now = new Set(
        after.tables
          .find(t => t.name === companionTableName)
          ?.columns.map(c => c.name) ?? []
      );
      if (desired.every(f => now.has(toColumn(f.name)))) return;
    } catch {
      // Fall through to reporting the original error: if we cannot even re-read the table,
      // the reconcile genuinely did not succeed.
    }
    onError?.(error);
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
 * on an already-provisioned companion. A missing column throws on the probe select → false.
 */
export async function companionHasStatusColumn(
  adapter: CompanionWriteAdapter,
  companionTableName: string
): Promise<boolean> {
  const isMysql = adapter.dialect === "mysql";
  const table = isMysql
    ? `\`${companionTableName}\``
    : `"${companionTableName}"`;
  const col = isMysql ? "`_status`" : `"_status"`;
  try {
    await adapter.executeQuery(`SELECT ${col} FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
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
 * Finish a copy that an earlier run started and did not complete.
 *
 * The companion already exists, so its CREATE is not reissued — only the copy is, and only for the
 * rows that have no default-locale companion row yet. That `WHERE NOT EXISTS` is what makes this
 * safe to run repeatedly: a partially seeded companion keeps the rows it already has, and a fully
 * seeded one is a no-op. Re-copying instead would either collide on the composite primary key or
 * overwrite translations written since the transition.
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
    status?: boolean;
    sourceLocale?: string;
  },
  newLocalized: CompanionFieldLike[],
  companionTableName: string,
  onError?: (error: unknown) => void
): Promise<boolean> {
  const plan = await buildSeedingCreateStatements(adapter, args, newLocalized);
  if (!plan) return false;

  // Everything the plan emits except the CREATE, which the interrupted run already ran.
  const copy = plan.filter(statement => !statement.startsWith("CREATE TABLE"));
  if (copy.length === 0) return false;

  const q = (id: string) =>
    args.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
  const companion = q(companionTableName);
  const main = q(args.tableName);
  const guard =
    ` WHERE NOT EXISTS (SELECT 1 FROM ${companion} ` +
    `WHERE ${companion}.${q("_parent")} = ${main}.${q("id")} ` +
    `AND ${companion}.${q("_locale")} = '${args.sourceLocale ?? ""}')`;

  try {
    for (const statement of copy) {
      // Only the INSERT ... SELECT is row-producing and therefore needs the guard; anything else
      // the plan carries (a nullability relax, for instance) is already idempotent.
      await adapter.executeQuery(
        statement.startsWith("INSERT INTO") ? `${statement}${guard}` : statement
      );
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
    status?: boolean;
    sourceLocale?: string;
  },
  newLocalized: CompanionFieldLike[]
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
    defaultLocale: args.sourceLocale,
    collectionLocalized: true,
    status: args.status === true,
  });
  if (!spec) return null;

  const columnsOnMain = spec.columns
    .map(c => c.name)
    .filter(name => present.has(name));
  // No columns to copy is not the same as nothing to seed. A Draft/Published entity still needs a
  // default-locale companion row carrying the main row's status, or every published row drops out
  // of locale-aware published reads. `buildLocalizationUpStatements` handles the empty column set
  // for exactly that case, so only bail when there is no status either.
  if (columnsOnMain.length === 0 && !spec.status) return null;

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
      // Retained columns that were required must stop being so, or the first create after this
      // transition fails: the value now goes to the companion, so the main insert omits it.
      relaxColumns: onMain.filter(c => !c.nullable).map(c => c.name),
    }
  );
}

export async function ensureCompanionTable(
  adapter: CompanionIntrospectAdapter,
  args: {
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
    recordTransition?: () => Promise<void>;
    /**
     * Whether a transition was recorded for this entity but never finished.
     *
     * Consulted only when the companion already exists. `CREATE TABLE` and the copy that follows
     * are separate statements, and MySQL commits DDL implicitly, so a failure between them leaves
     * a real companion holding none of the entity's content. Every later run would take the early
     * return and the content would stay hidden for good.
     *
     * Returning true makes this call finish what the interrupted one started, so a reported
     * failure is fixed by running `db:sync` again rather than by hand-editing `nextly_meta`.
     */
    seedIncomplete?: () => Promise<boolean>;
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
  const localizedNames = new Set(resolveLocalizedFieldNames(args.fields, true));
  const newLocalized = args.fields.filter(f => localizedNames.has(f.name));
  try {
    if (await companionTableExists(adapter, companionTableName)) {
      // An existing companion normally means there is nothing to do. It means the opposite when a
      // transition was recorded and never settled: the table is real and its content is not.
      if (args.sourceLocale && (await args.seedIncomplete?.()) === true) {
        return await resumeInterruptedSeed(
          adapter,
          args,
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
    // entity to the path that does; #382's write guard keeps a non-default write from doing damage
    // in the meantime.
    // `args.status` counts as something to seed even with no column to copy: a Draft/Published
    // entity needs a default-locale companion row carrying the main row's status, or its published
    // rows drop out of locale-aware published reads. The seeding plan already treats status that
    // way, so this guard has to agree or a locale-less caller creates the very companion the plan
    // would have populated.
    if (
      !args.sourceLocale &&
      (args.status === true ||
        (await localizedColumnsOnMain(adapter, args.tableName, newLocalized))
          .length > 0)
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
    await args.recordTransition?.();
    const statements =
      (await buildSeedingCreateStatements(adapter, args, newLocalized)) ??
      buildCompanionReconcileStatements({
        slug: args.slug,
        tableName: args.tableName,
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
