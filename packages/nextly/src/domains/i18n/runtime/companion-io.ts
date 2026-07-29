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
 * What provisioning additionally needs: the Drizzle handle, so the physical shape of a table can
 * be read through the shared introspection helper instead of being guessed at with probe queries.
 * Kept separate from {@link CompanionWriteAdapter} so the read/write helpers, which never
 * introspect, keep their narrower contract.
 */
interface CompanionProvisionAdapter extends CompanionWriteAdapter {
  getDrizzle<T = unknown>(): T;
}

/**
 * The physical columns of `tableNames`, keyed by table, via the same introspection the schema
 * pipeline uses. One round trip answers for every table and column at once, and — unlike a
 * `SELECT <col> ... LIMIT 0` probe — a failure is a real failure rather than being indistinguishable
 * from "that column is not there".
 */
async function readPhysicalColumns(
  adapter: CompanionProvisionAdapter,
  tableNames: string[]
): Promise<Map<string, Set<string>>> {
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    tableNames
  );
  return new Map(
    snapshot.tables.map(table => [
      table.name,
      new Set(table.columns.map(column => column.name)),
    ])
  );
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
 * not already exist, and seed it from the main table when localization is being turned on for an
 * entity that already holds content. Idempotent and safe to run on every boot — a no-op once the
 * table exists and is seeded (or when the entity has no translatable fields). This is the
 * db:sync/dev-boot counterpart to the migration-owned companion creation (`nextly migrate`), so a
 * code-first localized collection / single / component gets a working companion without a manual
 * migrate step. Best-effort: a failure (e.g. main table not yet created) is swallowed so it
 * retries on the next boot.
 */
export async function ensureCompanionTable(
  adapter: CompanionProvisionAdapter,
  args: {
    slug: string;
    tableName: string;
    fields: CompanionFieldLike[];
    dialect: SupportedDialect;
    status?: boolean;
    /**
     * The language existing main-table values belong to. Supplying it enables the seed below;
     * without it the companion is created empty, which is the pre-existing behaviour and is only
     * correct for an entity that never held content on main.
     */
    defaultLocale?: string;
  },
  /**
   * Notified when creation fails. Optional so existing callers are unchanged;
   * without it the previous swallow-and-retry-next-boot behaviour is preserved.
   */
  onError?: (error: unknown) => void
): Promise<void> {
  const companionTableName = `${args.tableName}_locales`;
  try {
    const alreadyExists = await companionTableExists(
      adapter,
      companionTableName
    );
    // Lazy import avoids a cycle (reconcile-companion → migration helpers).
    const { buildCompanionReconcileStatements } = await import(
      "../migration/reconcile-companion"
    );
    const localizedNames = new Set(
      resolveLocalizedFieldNames(args.fields, true)
    );
    const localizedFields = args.fields.filter(f => localizedNames.has(f.name));
    // An EXISTING companion still has to be reconciled. The schema push pipeline
    // deliberately skips companion tables, so marking another field localized (or
    // turning on Draft/Published) adds a column the companion never gets: reads and
    // writes then address a shape the physical table does not have, and the seed
    // below would reference a column that is not there. Passing the columns the
    // companion actually has as `oldLocalized` makes this an ADD of exactly what is
    // missing. Dropping columns is left out on purpose — a column that disappeared
    // from the config still holds content, and removing it is the pipeline's gated,
    // confirmable job rather than something an unattended boot should decide.
    // One introspection answers both questions below: which localized columns the
    // companion already has, and which are still on the main table for the seed.
    const physical = await readPhysicalColumns(adapter, [
      args.tableName,
      companionTableName,
    ]);
    const companionColumns = physical.get(companionTableName) ?? new Set();
    const oldLocalized = alreadyExists
      ? localizedFields.filter(f => companionColumns.has(toColumn(f.name)))
      : [];
    const statements = buildCompanionReconcileStatements({
      slug: args.slug,
      tableName: args.tableName,
      oldLocalized,
      newLocalized: localizedFields,
      dialect: args.dialect,
      status: args.status === true,
      companionExists: alreadyExists,
    });
    for (const stmt of statements) {
      await adapter.executeQuery(stmt);
    }
    await seedCompanionFromMain(adapter, {
      mainColumns: physical.get(args.tableName) ?? new Set(),
      slug: args.slug,
      tableName: args.tableName,
      companionTableName,
      localizedFields,
      dialect: args.dialect,
      status: args.status === true,
      defaultLocale: args.defaultLocale,
    });
  } catch (error) {
    // Best-effort: the main table may not exist yet on a very first boot, where the
    // companion is created on the next boot (or by `nextly migrate`). That case is
    // expected and self-healing. Anything else is NOT — a persistent failure here
    // leaves the entity marked localized with no place to store translations, and
    // swallowing it silently is how that state went unnoticed. Report it through
    // the optional reporter so a caller (db:sync, boot) can surface it; the
    // function still resolves, because refusing to boot over a companion is worse
    // than booting with non-default-locale writes refused.
    onError?.(error);
  }
}

