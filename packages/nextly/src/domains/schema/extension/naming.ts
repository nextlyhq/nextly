/**
 * What an extension table may be called, and which indexes it may carry.
 *
 * Two separate jobs, kept here together because both are decided before any
 * database is touched and both fail boot rather than a request.
 *
 * The naming rules exist because the schema pipeline claims whole namespaces by
 * PREFIX: anything matching `dc_`, `single_`, the field-group prefix or
 * `nextly_` is already owned by the collection, component or core machinery,
 * which will diff it against a desired state that never declares it and propose
 * dropping it. So a name is refused here rather than discovered later as a
 * table that keeps disappearing.
 *
 * The indexability rules are checked for ALL THREE dialects whatever the live
 * one is. A plugin author on Postgres would otherwise ship a unique index over
 * a JSON column that only fails once somebody deploys on MySQL — and the author
 * is the one person who cannot reproduce it.
 *
 * @module domains/schema/extension/naming
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { MANAGED_TABLE_PREFIXES_REGEX } from "../pipeline/managed-tables";
import {
  type ColumnKind,
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
  ENUM_STORAGE_LENGTH,
  renderDialectType,
} from "../services/field-column-descriptor";
import {
  columnTypeIsIndexable,
  MAX_INDEX_NAME_LENGTH,
  uniquenessCanBeAnIndex,
} from "../services/index-name";

import type { ExtensionColumn, ExtensionIndex } from "./types";

/**
 * A column as the index and row rules weigh it: its name, the kind that
 * decides its type on each dialect, and the sizes that kind reads.
 *
 * Wider than an extension column's kinds by `fkSingle`, because a declared
 * collection index is judged by these same rules, and a single relationship
 * is a column a collection index can name.
 */
export type WeighedColumn = Pick<
  ExtensionColumn,
  "name" | "length" | "precision" | "scale"
> & { kind: Exclude<ColumnKind, "skip"> };

/** Every dialect a declaration is checked against, whatever the live one is. */
export const ALL_DIALECTS: readonly SupportedDialect[] = [
  "postgresql",
  "mysql",
  "sqlite",
];

/**
 * The strictest identifier limit of the three dialects (Postgres).
 *
 * The bound derived index and constraint names are held to, read from there
 * rather than restated, so a table name and the names derived from it can
 * never be checked against two different limits.
 */
export const MAX_IDENTIFIER_LENGTH = MAX_INDEX_NAME_LENGTH;

/** The separator between a plugin's prefix and its table name. */
export const PREFIX_SEPARATOR = "__";

/**
 * Prefixes a plugin may not claim.
 *
 * Each is a namespace something else already owns: `nextly` is core, `dc`,
 * `single` and `comp` are entity tables, `fg` is field groups, and `app` is
 * reserved so an app-owned table can never be mistaken for a plugin's.
 */
export const RESERVED_PREFIXES: readonly string[] = [
  "nextly",
  "dc",
  "single",
  "comp",
  "fg",
  "app",
];

const PREFIX_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;
const COMPANION_SUFFIX = "_locales";

