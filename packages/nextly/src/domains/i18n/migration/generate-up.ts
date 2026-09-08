import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { TableSpec } from "../../schema/pipeline/diff/types";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import {
  COMPANION_DEFAULT_STATUS,
  COMPANION_KEY_COLUMNS,
  COMPANION_STATUS_COLUMN,
  COMPANION_UPDATED_AT_COLUMN,
} from "../companion-columns";

import { ddlType, lit, q } from "./ddl-types";
import type {
  CompanionCopyRef,
  CompanionMigrationSpec,
  LocalizedColumnSpec,
} from "./types";

/** The `CREATE TABLE <companion> (...)` statement (no trailing `;`). Shared by the
 *  enable UP and the create-only path so the companion shape stays identical. */

/**
 * Companion column NAMES are defined in the `companion-columns` leaf and re-exported here.
 *
 * They moved so the runtime WRITE path can import a column name without pulling this module's
 * DDL/diff graph behind it — `generate-up` is reached by dynamic `import()` from the runtime for
 * exactly that reason, and naming a column is not a reason to load a DDL pipeline. Re-exported
 * rather than relocated outright because this is the path every existing reader already imports
 * them from, and moving their import site is not a change any of them asked for.
 */
export {
  COMPANION_DEFAULT_STATUS,
  COMPANION_KEY_COLUMNS,
  COMPANION_OPTIONAL_STRUCTURAL_COLUMNS,
  COMPANION_STATUS_COLUMN,
  COMPANION_STRUCTURAL_COLUMNS,
  COMPANION_UPDATED_AT_COLUMN,
} from "../companion-columns";

/**
 * The logical kind {@link COMPANION_UPDATED_AT_COLUMN} is rendered from.
 *
 * Routed through `ddlType` rather than hand-spelled beside `_status` so this
 * column is, per dialect, exactly what every other timestamp in a companion
 * would be: `TIMESTAMPTZ` / `DATETIME(3)` / `INTEGER`.
 *
 * That is also what makes the back-fill safe. `nextly_versions.created_at` has
 * the SAME type on all three dialects, so seeding this column from version
 * history is a plain `MAX(created_at)` copy with no per-dialect conversion —
 * and a conversion expression is precisely where a back-fill would go wrong
 * silently, writing plausible timestamps that produce confident wrong answers.
 */
const COMPANION_UPDATED_AT_SPEC: LocalizedColumnSpec = {
  name: COMPANION_UPDATED_AT_COLUMN,
  kind: "timestamp",
};

/** The `_updated_at` column definition for a `CREATE TABLE`/`ADD COLUMN`. */
export function companionUpdatedAtDdl(dialect: SupportedDialect): string {
  return `${q(COMPANION_UPDATED_AT_COLUMN, dialect)} ${ddlType(COMPANION_UPDATED_AT_SPEC, dialect)}`;
}

