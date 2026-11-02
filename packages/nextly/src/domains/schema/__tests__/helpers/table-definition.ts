/**
 * A table's definition as the database reports it, and the definition a change should leave.
 *
 * A change to a column has to leave everything it does not name as it was: the column's type,
 * nullability and default, its comment, character set and collation, its generated value and its
 * position, and the indexes, keys and checks on the table. Asserting each of those one by one finds
 * only the ones somebody thought to list. Reading the whole definition before and after, and
 * requiring the after to equal the before with only the named change applied, finds the one nobody
 * listed too.
 *
 * Read from the catalog each dialect keeps, never from Nextly's own introspection: that is the code
 * whose output is being judged, and it records only what the schema tracks, which leaves out the
 * comment, the collation and a check the schema never declared.
 *
 * SQLite reports a column's collation, its checks and a generated column's expression only in the
 * table's stored CREATE statement, so that statement is read here with a small scanner of its own,
 * independent of the one the product uses to rebuild a table.
 *
 * @module domains/schema/__tests__/helpers/table-definition
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/** Runs one read and returns its rows. */
export type QueryRows = <T>(statement: string) => Promise<T[]>;

/** One column, as the database reports it. `null` where the dialect has no such property. */
export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  comment: string | null;
  charset: string | null;
  collation: string | null;
  /** A generated column's expression, with how it is stored. */
  generated: string | null;
  /** Anything else the dialect reports for the column (MySQL's EXTRA). */
  extra: string | null;
}

export interface IndexDefinition {
  name: string;
  /** Column names, or the expression, in index order. */
  columns: string[];
  unique: boolean;
  /** A partial index's predicate. */
  predicate: string | null;
}