function refuse(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/**
 * The prefix a plugin's tables carry.
 *
 * Derived from the plugin's admin slug when it declares none, so the common
 * case needs no decision from the author — and uses the SAME slug function the
 * admin routes use, because two spellings of one plugin's identity is exactly
 * the drift this repository has a rule about.
 */
export function pluginTablePrefix(
  pluginName: string,
  declaredPrefix: string | undefined,
  slugify: (name: string) => string
): string {
  const prefix = declaredPrefix ?? slugify(pluginName).replace(/-/g, "_");

  if (!PREFIX_PATTERN.test(prefix)) {
    refuse(
      `plugin.${pluginName}.schema.prefix`,
      `A schema prefix must be 2–31 characters of lower-case letters, digits and underscores, starting with a letter; received "${prefix}".`
    );
  }
  // A prefix containing the separator makes the boundary ambiguous: `a__b`
  // plus table `c` and prefix `a` plus table `b__c` produce one name.
  if (prefix.includes(PREFIX_SEPARATOR)) {
    refuse(
      `plugin.${pluginName}.schema.prefix`,
      `A schema prefix may not contain "${PREFIX_SEPARATOR}"; received "${prefix}".`
    );
  }
  if (RESERVED_PREFIXES.includes(prefix)) {
    refuse(
      `plugin.${pluginName}.schema.prefix`,
      `The schema prefix "${prefix}" is reserved.`
    );
  }
  return prefix;
}

/**
 * The final table name for a plugin-owned table.
 *
 * Checking the PREFIX alone is not enough, which is the subtle part: a prefix
 * such as `dc_x` is not itself reserved, and yet `dc_x__t` matches the managed
 * prefix regex and would be claimed by the collection pipeline. The resulting
 * NAME is what has to be checked.
 */
export function pluginTableName(prefix: string, table: string): string {
  const name = `${prefix}${PREFIX_SEPARATOR}${table}`;
  assertUsableTableName(name, `plugin table "${table}"`);
  return name;
}

/** Refuse a table name that something else already owns, whoever declared it. */
export function assertUsableTableName(name: string, path: string): void {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    refuse(
      path,
      `A table name may be at most ${String(MAX_IDENTIFIER_LENGTH)} characters; "${name}" is ${String(name.length)}.`
    );
  }
  if (MANAGED_TABLE_PREFIXES_REGEX.test(name)) {
    refuse(
      path,
      `The table name "${name}" falls under a prefix the schema pipeline manages, which would propose dropping it.`
    );
  }
  if (name.startsWith("nextly_")) {
    refuse(path, `The table name "${name}" is reserved for core tables.`);
  }
  // A `_locales` table is created and dropped by the localization layer alone,
  // so a table ending that way would be reconciled by two owners.
  if (name.endsWith(COMPANION_SUFFIX)) {
    refuse(
      path,
      `A table name may not end in "${COMPANION_SUFFIX}", which the localization layer owns.`
    );
  }
}

/**
 * Refuse an explicit schema-object name no dialect can store as written.
 *
 * A DERIVED name is bounded with a hash (`boundedIdentifier`), but an explicit
 * one is the author's and is used verbatim, so it cannot be shortened without
 * becoming a name the author never wrote. Past the bound MySQL refuses it and
 * PostgreSQL silently truncates it, after which the live constraint no longer
 * carries the name the desired schema declares and every diff proposes
 * dropping and re-adding it. Refused here, at declaration, on every dialect.
 */
export function assertExplicitIdentifier(name: string, path: string): void {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    refuse(
      path,
      `An explicit name may be at most ${String(MAX_IDENTIFIER_LENGTH)} characters, the longest every dialect stores unchanged; "${name}" is ${String(name.length)}.`
    );
  }
}

/** Refuse an app table name that collides with core or with a plugin's namespace. */
export function assertUsableAppTableName(
  name: string,
  coreTableNames: readonly string[],
  pluginPrefixes: readonly string[]
): void {
  assertUsableTableName(name, `app table "${name}"`);
  if (coreTableNames.includes(name)) {
    refuse(`app table "${name}"`, `"${name}" is a core table.`);
  }
  for (const prefix of pluginPrefixes) {
    if (name.startsWith(`${prefix}${PREFIX_SEPARATOR}`)) {
      refuse(
        `app table "${name}"`,
        `"${name}" falls inside the namespace of the plugin prefix "${prefix}".`
      );
    }
  }
}

/** The InnoDB limit a compound key may not exceed. */
const MYSQL_MAX_KEY_BYTES = 3072;

/** Characters to bytes under utf8mb4, which is what MySQL counts. */
const UTF8MB4_BYTES_PER_CHAR = 4;
const SHORT_TEXT_LENGTH = 255;

/**
 * How many bytes each kind occupies in a MySQL index key.
 *
 * A table because it IS one: every entry is a width, and a switch expressing
 * a lookup only hides that. `null` means the kind cannot be keyed at all,
 * which is a different answer from "too wide" and earns a clearer message.
 *
 * Genuinely new here: the repository knew this limit only as comments on
 * hand-written schemas, so nothing could refuse a declaration that exceeded
 * it.
 */