function buildCompanionCreateStatement(
  spec: CompanionMigrationSpec,
  ifNotExists: boolean
): string {
  const { dialect, mainTable, companionTable, parentIdType, columns } = spec;
  const colDefs = columns
    .map(c => `  ${q(c.name, dialect)} ${ddlType(c, dialect)}`)
    .join(",\n");
  // i18n M6: per-locale draft/publish status column (only when the collection has Draft/Published).
  const statusDef = spec.status
    ? `  ${q(COMPANION_STATUS_COLUMN, dialect)} VARCHAR(20) NOT NULL DEFAULT '${COMPANION_DEFAULT_STATUS}',\n`
    : "";
  // i18n B2: when this locale was last written. Unconditional — every companion
  // gets it, unlike `_status` — and deliberately nullable with no DEFAULT: a
  // freshly created companion has no rows to mis-seed, and keeping the shape
  // identical to the one `reconcileCompanionColumns` ADDs to an existing table
  // means a table created today and a table migrated into today are the same
  // table. A DEFAULT here would be the one place the two could diverge.
  const updatedAtDef = `  ${companionUpdatedAtDdl(dialect)},\n`;
  // 🔴 `IF NOT EXISTS` is OPT-IN, and only an emitted migration FILE may ask for it.
  //
  // A file reaches a database that very often already has the companion: `ensureCompanionTable`
  // runs at boot and on every `db:sync`, so any project that ran the dev server before adopting
  // migrations arrives with the table present. The file is applied verbatim, statement by
  // statement, with no enclosing transaction — so without the guard `migrate` dies on the first
  // companion file having already committed the ones before it. The guard is honest there: a
  // companion's shape is fully determined by its entity's localized fields, so a table under this
  // name IS this table.
  //
  // The RUNTIME must keep the bare form. `ensureCompanionTable` detects a lost create race by the
  // `CREATE TABLE` failing — its catch branch says so outright — and uses that to tell a process
  // that lost the race before claiming the transition from one that lost it after, which must
  // abandon the apply rather than settle over a companion another process may not have seeded.
  // `IF NOT EXISTS` would silence that signal and let both callers proceed as creators.
  return (
    `CREATE TABLE${ifNotExists ? " IF NOT EXISTS" : ""} ${q(companionTable, dialect)} (\n` +
    `  ${q("_parent", dialect)} ${parentIdType} NOT NULL,\n` +
    `  ${q("_locale", dialect)} VARCHAR(20) NOT NULL,\n` +
    statusDef +
    updatedAtDef +
    `${colDefs},\n` +
    `  PRIMARY KEY (${COMPANION_KEY_COLUMNS.map(c => q(c, dialect)).join(", ")}),\n` +
    `  FOREIGN KEY (${q("_parent", dialect)}) REFERENCES ${q(mainTable, dialect)} (${q("id", dialect)}) ON DELETE CASCADE\n` +
    `)`
  );
}

/**
 * `CREATE TABLE` for a companion that already exists, rebuilt from what the
 * database actually has.
 *
 * The spec-derived form above renders columns from their logical KIND, which is
 * the right source when a field describes each one. A companion standing in a
 * database being adopted may hold a column no field describes — and its logical
 * kind is unrecoverable, while its physical type is right there. Rendering the
 * introspected columns directly is therefore not a fallback but the more
 * faithful path: it reproduces the table as it is, with no kind→type round trip
 * to lose anything.
 *
 * Two things a snapshot cannot express are added back. The composite key comes
 * free — introspection records `primaryKey` per column, so `createTableBody`
 * emits `PRIMARY KEY (_parent, _locale)` from the live shape. The foreign key
 * does not exist in the snapshot model at all, so it is spelled here, and
 * INLINE: SQLite cannot add a constraint by `ALTER` at any point after the
 * table is created.
 */
export function buildCompanionCreateFromLive(args: {
  live: TableSpec;
  mainTable: string;
  dialect: SupportedDialect;
}): string {
  const { live, mainTable, dialect } = args;
  const quote = (id: string): string => q(id, dialect);
  const body = createTableBody(live, quote);
  // `IF NOT EXISTS` for the same reason the spec-derived file form uses it: a
  // baseline reaches databases that already have the companion, and the file is
  // applied statement by statement with no enclosing transaction.
  return (
    `CREATE TABLE IF NOT EXISTS ${quote(live.name)} (\n` +
    `${body},\n` +
    `  FOREIGN KEY (${quote("_parent")}) REFERENCES ${quote(mainTable)} (${quote("id")}) ON DELETE CASCADE\n` +
    `);`
  );
}

/**
 * The `WHERE NOT EXISTS` that lets a seed skip rows the companion already has.
 *
 * 🔴 Requested by the RUNTIME resume only, never emitted into a migration file, and the asymmetry
 * is a data-safety decision rather than an oversight.
 *
 * Two states leave a companion holding default-locale rows, and they need OPPOSITE handling. An
 * interrupted copy leaves rows that came from main and must be kept. A companion that outlived a
 * *disable* leaves rows that are stale by definition, because main was authoritative while
 * localization was off — skipping those and then dropping main's columns reverts every edit made
 * in between. Only the transition record distinguishes them, which is why the runtime consults it
 * and sets `overwriteExisting`.
 *
 * A migration file has no such record: it is static SQL. Guarding its seed would make it silently
 * pick the wrong answer in the second state, whereas leaving it unguarded makes it collide on the
 * composite primary key — loudly, with nothing lost. A loud stop beats a quiet revert.
 */