/**
 * Copy the main table's existing values into the companion as default-locale rows.
 *
 * Creating the companion is not enough on its own. Once the table exists, a read resolves each
 * localized field through it, finds no row for the default locale, and overlays null — so an
 * entity that already had content shows empty fields everywhere while the values sit untouched on
 * the main table. Enabling localization on existing content therefore made that content
 * invisible, not merely unwritable.
 *
 * Deliberately narrow, because this runs unattended on every boot and sync:
 *
 *  - only while the companion holds NO row in a non-default language. That is what separates a
 *    transition still in progress from an entity that has been localized for a while, and the
 *    two need opposite treatment. Mid-transition the main columns are the default language and
 *    backfilling them is the whole point. Once real translations exist, the main columns are
 *    frozen leftovers that stopped being updated when writes moved to the companion — seeding
 *    from them would be fabrication. Changing `localization.defaultLocale` afterwards is the
 *    sharp case: switching `en` to `fr` would otherwise invent French rows holding stale English
 *    text and suppress the fallback that would have shown the real value.
 *  - only for main rows that have NO row in the default language yet, so it never overwrites a
 *    translation and is safe to re-run. Row-level rather than table-level: a companion that
 *    already holds one such row (someone edited a single entry mid-transition) must not stop
 *    every other row from being backfilled, or those stay unreadable forever.
 *  - only for localized columns that are STILL on the main table, read from the introspected
 *    shape. After the columns are dropped there is nothing left to copy.
 *  - it does NOT drop those columns afterwards. That is the destructive half of the transition
 *    and the schema pipeline gates it behind an explicit confirmation; making the content visible
 *    again does not require it, and doing it here would route around that gate.
 */
async function seedCompanionFromMain(
  adapter: CompanionWriteAdapter,
  args: {
    /** Physical columns the main table currently has, from the caller's introspection. */
    mainColumns: Set<string>;
    slug: string;
    tableName: string;
    companionTableName: string;
    localizedFields: CompanionFieldLike[];
    dialect: SupportedDialect;
    status: boolean;
    defaultLocale?: string;
  }
): Promise<void> {
  if (!args.defaultLocale || args.localizedFields.length === 0) return;

  const { deriveCompanionSpec } = await import(
    "../migration/derive-companion-spec"
  );
  const spec = deriveCompanionSpec({
    slug: args.slug,
    dbName: args.tableName,
    fields: args.localizedFields,
    dialect: args.dialect,
    defaultLocale: args.defaultLocale,
    collectionLocalized: true,
    status: args.status,
  });
  if (!spec) return;

  // The transition test. See the note above: once any other language has a row,
  // the main columns are stale leftovers rather than the default language.
  if (await companionHasTranslations(adapter, args)) return;

  const columnsOnMain = spec.columns
    .filter(column => args.mainColumns.has(column.name))
    .map(column => column.name);
  if (columnsOnMain.length === 0) return;

  const { buildCompanionSeedStatement } = await import(
    "../migration/generate-up"
  );
  const seed = buildCompanionSeedStatement(
    { ...spec, columnsOnMain },
    { onlyMissing: true }
  );
  if (seed) await adapter.executeQuery(seed);
}

/**
 * Whether the companion already holds a row in some language other than the default — the signal
 * that this entity is past its transition and its main columns are no longer the default language.
 */
async function companionHasTranslations(
  adapter: CompanionWriteAdapter,
  args: { companionTableName: string; defaultLocale?: string }
): Promise<boolean> {
  const isMysql = adapter.dialect === "mysql";
  const table = isMysql
    ? `\`${args.companionTableName}\``
    : `"${args.companionTableName}"`;
  const locale = isMysql ? "`_locale`" : `"_locale"`;
  const rows = await adapter.executeQuery(
    `SELECT 1 FROM ${table} WHERE ${locale} <> ${adapter.dialect === "postgresql" ? "$1" : "?"} LIMIT 1`,
    [args.defaultLocale]
  );
  return rows.length > 0;
}
