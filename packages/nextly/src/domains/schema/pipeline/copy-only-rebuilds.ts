/**
 * drizzle-kit rebuilds of SQLite tables that this push never asked for and
 * that would only copy a table onto itself: left out of the apply, rather
 * than refusing the whole apply over them.
 *
 * On SQLite drizzle-kit compares the whole database with the runtime tables
 * it is handed, and rebuilds a table over any difference it cannot make with
 * an ALTER, a column DEFAULT among them. A table an earlier release created
 * can differ from its runtime table in exactly that way, so a push that sent
 * one unrelated change to drizzle-kit came back with a rebuild of that table
 * too. The destructive-statement guard refuses a rebuild this push's own diff
 * did not approve, and rightly, because the kit encodes a column drop as a
 * rebuild that copies only the survivors. But refusing it refused everything
 * else the push carried as well.
 *
 * A rebuild is left out only when it provably moves no data: the same table
 * name throughout, the new table's columns the live table's exactly (names
 * and types), and its INSERT copying every one of them. Leaving it out runs
 * nothing, so the table stays exactly as it was; and since this push's diff
 * planned no change to the table (or it would have approved the rebuild),
 * nothing it asked for is lost. The table's live indexes, which drizzle-kit
 * recreates after a rebuild, are left out with it, since they are still there.
 * Any other unapproved rebuild stays in the statements, for the guard to
 * refuse as before.
 *
 * @module domains/schema/pipeline/copy-only-rebuilds
 */

/** A live column, as the copy rule compares it. */
export interface LiveColumn {
  readonly name: string;
  /** The declared type, as `PRAGMA table_info` reports it. */
  readonly type: string;
}

/** A live table, as the copy rule reads it. */
export interface LiveTable {
  readonly columns: readonly LiveColumn[];
  /** The names of the indexes the table has. */
  readonly indexes: readonly string[];
}

/** The statements left to run, and the tables whose rebuild was left out. */
export interface CopyOnlyRebuilds {
  readonly kept: string[];
  /** Each table whose rebuild was left out, as drizzle-kit names it. */
  readonly skipped: string[];
}

/**
 * `statements` without the drizzle-kit rebuilds that copy a table onto itself
 * (see the module comment), for every table `approved` (lower-cased names)
 * does not hold. `live` gives a table as the database has it, or `undefined`
 * for one it cannot vouch for, whose rebuild is then kept.
 */
export function withoutCopyOnlyRebuilds(
  statements: readonly string[],
  approved: ReadonlySet<string>,
  live: (table: string) => LiveTable | undefined
): CopyOnlyRebuilds {
  const leftOut = new Set<number>();
  const skipped: string[] = [];
  statements.forEach((statement, at) => {
    const created = newTableOf(statement);
    if (created === undefined) return;
    if (approved.has(created.table.toLowerCase())) return;
    const table = live(created.table);
    if (table === undefined) return;
    const block = copyBlockOf(statements, created.table);
    if (block === undefined) return;
    if (!sameColumns(created.columns, table.columns)) return;
    if (!copiesEveryColumn(block, table.columns)) return;
    for (const index of [at, block.insert, block.drop, block.rename]) {
      leftOut.add(index);
    }
    for (const index of liveIndexCreates(statements, created.table, table)) {
      leftOut.add(index);
    }
    skipped.push(created.table);
  });
  return {
    kept: statements.filter((_, at) => !leftOut.has(at)),
    skipped,
  };
}