function buildSeedGuard(spec: CompanionMigrationSpec): string {
  const { dialect, mainTable, companionTable, defaultLocale } = spec;
  const comp = q(companionTable, dialect);
  const main = q(mainTable, dialect);
  return (
    ` WHERE NOT EXISTS (SELECT 1 FROM ${comp} ` +
    `WHERE ${comp}.${q("_parent", dialect)} = ${main}.${q("id", dialect)} ` +
    `AND ${comp}.${q("_locale", dialect)} = ${lit(defaultLocale)})`
  );
}

/**
 * Create-only companion migration for a FRESH localized collection: just the
 * `CREATE TABLE <companion>`. No seed (the main table never held the localized columns)
 * and no main-table drop. Used when a collection is localized from birth.
 */
export function buildCompanionCreateOnlySql(
  spec: CompanionMigrationSpec,
  options: { emittedToFile?: boolean } = {}
): string {
  // Defaults to the runtime form. Two of this function's three callers execute the statement
  // immediately rather than writing it to a file, so an opt-in default keeps them on today's
  // behaviour and makes the file emitter say what it is.
  return `${buildCompanionCreateStatement(spec, options.emittedToFile === true)};`;
}

/**
 * UP migration for ENABLING localization on a collection's columns:
 *   1. CREATE the companion `_locales` table (composite PK, FK to main.id ON DELETE CASCADE)
 *   2. INSERT ... SELECT existing values as the default-locale rows (the data copy — the
 *      one thing the diff pipeline cannot do; this rides the verbatim file-migration path)
 *   3. DROP the relocated columns from the main table
 *
 * Returned as one SQL string; statements are `;`-terminated and blank-line separated.
 * Companion columns are created nullable (localized columns are always nullable).
 */
export function buildLocalizationUpSql(spec: CompanionMigrationSpec): string {
  return buildLocalizationUpStatements(spec, { emittedToFile: true })
    .map(s => `${s};`)
    .join("\n\n");
}

/** Options for {@link buildLocalizationUpStatements}. */
export interface LocalizationUpOptions {
  /**
   * Whether to DROP the seeded columns from the main table once their values are copied.
   *
   * True for an explicit transition — a Builder toggle or a migration file — where relocating
   * the data is the whole point and leaving the originals behind would give a field two homes.
   *
   * False for **unattended** provisioning (boot, `db:sync`, the dev reload path). Those are
   * additive-only by policy, and a dropped column is not something the next boot can put back.
   * The result is a companion that holds the content and a main table still carrying the
   * originals: reads resolve through the companion, the stale copies harm nothing, and
   * `nextly migrate` can remove them under supervision. Redundant beats unrecoverable.
   */
  dropSeededColumns?: boolean;
  /**
   * Retained columns that are NOT NULL on the main table and must stop being so.
   *
   * Only meaningful with `dropSeededColumns: false`. A field that was required before localization
   * leaves a NOT NULL column behind, and once the companion exists its value is written there
   * instead — so the main insert omits it and every subsequent create fails the constraint. The
   * column has to be relaxed or removed; leaving it as-is breaks writes outright.
   */
  relaxColumns?: readonly string[];
  /**
   * Whether the main table PHYSICALLY carries its `status` column yet.
   *
   * `spec.status` says the entity has Draft/Published, which decides whether the companion gets a
   * per-locale `_status`. It does not say the main table has been reshaped to match. One
   * configuration edit can turn on localization and Draft/Published together, and the copy runs
   * before the schema push — so the companion is created correctly while `SELECT status FROM main`
   * addresses a column that does not exist yet. The seed fails, and because the companion now
   * exists every retry reaches the same statement, so that combination could never apply.
   *
   * Omitting a status the seed cannot read costs nothing here: the main column is created
   * `NOT NULL DEFAULT 'draft'` and the companion's `_status` carries the same default, so rows
   * gaining Draft/Published in this edit end up in the same state on both sides either way.
   *
   * Defaults to `spec.status`, which is right for a migration file and for the Builder toggle:
   * both run against a main table that already has the column.
   */
  statusOnMain?: boolean;
  /**
   * Whether the companion `CREATE TABLE` may carry `IF NOT EXISTS`.
   *
   * True only for statements written into a migration FILE, which is applied verbatim against a
   * database that has usually provisioned the companion already. The runtime leaves it false so
   * `ensureCompanionTable` keeps detecting a lost create race by the statement failing.
   */
  emittedToFile?: boolean;
  /**
   * Whether the seed should skip rows the companion already holds.
   *
   * Asked for by the runtime resume, which has read the transition record and therefore knows the
   * existing rows are an interrupted copy rather than the stale remains of a disable. See
   * {@link buildSeedGuard} for why a migration file must not ask for it.
   */
  guardSeed?: boolean;
}

