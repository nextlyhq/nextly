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
  columnTypeIsIndexable,
  uniquenessCanBeAnIndex,
} from "../services/index-name";

import {
  extensionColumnSqlType,
  MYSQL_MAX_KEY_BYTES,
  mysqlKeyBytes,
} from "./column-sql-type";
import type { ExtensionColumn, ExtensionIndex } from "./types";

/** Every dialect a declaration is checked against, whatever the live one is. */
export const ALL_DIALECTS: readonly SupportedDialect[] = [
  "postgresql",
  "mysql",
  "sqlite",
];

/** The strictest identifier limit of the three dialects (Postgres). */
export const MAX_IDENTIFIER_LENGTH = 63;

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

/** One reason an index was refused, named so a test can assert which rule fired. */
export type IndexRefusal =
  | "not-indexable"
  | "unique-not-indexable"
  | "key-too-wide"
  | "unknown-column";

export interface IndexVerdict {
  dialect: SupportedDialect;
  reason: IndexRefusal;
  message: string;
}

/**
 * Whether one index can be built, on one dialect.
 *
 * Returns the verdict rather than throwing, so the caller can report every
 * dialect that refuses rather than only the first.
 */
export function judgeIndex(
  index: ExtensionIndex,
  columns: readonly ExtensionColumn[],
  dialect: SupportedDialect
): IndexVerdict | null {
  const byName = new Map(columns.map(column => [column.name, column]));
  let keyBytes = 0;

  for (const columnName of index.columns) {
    const column = byName.get(columnName);
    if (!column) {
      return {
        dialect,
        reason: "unknown-column",
        message: `Index names the column "${columnName}", which the table does not declare.`,
      };
    }

    const sqlType = extensionColumnSqlType(column, dialect);
    if (!columnTypeIsIndexable(sqlType, dialect)) {
      return {
        dialect,
        reason: "not-indexable",
        message: `${dialect} cannot index a "${column.kind}" column ("${columnName}").`,
      };
    }
    if (index.unique && !uniquenessCanBeAnIndex(sqlType, dialect)) {
      return {
        dialect,
        reason: "unique-not-indexable",
        message: `${dialect} cannot carry uniqueness on a "${column.kind}" column ("${columnName}"); use varchar(n) or shortText.`,
      };
    }

    if (dialect === "mysql") {
      const bytes = mysqlKeyBytes(column);
      if (bytes === null) {
        return {
          dialect,
          reason: "not-indexable",
          message: `mysql cannot key a "${column.kind}" column ("${columnName}") without a prefix length; use varchar(n) or shortText.`,
        };
      }
      keyBytes += bytes;
    }
  }

  if (dialect === "mysql" && keyBytes > MYSQL_MAX_KEY_BYTES) {
    return {
      dialect,
      reason: "key-too-wide",
      message: `mysql limits an index key to ${String(MYSQL_MAX_KEY_BYTES)} bytes; this index declares ${String(keyBytes)}. Narrow a varchar, or index fewer columns.`,
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
  columns: readonly ExtensionColumn[],
  tableName: string
): void {
  for (const dialect of ALL_DIALECTS) {
    const verdict = judgeIndex(index, columns, dialect);
    if (verdict) {
      refuse(
        `${tableName}.indexes[${index.columns.join(",")}]`,
        verdict.message
      );
    }
  }
}