/** A quoted SQLite identifier, as drizzle-kit writes one. */
const IDENTIFIER = /^[`"]([A-Za-z0-9_]+)[`"]$/;

/** A table-level constraint inside a CREATE TABLE body, not a column. */
const TABLE_CONSTRAINT =
  /^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i;

/** A column definition: its quoted name, then its declared type. */
const COLUMN_DEFINITION =
  /^[`"]([A-Za-z0-9_]+)[`"]\s+([A-Za-z]+(?:\s*\([^)]*\))?)/;

/**
 * The table a `CREATE TABLE __new_<table>` statement rebuilds, with the
 * columns it declares, or `undefined` for any other statement and for a body
 * this cannot read whole.
 */
function newTableOf(
  statement: string
): { table: string; columns: LiveColumn[] } | undefined {
  const match = statement.match(
    /^\s*CREATE\s+TABLE\s+[`"]__new_([A-Za-z0-9_]+)[`"]\s*\(([\s\S]*)\)\s*;?\s*$/i
  );
  if (match === null) return undefined;
  const columns: LiveColumn[] = [];
  for (const part of splitTopLevel(match[2] ?? "")) {
    if (TABLE_CONSTRAINT.test(part)) continue;
    const column = part.match(COLUMN_DEFINITION);
    // A part that is neither a constraint nor a typed column is one this
    // cannot judge, so the whole rebuild is kept for the guard.
    if (column === null) return undefined;
    columns.push({ name: column[1] ?? "", type: column[2] ?? "" });
  }
  return { table: match[1] ?? "", columns };
}

/**
 * A CREATE TABLE body split at its top-level commas: commas inside
 * parentheses (a DEFAULT expression, a CHECK) and inside quotes are kept.
 */
function splitTopLevel(body: string): string[] {
  const state: SplitState = { parts: [], current: "", depth: 0 };
  for (const char of body) readCharacter(state, char);
  const last = state.current.trim();
  return last === "" ? state.parts : [...state.parts, last];
}

/** Where {@link splitTopLevel} is in the body it reads. */
interface SplitState {
  parts: string[];
  current: string;
  depth: number;
  /** The quote character of the string being read, if inside one. */
  quote?: string;
}

/** One character of a CREATE TABLE body, read into `state`. */
function readCharacter(state: SplitState, char: string): void {
  if (state.quote === undefined && char === "," && state.depth === 0) {
    state.parts.push(state.current.trim());
    state.current = "";
    return;
  }
  state.current += char;
  if (state.quote !== undefined) {
    if (char === state.quote) state.quote = undefined;
    return;
  }
  if (QUOTES.has(char)) {
    state.quote = char;
    return;
  }
  state.depth += DEPTH_STEP[char] ?? 0;
}

/** The characters that open a quoted string or identifier in SQLite. */
const QUOTES = new Set(["'", '"', "`"]);

/** How far a character moves the parenthesis depth. */
const DEPTH_STEP: Readonly<Record<string, number>> = { "(": 1, ")": -1 };

/** Where the rest of one table's rebuild block is, and what its INSERT copies. */
interface CopyBlock {
  readonly insert: number;
  readonly drop: number;
  readonly rename: number;
  /** The columns the INSERT writes, in order. */
  readonly into: string[];
  /** The columns its SELECT reads from the live table, in order. */
  readonly from: string[];
}

/**
 * The INSERT, DROP and RENAME completing the rebuild of `table`, each the only
 * one of its kind for that table, or `undefined` when any is missing,
 * repeated, or names another table.
 */
function copyBlockOf(
  statements: readonly string[],
  table: string
): CopyBlock | undefined {
  const name = escapeRegExp(table);
  const inserts = indexesMatching(
    statements,
    new RegExp(
      `^\\s*INSERT\\s+INTO\\s+[\`"]__new_${name}[\`"]\\s*\\(([^)]*)\\)\\s*SELECT\\s+([^;]*?)\\s+FROM\\s+[\`"]${name}[\`"]\\s*;?\\s*$`,
      "i"
    )
  );
  const drops = indexesMatching(
    statements,
    new RegExp(
      `^\\s*DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?[\`"]${name}[\`"]\\s*;?\\s*$`,
      "i"
    )
  );
  const renames = indexesMatching(
    statements,
    new RegExp(
      `^\\s*ALTER\\s+TABLE\\s+[\`"]__new_${name}[\`"]\\s+RENAME\\s+TO\\s+[\`"]${name}[\`"]\\s*;?\\s*$`,
      "i"
    )
  );
  if (inserts.length !== 1 || drops.length !== 1 || renames.length !== 1) {
    return undefined;
  }
  const [insert] = inserts as [{ at: number; match: RegExpMatchArray }];
  const into = identifierList(insert.match[1] ?? "");
  const from = identifierList(insert.match[2] ?? "");
  if (into === undefined || from === undefined) return undefined;
  return {
    insert: insert.at,
    drop: (drops[0] as { at: number }).at,
    rename: (renames[0] as { at: number }).at,
    into,
    from,
  };
}

/** Each statement matching `pattern`, with where it is and what it matched. */
function indexesMatching(
  statements: readonly string[],
  pattern: RegExp
): Array<{ at: number; match: RegExpMatchArray }> {
  const found: Array<{ at: number; match: RegExpMatchArray }> = [];
  statements.forEach((statement, at) => {
    const match = statement.match(pattern);
    if (match !== null) found.push({ at, match });
  });
  return found;
}

/**
 * The names in a comma-separated list of quoted identifiers, or `undefined`
 * when any entry is something else, such as an expression.
 */
function identifierList(list: string): string[] | undefined {
  const names: string[] = [];
  for (const entry of list.split(",")) {
    const match = entry.trim().match(IDENTIFIER);
    if (match === null) return undefined;
    names.push(match[1] ?? "");
  }
  return names;
}

/** A declared type compared as SQLite reads it: case and spacing aside. */
function normalisedType(type: string): string {
  return type.toLowerCase().replace(/\s+/g, "");
}

/** Whether the rebuilt table declares exactly the live table's columns, by name and type. */
function sameColumns(
  rebuilt: readonly LiveColumn[],
  live: readonly LiveColumn[]
): boolean {
  if (rebuilt.length !== live.length) return false;
  const liveTypes = new Map(
    live.map(column => [column.name.toLowerCase(), normalisedType(column.type)])
  );
  if (liveTypes.size !== live.length) return false;
  const seen = new Set<string>();
  return rebuilt.every(column => {
    const name = column.name.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return liveTypes.get(name) === normalisedType(column.type);
  });
}

/** Whether the INSERT writes and reads every live column, each into itself. */
function copiesEveryColumn(
  block: CopyBlock,
  live: readonly LiveColumn[]
): boolean {
  const lower = (names: readonly string[]) =>
    names.map(name => name.toLowerCase());
  const into = lower(block.into);
  const from = lower(block.from);
  if (into.length !== from.length) return false;
  if (into.some((name, at) => name !== from[at])) return false;
  const liveNames = new Set(lower(live.map(column => column.name)));
  return (
    new Set(into).size === liveNames.size &&
    into.every(name => liveNames.has(name))
  );
}

/**
 * The CREATE INDEX statements for `table` naming an index the live table
 * already has, which drizzle-kit adds back after its rebuild: with the rebuild
 * left out they would only fail on the index that is still there.
 */
function liveIndexCreates(
  statements: readonly string[],
  table: string,
  live: LiveTable
): number[] {
  const liveIndexes = new Set(live.indexes.map(name => name.toLowerCase()));
  const pattern = new RegExp(
    `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\`"]([A-Za-z0-9_]+)[\`"]\\s+ON\\s+[\`"]${escapeRegExp(table)}[\`"]`,
    "i"
  );
  return indexesMatching(statements, pattern)
    .filter(({ match }) => liveIndexes.has((match[1] ?? "").toLowerCase()))
    .map(({ at }) => at);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
