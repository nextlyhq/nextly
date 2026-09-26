/**
 * `CREATE [UNIQUE] INDEX`, for every dialect and every caller.
 *
 * The migration templates and the dev-push emitters both create indexes from
 * the same `IndexSpec`, and they render it here so both say the same thing
 * about it. The spec can carry a partial-index predicate and an expression in
 * place of columns; a renderer that reads only `columns` turns an expression
 * index into `CREATE INDEX ... ()`, which does not parse, and a partial unique
 * index into a full one, which rejects rows its author allowed.
 *
 * Quoting stays the caller's: the templates refuse an identifier holding the
 * dialect's quote character while the emitters escape it, and each keeps its
 * own policy by passing its quoting function in.
 *
 * @module domains/schema/pipeline/sql-templates/create-index
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../../errors/nextly-error";
import { splitTopLevel } from "../diff/normalize-check";
import type { IndexSpec } from "../diff/types";

import type { QuoteIdentifier } from "./create-table-body";
import { unsupportedOperation } from "./foreign-key-action";

/**
 * The key length a MySQL TEXT/BLOB column is indexed by: 191 characters, the
 * longest prefix that fits InnoDB's 767-byte index limit under utf8mb4 on
 * every row format — the same bound the Builder's DDL uses.
 */
const MYSQL_TEXT_KEY_PREFIX = 191;

/**
 * Whether a MySQL column type needs a key length before it can be indexed:
 * every TEXT and BLOB size, `tinytext` through `longblob`.
 */
export function isMysqlTextOrBlobType(type: string): boolean {
  return /^(tiny|medium|long)?(text|blob)\b/i.test(type.trim());
}

export interface CreateIndexOptions {
  /**
   * The table's column types, when the caller has them. MySQL refuses to index
   * a TEXT/BLOB column without a key length, so with a type in hand such a
   * column is indexed by prefix.
   *
   * Only for a NON-unique index. On a unique one the prefix would constrain
   * the data — two rows differing only past the prefix would be rejected as
   * duplicates — so a unique index is rendered without it and MySQL refuses
   * the statement rather than enforcing uniqueness nobody declared.
   */
  columnTypes?: ReadonlyMap<string, string>;
}

/** A key that is a bare column name, quoted or not. */
const BARE_COLUMN = /^(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|[A-Za-z_][\w$]*)$/;

/**
 * A key that orders or classes its value rather than computing it: `DESC`,
 * `ASC`, `NULLS FIRST/LAST`, `COLLATE ...`, or an operator class
 * (`text_pattern_ops` — every built-in PostgreSQL opclass ends in `_ops`).
 *
 * Refused rather than rendered. None of them has a spelling the schema model
 * records — introspection reports keys, not their ordering or class — so a
 * declared one could never compare equal to the live index and would be
 * planned again on every push; and wrapped as an expression key, as every
 * other key is, it does not parse on any dialect.
 */
const ORDERING_OR_CLASS =
  /(?:\s(?:ASC|DESC)|\sNULLS\s+(?:FIRST|LAST)|\sCOLLATE\s+\S+|\s[A-Za-z_]\w*_ops)\s*$/i;

/**
 * An expression index's keys: each one parenthesised as an expression key of
 * its own, except a bare column, which MySQL refuses as a functional key part
 * (ER_FUNCTIONAL_INDEX_ON_FIELD) and every dialect takes as written. The list
 * is split by the rule the diff reads it by (`splitTopLevel`), so a declared
 * `lower(email), status` renders as two keys rather than one row value.
 */
function expressionKeys(index: IndexSpec): string {
  const keys = splitTopLevel(index.expression ?? "").map(key => key.trim());
  const refused = orderedOrClassedKey(index.expression ?? "");
  if (refused !== undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: `indexes.${index.name}.expression`,
          code: "INVALID",
          message: `Index "${index.name}" declares "${refused}", which orders or classes a key. Index keys are compared by what they compute, so ordering, collation and operator classes cannot be declared; index the expression itself.`,
        },
      ],
    });
  }
  return keys.map(key => (BARE_COLUMN.test(key) ? key : `(${key})`)).join(", ");
}

/**
 * The first key of an index expression that orders or classes its value
 * (see `ORDERING_OR_CLASS`), or undefined when every key computes one.
 *
 * Exported so a table's declaration refuses such a key by the same rule this
 * renderer does, before any DDL is built.
 */
export function orderedOrClassedKey(expression: string): string | undefined {
  return splitTopLevel(expression)
    .map(key => key.trim())
    .find(key => ORDERING_OR_CLASS.test(key));
}

/** The key list inside the index's parentheses. */
function keyList(
  index: IndexSpec,
  dialect: SupportedDialect,
  q: QuoteIdentifier,
  options: CreateIndexOptions
): string {
  // An expression is parenthesised as a key of its own: MySQL takes a
  // functional key part only in that form, and PostgreSQL and SQLite accept
  // it for any expression — including a bare call PostgreSQL would also take
  // unwrapped, and an operator expression it would not.
  if (index.expression) return expressionKeys(index);
  return index.columns
    .map(column => {
      const quoted = q(column);
      if (dialect !== "mysql" || index.unique) return quoted;
      const type = options.columnTypes?.get(column);
      return type !== undefined && isMysqlTextOrBlobType(type)
        ? `${quoted}(${MYSQL_TEXT_KEY_PREFIX})`
        : quoted;
    })
    .join(", ");
}

/**
 * One `CREATE INDEX` statement, without a trailing semicolon.
 *
 * PostgreSQL and SQLite take `IF NOT EXISTS`; MySQL has no such form, so there
 * a duplicate name fails loudly — the diff plans an add only when the live
 * table lacks the index, so a collision is a real disagreement.
 *
 * MySQL has no partial indexes. A predicate reaching it is refused rather than
 * dropped: an index over more rows than declared is a unique constraint nobody
 * asked for.
 */
export function createIndexSql(
  tableName: string,
  index: IndexSpec,
  dialect: SupportedDialect,
  q: QuoteIdentifier,
  options: CreateIndexOptions = {}
): string {
  if (dialect === "mysql" && index.where) {
    return unsupportedOperation("createIndexSql", {
      type: `add_index (partial, ${index.name})`,
    });
  }
  const unique = index.unique ? "UNIQUE " : "";
  const ifNotExists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
  const where = index.where ? ` WHERE ${index.where}` : "";
  return (
    `CREATE ${unique}INDEX ${ifNotExists}${q(index.name)} ON ${q(tableName)} ` +
    `(${keyList(index, dialect, q, options)})${where}`
  );
}