const MYSQL_KEY_BYTES: Record<
  WeighedColumn["kind"],
  | number
  | ((column: Pick<WeighedColumn, "length" | "precision" | "scale">) => number)
  | null
> = {
  // MySQL counts the DECLARED width, four bytes per character under utf8mb4,
  // whatever the row actually holds — so a compound index over a few
  // varchar(255) columns reaches the cap long before it looks like it should.
  // Both render as `varchar(length ?? 255)` on MySQL, so both are weighed
  // at the width they render at: a collection's short text field declaring
  // `maxLength: 1000` is a varchar(1000), 4,000 bytes of key.
  text: c => (c.length ?? SHORT_TEXT_LENGTH) * UTF8MB4_BYTES_PER_CHAR,
  shortText: c => (c.length ?? SHORT_TEXT_LENGTH) * UTF8MB4_BYTES_PER_CHAR,
  // The varchar width an enum renders at on MySQL, read from the constant
  // the renderer uses so the key width tracks the declared column.
  enum: ENUM_STORAGE_LENGTH * UTF8MB4_BYTES_PER_CHAR,
  varchar: c => (c.length ?? SHORT_TEXT_LENGTH) * UTF8MB4_BYTES_PER_CHAR,
  char: c => (c.length ?? 1) * UTF8MB4_BYTES_PER_CHAR,
  uuid: 36 * UTF8MB4_BYTES_PER_CHAR,
  // A collection's single relationship: `varchar(36)` on MySQL, the id it
  // holds.
  fkSingle: 36 * UTF8MB4_BYTES_PER_CHAR,
  boolean: 1,
  smallint: 2,
  // The same four bytes `integer` occupies: what MySQL keys is the int, and
  // AUTO_INCREMENT is how the value arrives rather than how wide it is.
  serial: 4,
  integer: 4,
  real: 4,
  bigint: 8,
  double: 8,
  // As MySQL packs them, which is the width a key holds too.
  decimal: c =>
    mysqlDecimalBytes(
      c.precision ?? DEFAULT_DECIMAL_PRECISION,
      c.scale ?? DEFAULT_DECIMAL_SCALE
    ),
  // A TIMESTAMP with no fractional seconds, which is how every one renders.
  timestamp: 4,
  // None can be keyed without a prefix length, which the neutral model has no
  // way to express.
  longText: null,
  json: null,
  bytes: null,
};

/** The key width of one column, or null when it cannot be keyed. */
export function mysqlKeyBytes(
  column: Pick<WeighedColumn, "kind" | "length" | "precision" | "scale">
): number | null {
  const entry = MYSQL_KEY_BYTES[column.kind];
  return typeof entry === "function" ? entry(column) : entry;
}

/**
 * MySQL's limit on one row: every column's in-row width together. TEXT, JSON
 * and BLOB contents are stored apart from the row and count only their
 * length and pointer toward it.
 */
const MYSQL_MAX_ROW_BYTES = 65_535;

/** Bytes a VARCHAR spends on its length when a value may exceed 255 bytes. */
const LONG_LENGTH_PREFIX_BYTES = 2;

/**
 * The widest `varchar(n)` every dialect can declare, which MySQL decides:
 * under utf8mb4 a value may take 4 bytes a character, plus its 2-byte length,
 * within the 65,535-byte row — (65,535 − 2) / 4, so 16,383. PostgreSQL and
 * SQLite accept far wider, and a width only they accept is a table that
 * cannot be created where it is deployed on MySQL.
 */
export const MAX_VARCHAR_LENGTH = Math.floor(
  (MYSQL_MAX_ROW_BYTES - LONG_LENGTH_PREFIX_BYTES) / UTF8MB4_BYTES_PER_CHAR
);

/** The kinds MySQL stores as VARCHAR, which carry a length beside the value. */
const MYSQL_VARCHAR_KINDS: ReadonlySet<WeighedColumn["kind"]> = new Set([
  "text",
  "shortText",
  "varchar",
  "enum",
  "fkSingle",
]);

/**
 * The bytes a DECIMAL(precision, scale) occupies on MySQL: four for every
 * nine digits on each side of the point, and the leftover digits by this
 * table, as MySQL packs them.
 */