export interface ForeignKeyDefinition {
  name: string;
  columns: string[];
  references: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface CheckDefinition {
  name: string;
  expression: string;
}

/**
 * The whole definition. Columns are in the table's own order, so a column that moved compares
 * unequal; indexes, keys and checks are sorted by name, because the catalogs return them in no
 * order of their own.
 */
export interface TableDefinition {
  columns: ColumnDefinition[];
  primaryKey: string[];
  indexes: IndexDefinition[];
  foreignKeys: ForeignKeyDefinition[];
  checks: CheckDefinition[];
  /** The table's own options: its collation, engine and comment, or SQLite's table options. */
  options: Record<string, string | null>;
}

/** What a change names, and so what may differ after it. */
export interface NamedChange {
  /** The column renamed. */
  rename?: { from: string; to: string };
  /** The column (by its name after any rename) whose nullability or default the change sets. */
  column?: string;
  nullable?: boolean;
  /** The default as this dialect reports it, or `null` for none. */
  default?: string | null;
}

/** Reads `table`'s definition from the database. */
export async function readTableDefinition(
  query: QueryRows,
  dialect: SupportedDialect,
  table: string
): Promise<TableDefinition> {
  switch (dialect) {
    case "postgresql":
      return readPostgres(query, table);
    case "mysql":
      return readMysql(query, table);
    case "sqlite":
      return readSqlite(query, table);
    default:
      throw new Error(`no definition reader for ${String(dialect)}`);
  }
}

/**
 * The definition `before` should become under `change`: the column renamed wherever the
 * definition names it, and its nullability or default set when the change names them. Nothing else
 * moves, which is the whole claim.
 */
export function withNamedChange(
  before: TableDefinition,
  change: NamedChange
): TableDefinition {
  const rename = change.rename;
  const renamed = (text: string): string =>
    rename === undefined
      ? text
      : renameIdentifier(text, rename.from, rename.to);
  const renamedName = (name: string): string =>
    rename !== undefined && name === rename.from ? rename.to : name;
  const columns = before.columns.map(column => {
    const name = renamedName(column.name);
    const named = change.column !== undefined && name === change.column;
    return {
      ...column,
      name,
      generated: column.generated === null ? null : renamed(column.generated),
      extra: column.extra === null ? null : renamed(column.extra),
      nullable:
        named && change.nullable !== undefined
          ? change.nullable
          : column.nullable,
      default:
        named && change.default !== undefined ? change.default : column.default,
    };
  });
  return {
    columns,
    primaryKey: before.primaryKey.map(renamedName),
    // An index Nextly names after its column (`idx_<table>_<column>`) is named after the new one:
    // the schema declares it under that name, so the name moving is part of the rename. What the
    // index covers, and how, may not move.
    indexes: byName(
      before.indexes.map(index => ({
        ...index,
        name:
          rename !== undefined && index.name.endsWith(`_${rename.from}`)
            ? `${index.name.slice(0, -rename.from.length)}${rename.to}`
            : index.name,
        columns: index.columns.map(column => renamed(renamedName(column))),
        predicate: index.predicate === null ? null : renamed(index.predicate),
      }))
    ),
    foreignKeys: before.foreignKeys.map(key => ({
      ...key,
      columns: key.columns.map(renamedName),
    })),
    checks: before.checks.map(check => ({
      ...check,
      expression: renamed(check.expression),
    })),
    options: before.options,
  };
}

/** `from` replaced by `to` where it stands as a whole identifier, quoted or not. */
function renameIdentifier(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(["\`\\[]?)\\b${escaped}\\b(["\`\\]]?)`, "g"),
    (_match, open: string, close: string) => `${open}${to}${close}`
  );
}

const byName = <T extends { name: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.name.localeCompare(b.name));

const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`;

async function readPostgres(
  query: QueryRows,
  table: string
): Promise<TableDefinition> {
  const name = literal(table);
  const relation = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = ${name} AND n.nspname = current_schema())`;
  const columns = await query<{
    name: string;
    type: string;
    nullable: string;
    default: string | null;
    collation: string | null;
    generated: string | null;
    identity: string | null;
    comment: string | null;
  }>(
    `SELECT c.column_name AS name, format_type(a.atttypid, a.atttypmod) AS type, c.is_nullable AS nullable, ` +
      `c.column_default AS "default", c.collation_name AS collation, c.generation_expression AS generated, ` +
      `c.identity_generation AS identity, col_description(${relation}, c.ordinal_position::int) AS comment ` +
      `FROM information_schema.columns c ` +
      `JOIN pg_attribute a ON a.attrelid = ${relation} AND a.attname = c.column_name ` +
      `WHERE c.table_schema = current_schema() AND c.table_name = ${name} ORDER BY c.ordinal_position`
  );
  const indexes = await query<{
    name: string;
    columns: string[] | string;
    unique: boolean;
    predicate: string | null;
    primary: boolean;
  }>(
    `SELECT i.relname AS name, x.indisunique AS "unique", x.indisprimary AS "primary", ` +
      `pg_get_expr(x.indpred, x.indrelid) AS predicate, ` +
      `ARRAY(SELECT pg_get_indexdef(x.indexrelid, k + 1, true) FROM generate_subscripts(x.indkey, 1) AS k ORDER BY k) AS columns ` +
      `FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = ${relation}`
  );
  const constraints = await query<{
    name: string;
    kind: string;
    definition: string;
  }>(
    `SELECT conname AS name, contype AS kind, pg_get_constraintdef(oid, true) AS definition ` +
      `FROM pg_constraint WHERE conrelid = ${relation} AND contype IN ('c', 'f')`
  );
  const keys = await query<{
    name: string;
    column: string;
    references: string;
    referenced: string;
    onDelete: string;
    onUpdate: string;
  }>(
    `SELECT con.conname AS name, a.attname AS "column", rt.relname AS "references", ra.attname AS referenced, ` +
      `con.confdeltype AS "onDelete", con.confupdtype AS "onUpdate" ` +
      `FROM pg_constraint con ` +
      `CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(own, other, pos) ` +
      `JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.own ` +
      `JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.other ` +
      `JOIN pg_class rt ON rt.oid = con.confrelid ` +
      `WHERE con.conrelid = ${relation} AND con.contype = 'f' ORDER BY con.conname, k.pos`
  );
  const options = await query<{ comment: string | null }>(
    `SELECT obj_description(${relation}, 'pg_class') AS comment`
  );
  const asList = (value: string[] | string): string[] =>
    Array.isArray(value)
      ? value
      : value
          .replace(/^\{|\}$/g, "")
          .split(",")
          .filter(part => part.length > 0)
          .map(part => part.replace(/^"|"$/g, ""));
  const primary = indexes.find(index => index.primary);
  return {
    columns: columns.map(column => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable === "YES",
      default: column.default,
      comment: column.comment,
      charset: null,
      collation: column.collation,
      generated: column.generated,
      extra: column.identity,
    })),
    primaryKey: primary === undefined ? [] : asList(primary.columns),
    indexes: byName(
      indexes
        .filter(index => !index.primary)
        .map(index => ({
          name: index.name,
          columns: asList(index.columns),
          unique: index.unique,
          predicate: index.predicate,
        }))
    ),
    foreignKeys: groupForeignKeys(keys),
    checks: byName(
      constraints
        .filter(constraint => constraint.kind === "c")
        .map(constraint => ({
          name: constraint.name,
          expression: constraint.definition,
        }))
    ),
    options: { comment: options[0]?.comment ?? null },
  };
}