/**
 * Statement-array form of {@link buildLocalizationUpSql} (no trailing `;` per element). The
 * runtime enable path (a Builder-entity localization toggle, which has no migration file) runs
 * these individually via the adapter, so it does not have to split a joined string on `;`.
 *
 * Drops the relocated columns by default, which is what both existing callers want.
 */
export function buildLocalizationUpStatements(
  spec: CompanionMigrationSpec,
  options: LocalizationUpOptions = {}
): string[] {
  const { dialect, mainTable, companionTable, defaultLocale, columns } = spec;

  const create = buildCompanionCreateStatement(
    spec,
    options.emittedToFile === true
  );

  // Only columns already on the main table can be seeded from or dropped. A field added and
  // localized in the same save is in `columns` (so the companion gets it) but not on main, so
  // it is excluded from the SELECT and the DROP. Undefined `columnsOnMain` means "all" — the
  // file-migration path, where every localized column pre-exists on main.
  const onMainSet = spec.columnsOnMain && new Set(spec.columnsOnMain);
  const onMain = onMainSet
    ? columns.filter(c => onMainSet.has(c.name))
    : columns;
  // A leading ", <col>" per column, so an empty set contributes nothing to the column lists.
  const onMainCols = onMain.map(c => `, ${q(c.name, dialect)}`).join("");

  // When the collection has Draft/Published, the seeded default-locale rows carry the existing
  // main row's `status` into the companion `_status` so enabling localization doesn't silently
  // un-publish live content. Only when main actually has the column to read — see `statusOnMain`.
  const copiesStatus = spec.status === true && options.statusOnMain !== false;
  const statusInsertCol = copiesStatus ? `, ${q("_status", dialect)}` : "";
  const statusSelectCol = copiesStatus ? `, ${q("status", dialect)}` : "";

  // Skip the seed entirely when there is nothing on main to copy — no pre-existing translatable
  // columns and no status to carry across. An INSERT with an empty value list would be invalid
  // SQL, and there is no existing content to preserve.
  const seed =
    onMain.length > 0 || copiesStatus
      ? [
          `INSERT INTO ${q(companionTable, dialect)} ` +
            `(${q("_parent", dialect)}, ${q("_locale", dialect)}${statusInsertCol}${onMainCols}) ` +
            `SELECT ${q("id", dialect)}, ${lit(defaultLocale)}${statusSelectCol}${onMainCols} ` +
            `FROM ${q(mainTable, dialect)}` +
            (options.guardSeed === true ? buildSeedGuard(spec) : ""),
        ]
      : [];

  const retaining = options.dropSeededColumns === false;
  const mustRelax = new Set(options.relaxColumns ?? []);
  const constrained = onMain.filter(c => mustRelax.has(c.name));

  // SQLite cannot change a column's nullability — the schema pipeline refuses `change_column_nullable`
  // for it, and the only alternative is rebuilding the table. So a retained NOT NULL column is
  // dropped there instead: its value has just been copied into the companion, whereas leaving it
  // would fail every create from this point on. Retaining is a safety measure, and a column that
  // breaks writes is not the safe option.
  const relaxations = retaining
    ? constrained.map(c =>
        dialect === "sqlite"
          ? `ALTER TABLE ${q(mainTable, dialect)} DROP COLUMN ${q(c.name, dialect)}`
          : relaxNotNull(mainTable, c, dialect)
      )
    : [];

  const drops = retaining
    ? []
    : onMain.map(
        c =>
          `ALTER TABLE ${q(mainTable, dialect)} DROP COLUMN ${q(c.name, dialect)}`
      );

  return [create, ...seed, ...relaxations, ...drops];
}