const DECIMAL_LEFTOVER_BYTES = [0, 1, 1, 2, 2, 3, 3, 4, 4];

function mysqlDecimalBytes(precision: number, scale: number): number {
  const side = (digits: number): number =>
    Math.floor(digits / 9) * 4 + DECIMAL_LEFTOVER_BYTES[digits % 9];
  return side(precision - scale) + side(scale);
}

/**
 * The kinds whose in-row width is not their key width: TEXT (2 bytes of
 * length), and JSON and LONGBLOB (4), keep their contents out of the row and
 * count that length plus an 8-byte pointer. None of them can be keyed, so
 * the key table holds no width for them to share.
 */
const MYSQL_OFF_ROW_BYTES: Partial<Record<WeighedColumn["kind"], number>> = {
  longText: 10,
  json: 12,
  bytes: 12,
};

/**
 * The width one column takes in a MySQL row, as the row limit counts it.
 *
 * Its key width, so the declared widths are read in one place, unless its
 * contents are stored off the row; a VARCHAR also stores its length beside
 * the value.
 */
function mysqlRowBytes(column: WeighedColumn): number {
  const offRow = MYSQL_OFF_ROW_BYTES[column.kind];
  if (offRow !== undefined) return offRow;
  const bytes = mysqlKeyBytes(column) ?? 0;
  if (!MYSQL_VARCHAR_KINDS.has(column.kind)) return bytes;
  return bytes + (bytes > 255 ? LONG_LENGTH_PREFIX_BYTES : 1);
}

/**
 * Refuse a table whose row MySQL cannot hold.
 *
 * Each column can be declarable alone and the table still not be: MySQL
 * refuses a CREATE TABLE whose columns' in-row widths, plus a bit per
 * nullable column, exceed 65,535 bytes, while PostgreSQL and SQLite create
 * it. Checked against the table's WHOLE column set, so it is asked of a
 * table this layer declares, never of one it only seeds.
 */
export function assertMysqlRowFits(table: {
  name: string;
  columns: readonly (WeighedColumn & { nullable: boolean })[];
}): void {
  const nullable = table.columns.filter(column => column.nullable).length;
  const bytes =
    table.columns.reduce((sum, column) => sum + mysqlRowBytes(column), 0) +
    Math.ceil(nullable / 8);
  if (bytes <= MYSQL_MAX_ROW_BYTES) return;
  refuse(
    `${table.name}.columns`,
    `mysql limits a row to ${String(MYSQL_MAX_ROW_BYTES)} bytes, not counting TEXT, JSON and BLOB contents; "${table.name}" declares ${String(bytes)}. Narrow a varchar, or use col.longText() for long values.`
  );
}

/** One reason an index was refused, named so a test can assert which rule fired. */
export type IndexRefusal =
  | "not-indexable"
  | "unique-not-indexable"
  | "key-too-wide"
  | "unknown-column"
  | "partial-not-supported";

export interface IndexVerdict {
  dialect: SupportedDialect;
  reason: IndexRefusal;
  message: string;
}

/**
 * Whether ONE column can take part in this index, on one dialect.
 *
 * Split out so the loop below reads as "every column must pass" and this
 * reads as what passing means. The two were one function, and the ordering of
 * the checks — which decides WHICH refusal an author sees — was buried in it.
 */