/** One row per key column, grouped into keys. */
function groupForeignKeys(
  rows: {
    name: string;
    column: string;
    references: string;
    referenced: string;
    onDelete: string;
    onUpdate: string;
  }[]
): ForeignKeyDefinition[] {
  const keys = new Map<string, ForeignKeyDefinition>();
  for (const row of rows) {
    const key = keys.get(row.name) ?? {
      name: row.name,
      columns: [],
      references: row.references,
      referencedColumns: [],
      onDelete: row.onDelete,
      onUpdate: row.onUpdate,
    };
    key.columns.push(row.column);
    key.referencedColumns.push(row.referenced);
    keys.set(row.name, key);
  }
  return byName([...keys.values()]);
}

async function readMysql(
  query: QueryRows,
  table: string
): Promise<TableDefinition> {
  const name = literal(table);
  const columns = await query<{
    name: string;
    type: string;
    nullable: string;
    default: string | null;
    comment: string;
    charset: string | null;
    collation: string | null;
    generated: string | null;
    extra: string;
  }>(
    `SELECT COLUMN_NAME AS \`name\`, COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\`, COLUMN_DEFAULT AS \`default\`, ` +
      `COLUMN_COMMENT AS \`comment\`, CHARACTER_SET_NAME AS \`charset\`, COLLATION_NAME AS \`collation\`, ` +
      `GENERATION_EXPRESSION AS \`generated\`, EXTRA AS \`extra\` ` +
      `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name} ORDER BY ORDINAL_POSITION`
  );
  const statistics = await query<{
    name: string;
    column: string | null;
    expression: string | null;
    subPart: number | null;
    nonUnique: number | string;
  }>(
    `SELECT INDEX_NAME AS \`name\`, COLUMN_NAME AS \`column\`, EXPRESSION AS \`expression\`, SUB_PART AS \`subPart\`, NON_UNIQUE AS \`nonUnique\` ` +
      `FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name} ORDER BY INDEX_NAME, SEQ_IN_INDEX`
  );
  const checks = await query<{ name: string; expression: string }>(
    `SELECT cc.CONSTRAINT_NAME AS \`name\`, cc.CHECK_CLAUSE AS \`expression\` FROM information_schema.CHECK_CONSTRAINTS cc ` +
      `JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME ` +
      `WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ${name} AND tc.CONSTRAINT_TYPE = 'CHECK'`
  );
  const keys = await query<{
    name: string;
    column: string;
    references: string;
    referenced: string;
    onDelete: string;
    onUpdate: string;
  }>(
    `SELECT k.CONSTRAINT_NAME AS \`name\`, k.COLUMN_NAME AS \`column\`, k.REFERENCED_TABLE_NAME AS \`references\`, ` +
      `k.REFERENCED_COLUMN_NAME AS \`referenced\`, r.DELETE_RULE AS \`onDelete\`, r.UPDATE_RULE AS \`onUpdate\` ` +
      `FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ` +
      `ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME ` +
      `WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ${name} ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`
  );
  const options = await query<{
    collation: string | null;
    engine: string | null;
    comment: string | null;
  }>(
    `SELECT TABLE_COLLATION AS \`collation\`, ENGINE AS \`engine\`, TABLE_COMMENT AS \`comment\` FROM information_schema.TABLES ` +
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name}`
  );
  const indexes = new Map<string, IndexDefinition>();
  for (const row of statistics) {
    const index = indexes.get(row.name) ?? {
      name: row.name,
      columns: [],
      unique: Number(row.nonUnique) === 0,
      predicate: null,
    };
    const part = row.column ?? row.expression ?? "";
    index.columns.push(row.subPart === null ? part : `${part}(${row.subPart})`);
    indexes.set(row.name, index);
  }
  const primary = indexes.get("PRIMARY");
  indexes.delete("PRIMARY");
  return {
    columns: columns.map(column => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable === "YES",
      default: column.default,
      comment: column.comment === "" ? null : column.comment,
      charset: column.charset,
      collation: column.collation,
      generated:
        column.generated === null || column.generated === ""
          ? null
          : column.generated,
      extra: column.extra === "" ? null : column.extra,
    })),
    primaryKey: primary?.columns ?? [],
    indexes: byName([...indexes.values()]),
    foreignKeys: groupForeignKeys(keys),
    checks: byName(checks),
    options: options[0] ?? {},
  };
}

async function readSqlite(
  query: QueryRows,
  table: string
): Promise<TableDefinition> {
  const name = literal(table);
  const [stored] = await query<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${name}`
  );
  if (stored === undefined) throw new Error(`no table ${table}`);
  const create = parseSqliteCreate(stored.sql);
  const columns = await query<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
    hidden: number;
  }>(`SELECT * FROM pragma_table_xinfo(${name}) ORDER BY cid`);
  const indexList = await query<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>(`SELECT * FROM pragma_index_list(${name})`);
  const indexes: IndexDefinition[] = [];
  for (const index of indexList) {
    // Asked of the index itself, with each column's collating sequence, so that a column whose
    // collation was lost shows here as well as in the CREATE statement.
    const parts = await query<{
      name: string | null;
      coll: string;
      key: number;
    }>(
      `SELECT name, coll, key FROM pragma_index_xinfo(${literal(index.name)}) WHERE key = 1 ORDER BY seqno`
    );
    const [definition] = await query<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${literal(index.name)}`
    );
    const where = /\bWHERE\b([\s\S]*)$/i.exec(definition?.sql ?? "");
    indexes.push({
      name: index.name,
      columns: parts.map(part => `${part.name ?? "<expression>"} ${part.coll}`),
      unique: index.unique === 1,
      predicate: where === null ? null : collapse(where[1]),
    });
  }
  const keys = await query<{
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
  }>(`SELECT * FROM pragma_foreign_key_list(${name}) ORDER BY id, seq`);
  return {
    columns: columns.map(column => {
      const declared = create.columns.get(column.name.toLowerCase());
      return {
        name: column.name,
        type: column.type,
        nullable: column.notnull === 0 && column.pk === 0,
        default: column.dflt_value,
        comment: null,
        charset: null,
        collation: declared?.collation ?? null,
        generated: declared?.generated ?? null,
        extra: declared?.checks.length ? declared.checks.join(" ") : null,
      };
    }),
    primaryKey: columns
      .filter(column => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(column => column.name),
    indexes: byName(indexes),
    foreignKeys: groupForeignKeys(
      keys.map(key => ({
        name: `fk${key.id}`,
        column: key.from,
        references: key.table,
        referenced: key.to ?? "",
        onDelete: key.on_delete,
        onUpdate: key.on_update,
      }))
    ),
    checks: create.checks.map((expression, i) => ({
      name: `check${i}`,
      expression,
    })),
    options: { tail: create.tail },
  };
}

/** What one column's definition in a SQLite CREATE statement says beyond its type. */
interface SqliteDeclaredColumn {
  collation: string | null;
  generated: string | null;
  checks: string[];
}

/**
 * The parts of a SQLite CREATE TABLE statement no pragma reports: each column's collation, checks
 * and generated expression, the table's own checks, and whatever follows the column list
 * (`STRICT`, `WITHOUT ROWID`).
 */
function parseSqliteCreate(sql: string): {
  columns: Map<string, SqliteDeclaredColumn>;
  checks: string[];
  tail: string;
} {
  const open = sql.indexOf("(");
  const close = matchingParen(sql, open);
  const items = splitOutsideParens(sql.slice(open + 1, close));
  const columns = new Map<string, SqliteDeclaredColumn>();
  const checks: string[] = [];
  const constraintStart =
    /^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|CHECK\b|FOREIGN\s+KEY\b)/i;
  for (const raw of items) {
    const item = raw.trim();
    if (constraintStart.test(item)) {
      const check = /\bCHECK\s*\(/i.exec(item);
      if (check !== null)
        checks.push(
          collapse(parenthesisedAt(item, check.index + check[0].length - 1))
        );
      continue;
    }
    const [name, rest] = leadingIdentifier(item);
    const collation = /\bCOLLATE\s+("?)(\w+)\1/i.exec(rest);
    const generated = /\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(/i.exec(rest);
    const columnChecks: string[] = [];
    const pattern = /\bCHECK\s*\(/gi;
    for (
      let found = pattern.exec(rest);
      found !== null;
      found = pattern.exec(rest)
    ) {
      columnChecks.push(
        collapse(parenthesisedAt(rest, found.index + found[0].length - 1))
      );
    }
    columns.set(name.toLowerCase(), {
      collation: collation === null ? null : collation[2].toUpperCase(),
      generated:
        generated === null
          ? null
          : collapse(
              `${parenthesisedAt(rest, generated.index + generated[0].length - 1)} ${/\bSTORED\b/i.test(rest) ? "STORED" : "VIRTUAL"}`
            ),
      checks: columnChecks,
    });
  }
  return { columns, checks, tail: collapse(sql.slice(close + 1)) };
}

/** The identifier an item starts with, unquoted, and the text after it. */
function leadingIdentifier(item: string): [string, string] {
  const quoted = /^(["`[])/.exec(item);
  if (quoted !== null) {
    const closer = quoted[1] === "[" ? "]" : quoted[1];
    const end = item.indexOf(closer, 1);
    return [item.slice(1, end), item.slice(end + 1)];
  }
  const word = /^\S+/.exec(item)?.[0] ?? "";
  return [word, item.slice(word.length)];
}

/** The text inside the parenthesis that opens at `open`, quotes respected. */
function parenthesisedAt(text: string, open: number): string {
  return text.slice(open + 1, matchingParen(text, open));
}

/** Where the parenthesis opening at `open` closes, skipping quoted text. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      i = text.indexOf(ch === "[" ? "]" : ch, i + 1);
      if (i < 0) return text.length;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** `text` split on the commas outside any parenthesis or quoted text. */
function splitOutsideParens(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const end = text.indexOf(ch === "[" ? "]" : ch, i + 1);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  }
  items.push(text.slice(start));
  return items.filter(item => item.trim().length > 0);
}

/**
 * Whitespace collapsed and plain identifiers unquoted: SQLite rewrites a renamed column inside a
 * check as `"name"` whether or not it was quoted before, which is not a change to the check.
 */
const collapse = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/"(\w+)"/g, "$1")
    .trim();