/**
 * Overwrite the default locale's companion values from the main row — one correlated UPDATE
 * covering every column in `columnNames`.
 *
 * The inverse of the restore in `generate-down`, and needed for the one case where the seed's
 * usual `INSERT ... WHERE NOT EXISTS` does the wrong thing: re-enabling localization on an entity
 * whose companion survived a previous disable. Those default-locale rows are real, so an insert
 * guarded on their absence skips them — and they are stale, because main has been authoritative
 * ever since the disable. Skipping them reverts every edit made while localization was off.
 *
 * Written as an UPDATE rather than an upsert deliberately: the three dialects spell conflict
 * handling three different ways, while a correlated UPDATE is the same statement everywhere and is
 * already the shape the restore uses. Rows the companion does not have yet are not this
 * statement's job — the guarded insert that follows adds them.
 *
 * `refreshStatus` carries the main row's `status` into the companion's `_status` alongside the
 * values. Publishing state moves too while localization is off, and the companion row that
 * survives the disable keeps whatever status it had when it was last the authority — so a page
 * published in the meantime stays hidden from locale-aware published reads, and one unpublished in
 * the meantime keeps being served. The guarded insert cannot correct it either, because the row it
 * would fix already exists.
 *
 * ONE statement covering every column, for the same reason the restore is one: a refresh that
 * lands half-way leaves the companion holding a mixture with nothing recording that it did.
 */
export function buildDefaultLocaleRefreshStatements(
  spec: CompanionCopyRef,
  columnNames: readonly string[],
  options: { refreshStatus?: boolean } = {}
): string[] {
  const { dialect, mainTable, companionTable, defaultLocale } = spec;
  const comp = q(companionTable, dialect);
  const main = q(mainTable, dialect);
  const correlate = `${main}.${q("id", dialect)} = ${comp}.${q("_parent", dialect)}`;
  const copy = (target: string, source: string) =>
    `${target} = (SELECT ${source} FROM ${main} WHERE ${correlate})`;

  const assignments = columnNames.map(name =>
    copy(q(name, dialect), q(name, dialect))
  );
  if (options.refreshStatus) {
    // The companion's `_status` is NOT NULL DEFAULT 'draft' while main's `status` need not be —
    // an older shape, or a column added nullable, can hold NULL. Assigning it straight through
    // violates the constraint, and because the transition stays unsettled every later pass
    // replays the same statement. Defaulted to the value the companion's own DDL uses.
    assignments.push(
      `${q("_status", dialect)} = COALESCE(` +
        `(SELECT ${q("status", dialect)} FROM ${main} WHERE ${correlate}), ` +
        `${lit(COMPANION_DEFAULT_STATUS)})`
    );
  }
  if (assignments.length === 0) return [];

  return [
    `UPDATE ${comp} SET ${assignments.join(", ")} ` +
      `WHERE ${comp}.${q("_locale", dialect)} = ${lit(defaultLocale)}`,
  ];
}

/**
 * Make one main-table column nullable.
 *
 * PostgreSQL states the change directly; MySQL has no equivalent and must restate the whole
 * column definition, which is why the type is rebuilt here rather than read back from the server.
 * SQLite supports neither and never reaches this.
 */
function relaxNotNull(
  mainTable: string,
  col: Parameters<typeof ddlType>[0],
  dialect: CompanionMigrationSpec["dialect"]
): string {
  const table = q(mainTable, dialect);
  const name = q(col.name, dialect);
  return dialect === "mysql"
    ? `ALTER TABLE ${table} MODIFY COLUMN ${name} ${ddlType(col, dialect)} NULL`
    : `ALTER TABLE ${table} ALTER COLUMN ${name} DROP NOT NULL`;
}
