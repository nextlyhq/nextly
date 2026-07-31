import { ddlType, lit, q } from "./ddl-types";
import type { CompanionCopyRef, CompanionMigrationSpec } from "./types";

/** The `CREATE TABLE <companion> (...)` statement (no trailing `;`). Shared by the
 *  enable UP and the create-only path so the companion shape stays identical. */

/**
 * The status a companion row takes when one is created without an explicit
 * `_status` — the DDL default below. Exported so write paths that need to know
 * what a freshly-upserted locale row holds read it from the definition rather
 * than repeating the literal.
 */
export const COMPANION_DEFAULT_STATUS = "draft";

function buildCompanionCreateStatement(spec: CompanionMigrationSpec): string {
  const { dialect, mainTable, companionTable, parentIdType, columns } = spec;
  const colDefs = columns
    .map(c => `  ${q(c.name, dialect)} ${ddlType(c, dialect)}`)
    .join(",\n");
  // i18n M6: per-locale draft/publish status column (only when the collection has Draft/Published).
  const statusDef = spec.status
    ? `  ${q("_status", dialect)} VARCHAR(20) NOT NULL DEFAULT '${COMPANION_DEFAULT_STATUS}',\n`
    : "";
  return (
    `CREATE TABLE ${q(companionTable, dialect)} (\n` +
    `  ${q("_parent", dialect)} ${parentIdType} NOT NULL,\n` +
    `  ${q("_locale", dialect)} VARCHAR(20) NOT NULL,\n` +
    statusDef +
    `${colDefs},\n` +
    `  PRIMARY KEY (${q("_parent", dialect)}, ${q("_locale", dialect)}),\n` +
    `  FOREIGN KEY (${q("_parent", dialect)}) REFERENCES ${q(mainTable, dialect)} (${q("id", dialect)}) ON DELETE CASCADE\n` +
    `)`
  );
}

/**
 * Create-only companion migration for a FRESH localized collection: just the
 * `CREATE TABLE <companion>`. No seed (the main table never held the localized columns)
 * and no main-table drop. Used when a collection is localized from birth.
 */
export function buildCompanionCreateOnlySql(
  spec: CompanionMigrationSpec
): string {
  return `${buildCompanionCreateStatement(spec)};`;
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
  return buildLocalizationUpStatements(spec)
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

  const create = buildCompanionCreateStatement(spec);

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
            `FROM ${q(mainTable, dialect)}`,
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