function judgeIndexColumn(
  column: WeighedColumn,
  unique: boolean,
  dialect: SupportedDialect
): IndexVerdict | null {
  // Asked of the SAME renderer every other caller of these helpers uses, so
  // the helpers cannot answer differently for one column depending on who
  // asked.
  const sqlType = renderDialectType(column.kind, dialect, {
    ...(column.length !== undefined ? { length: column.length } : {}),
    ...(column.precision !== undefined ? { precision: column.precision } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
  });

  if (!columnTypeIsIndexable(sqlType, dialect)) {
    return {
      dialect,
      reason: "not-indexable",
      message: `${dialect} cannot index a "${column.kind}" column ("${column.name}").`,
    };
  }
  // Checked before the width rule: a column that cannot carry UNIQUENESS gets
  // a message telling the author to use varchar(n), which is more useful than
  // one about key bytes.
  if (unique && !uniquenessCanBeAnIndex(sqlType, dialect)) {
    return {
      dialect,
      reason: "unique-not-indexable",
      message: `${dialect} cannot carry uniqueness on a "${column.kind}" column ("${column.name}"); use a bounded text column: varchar(n) or shortText in a table, a text field in a collection.`,
    };
  }
  if (dialect === "mysql" && mysqlKeyBytes(column) === null) {
    return {
      dialect,
      reason: "not-indexable",
      message: `mysql cannot key a "${column.kind}" column ("${column.name}") without a prefix length; use a bounded text column: varchar(n) or shortText in a table, a text field in a collection.`,
    };
  }
  return null;
}

/**
 * Whether one index can be built, on one dialect.
 *
 * Returns the verdict rather than throwing, so the caller can report every
 * dialect that refuses rather than only the first.
 */
export function judgeIndex(
  index: ExtensionIndex,
  columns: readonly WeighedColumn[],
  dialect: SupportedDialect,
  columnsAreKnown = true
): IndexVerdict | null {
  // MySQL has no partial indexes. Creating the index without its predicate
  // would enforce it over more rows than declared — for a unique index, a
  // constraint nobody asked for — so the declaration is refused instead.
  if (dialect === "mysql" && index.where !== undefined) {
    return {
      dialect,
      reason: "partial-not-supported",
      message:
        "mysql has no partial indexes, so an index carrying `where` cannot be built there.",
    };
  }
  const byName = new Map(columns.map(column => [column.name, column]));
  let keyBytes = 0;

  for (const columnName of index.columns) {
    const column = byName.get(columnName);
    if (!column) {
      // An entity or core table is SEEDED here, not declared: its real
      // columns come from the field pipeline, which owns them. Refusing what
      // this layer cannot see would reject every legitimate index on one —
      // and the seed carries no columns at all, so that is all of them.
      if (!columnsAreKnown) continue;
      return {
        dialect,
        reason: "unknown-column",
        message: `Index names the column "${columnName}", which the table does not declare.`,
      };
    }

    const verdict = judgeIndexColumn(column, index.unique, dialect);
    if (verdict) return verdict;

    if (dialect === "mysql") keyBytes += mysqlKeyBytes(column) ?? 0;
  }

  // Only meaningful when every column was weighed. A width summed over the
  // subset this layer happens to know would be too small, and a bound checked
  // against too small a number passes for the wrong reason.
  if (
    columnsAreKnown &&
    dialect === "mysql" &&
    keyBytes > MYSQL_MAX_KEY_BYTES
  ) {
    return {
      dialect,
      reason: "key-too-wide",
      message: `mysql limits an index key to ${String(MYSQL_MAX_KEY_BYTES)} bytes; this index declares ${String(keyBytes)}. Index fewer or narrower columns.`,
    };
  }

  return null;
}

/**
 * Refuse an index that any dialect cannot build.
 *
 * Every dialect, not the live one: a declaration that only works where its
 * author happened to develop is a deployment failure with no local repro.
 */
export function assertIndexBuildable(
  index: ExtensionIndex,
  columns: readonly WeighedColumn[],
  tableName: string,
  /**
   * Whether `columns` is the table's WHOLE column set.
   *
   * False for a table this layer only seeds — an entity or core table — where
   * the field pipeline holds the real columns and validates an index against
   * them. Defaulted to true so a caller that declares its own columns, which
   * is every plugin and app table, keeps the full check without saying so.
   */
  columnsAreKnown = true
): void {
  if (index.name !== undefined) {
    assertExplicitIdentifier(
      index.name,
      `${tableName}.indexes[${index.columns.join(",")}]`
    );
  }
  for (const dialect of ALL_DIALECTS) {
    const verdict = judgeIndex(index, columns, dialect, columnsAreKnown);
    if (verdict) {
      refuse(
        `${tableName}.indexes[${index.columns.join(",")}]`,
        verdict.message
      );
    }
  }
}
