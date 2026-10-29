/**
 * Classification of "a statement named a column the table does not have".
 *
 * This is the ONE implementation of that question. Three call sites used to answer it
 * independently — a staleness read, a lock-table capability probe and a degraded index
 * push — and the three disagreed about which dialect errors count, in ways that made
 * each blind to the others' cases.
 *
 * Matched on driver ERROR CODES rather than message wording. MySQL's messages are
 * localizable: `lc_messages` selects among roughly twenty translations, has SESSION
 * scope as well as global, and can be changed at runtime, so a server that answers in
 * anything but English defeats an English regex. That failure is silent and lands in
 * the dangerous direction — the predicate returns false, the caller concludes the
 * column is present, and the tolerance the caller exists to provide is skipped.
 *
 * Wording is still consulted, but only for a level whose code does not classify — SQLite,
 * which exposes no code for this, and any level whose code a wrapper has dropped. Because
 * the code is read first, the wording never has to survive translation.
 */

/**
 * Which of the two distinct ways a column can be missing an error reports.
 *
 * MySQL is the only dialect that separates them, and the separation matters because the
 * callers tolerate them in different situations: a SELECT naming an absent column is a
 * schema older than the code reading it, while CREATE INDEX naming one is an additive
 * baseline that has not yet added the column it is about to index. PostgreSQL and SQLite
 * raise one error for both, so both report `"statement"` there — callers that care about
 * the distinction scope it by the statement they issued, which they already know.
 */
export type MissingColumnKind = "statement" | "index";

/** MySQL: ER_BAD_FIELD_ERROR — a statement names a column the table does not have. */
const MYSQL_BAD_FIELD = new Set(["1054", "ER_BAD_FIELD_ERROR", "42S22"]);
/** MySQL: ER_KEY_COLUMN_DOES_NOT_EXIST — an index names a column the table does not have. */
const MYSQL_KEY_COLUMN = new Set(["1072", "ER_KEY_COLUMN_DOES_NOT_EXIST"]);
/** PostgreSQL: undefined_column. Raised for both statements and index definitions. */
const POSTGRES_UNDEFINED_COLUMN = "42703";

/**
 * Wording, used only where a level carries no code that classifies.
 *
 * SQLite forces this: it exposes no distinct code, so its wording is the only signal
 * there is. The other two dialects are listed for a different reason — a level whose code
 * has been stripped by a wrapper, or an error synthesised rather than thrown by a driver,
 * still reads correctly instead of falling through. Because a code is consulted first,
 * these never have to survive translation, which is what makes it safe to keep matching
 * English here.
 *
 * Each pattern is anchored to a full documented wording rather than a loose fragment.
 * A bare "does not exist" would also match a missing TABLE, and treating that as a
 * missing column would let a caller tolerate a reconcile that had gone wrong in a way it
 * cannot repair.
 */
const WORDINGS: ReadonlyArray<readonly [RegExp, MissingColumnKind]> = [
  // MySQL ER_KEY_COLUMN_DOES_NOT_EXIST. Listed before the generic wordings because it is
  // the more specific of the two MySQL forms.
  [/key column .* doesn't exist in table/i, "index"],
  // SQLite, for a statement that reads the column and for an INSERT naming it
  [/no such column/i, "statement"],
  [/has no column named/i, "statement"],
  // MySQL ER_BAD_FIELD_ERROR
  [/unknown column/i, "statement"],
  // PostgreSQL
  [/column .* does not exist/i, "statement"],
];

/**
 * The code carried by THIS error object, read without following the chain.
 *
 * Deliberately narrower than `safeCode` in database/errors.ts, which reaches into
 * `.cause` and `.originalError` to find a code anywhere beneath. That reach is right for
 * mapping an error to a kind, and wrong here: this module walks the chain itself, and a
 * code borrowed from a nested cause would be attributed to a wrapper whose message is the
 * SQL text. The named variant below would then read the column name out of the statement
 * it was running rather than out of the driver's complaint, and match any query that
 * merely mentions the column.
 */
function ownCode(link: unknown): string | undefined {
  if (!link || typeof link !== "object") return undefined;
  const record = link as Record<string, unknown>;
  const raw = record.code ?? record.sqlState ?? record.state ?? record.errno;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string" && raw.length > 0) return raw;
  return undefined;
}

/**
 * The message carried by THIS error object.
 *
 * Only two shapes carry a readable one. Anything else yields "" rather than being
 * stringified: `String(someObject)` produces "[object Object]", which matches nothing and
 * would quietly make the level unexaminable while looking like it had been examined.
 */
function ownMessage(link: unknown): string {
  if (link instanceof Error) return link.message;
  if (typeof link === "string") return link;
  return "";
}

/**
 * What one level of the chain reports, ignoring every other level.
 *
 * The code is consulted first and the wording only when it does not classify, so a driver
 * answering in a language other than English is read correctly while an error that never
 * carried a code is still read at all.
 */
function kindOfLevel(link: unknown): MissingColumnKind | undefined {
  const code = ownCode(link);
  if (code !== undefined) {
    if (MYSQL_KEY_COLUMN.has(code)) return "index";
    if (MYSQL_BAD_FIELD.has(code)) return "statement";
    if (code === POSTGRES_UNDEFINED_COLUMN) return "statement";
  }
  const message = ownMessage(link);
  return WORDINGS.find(([pattern]) => pattern.test(message))?.[1];
}

/**
 * Walks an error and its causes, applying `visit` to each level, and returns the first
 * answer any level gives.
 *
 * Bounded by identity rather than by a depth constant: a cause chain that loops would
 * otherwise spin here, and a legitimate chain is short. Drivers are wrapped more than
 * once — v1 puts the original on `.cause` of a DrizzleQueryError — so the level that
 * knows the code is rarely the level thrown.
 */
function firstAnswer<T>(
  error: unknown,
  visit: (link: unknown) => T | undefined
): T | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const answer = visit(current);
    if (answer !== undefined) return answer;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/**
 * How this error reports a missing column, or undefined when it does not report one.
 */
export function missingColumnKind(
  error: unknown
): MissingColumnKind | undefined {
  return firstAnswer(error, kindOfLevel);
}

/** Whether this error reports a missing column, in either of the two forms. */
export function isMissingColumnError(error: unknown): boolean {
  return missingColumnKind(error) !== undefined;
}

/**
 * Whether this error reports that ONE PARTICULAR column is missing.
 *
 * A caller tolerating a schema that predates a single column must not also swallow a
 * different column's absence: that would report the site as having no data when it
 * actually has a broken query. The code establishes the shape and the name narrows it,
 * and BOTH are required of the same level — reading the name from one level and the
 * shape from another would match the name in a wrapper's SQL text against an unrelated
 * failure underneath it.
 *
 * The name survives localization even though the wording does not. MySQL translates the
 * message TEMPLATE and substitutes identifiers into it; `Unknown column '%-.192s' in
 * '%-.192s'` is translated, the identifier written into it is not. So the name is
 * readable on a server answering in any language, which is precisely why it can still
 * narrow a match that is otherwise established by code.
 */
export function isMissingNamedColumnError(
  error: unknown,
  column: string
): boolean {
  return (
    firstAnswer(error, link =>
      kindOfLevel(link) !== undefined && ownMessage(link).includes(column)
        ? true
        : undefined
    ) ?? false
  );
}

/**
 * What a failed statement found missing from the database: a column, a table,
 * or a table this running instance never registered.
 *
 * The last is not a database failure at all. The adapters refuse a CRUD call
 * naming a table their resolver does not hold, with a code of their own, before
 * any statement runs; on a running site that is an entity a migration added
 * after the instance started. All three mean the same to whoever reads the
 * answer, that the database and the running code disagree, which is why one
 * function answers them.
 */
export type MissingSchemaObject = "column" | "table" | "unregistered";

/**
 * The adapters' code for a CRUD call naming a table their resolver does not
 * hold, as core reads it.
 *
 * Kept here rather than imported from `@nextlyhq/adapter-drizzle/types`, where
 * the adapters define it, for the reason `pool-wait-code.ts` gives: this module
 * has no imports, and a runtime import of a database package would follow it
 * into every client-safe entry. The same string as the adapters', held to it
 * by `missing-column.test.ts`.
 */
export const TABLE_NOT_REGISTERED_CODE = "NEXTLY_TABLE_NOT_REGISTERED";

/** PostgreSQL: undefined_table. */
const POSTGRES_UNDEFINED_TABLE = "42P01";
/** MySQL: ER_NO_SUCH_TABLE, as its string code, its errno and its SQLSTATE. */
const MYSQL_NO_SUCH_TABLE = new Set(["1146", "ER_NO_SUCH_TABLE", "42S02"]);

/**
 * A missing table's wording, read only where a level's code does not classify,
 * as {@link WORDINGS} is. SQLite has no code for it; the other two are listed
 * for a level a wrapper stripped the code from.
 */
const TABLE_WORDINGS: readonly RegExp[] = [
  // SQLite
  /no such table/i,
  // MySQL ER_NO_SUCH_TABLE
  /table .* doesn't exist/i,
  // PostgreSQL
  /relation .* does not exist/i,
];

/**
 * What one level of the chain reports missing, ignoring every other level.
 *
 * Codes first, as everywhere in this module. Of the wordings, the column's are
 * read before the table's: PostgreSQL's for a write names the relation as well
 * (`column "x" of relation "t" does not exist`), and no table wording names a
 * column.
 */
function objectOfLevel(link: unknown): MissingSchemaObject | undefined {
  const code = ownCode(link);
  if (code === TABLE_NOT_REGISTERED_CODE) return "unregistered";
  if (
    code === POSTGRES_UNDEFINED_TABLE ||
    MYSQL_NO_SUCH_TABLE.has(code ?? "")
  ) {
    return "table";
  }
  if (kindOfLevel(link) !== undefined) return "column";
  const message = ownMessage(link);
  return TABLE_WORDINGS.some(pattern => pattern.test(message))
    ? "table"
    : undefined;
}

/**
 * What this error reports missing from the database, and the text of the
 * level that reports it, or undefined when it reports nothing missing.
 *
 * The text is the DEEPEST reporting level's own message, the driver's. A
 * wrapper above it may also classify, from a code it copied, and its message
 * is the statement or a context line, which names every table and column the
 * statement touched; only the driver's says which one is missing. So a caller
 * reading a name out of the text reads it from the level that knows.
 */
export function missingSchemaObject(
  error: unknown
): { object: MissingSchemaObject; text: string } | undefined {
  let found: { object: MissingSchemaObject; text: string } | undefined;
  firstAnswer(error, link => {
    const object = objectOfLevel(link);
    if (object !== undefined) found = { object, text: ownMessage(link) };
    // Never an answer, so the walk reaches the deepest level.
    return undefined;
  });
  return found;
}

/**
 * Where `name` stands in `text` as an identifier, or -1 when it does not.
 *
 * An identifier, in every dialect's wording, is quoted (`'x'`, `"x"`,
 * `` `x` ``), qualified (`t.x`), or follows SQLite's `: ` or `named `; the
 * words of the sentence around it are none of these. So a field named `table`
 * or `column` is not read out of "table t has no column named x", and `title`
 * is not read out of `subtitle`, nor a table out of its companion's name.
 */
function identifierAt(text: string, name: string): number {
  if (name.length === 0) return -1;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(['"\`.]|: |named )${escaped}(?![A-Za-z0-9_$])`,
    "i"
  ).exec(text);
  return match ? match.index + match[1].length : -1;
}

/**
 * Which of `candidates` the text names as an identifier, the one named first
 * when several are, or undefined when it names none.
 *
 * Identifiers are matched rather than parsed out of a dialect's template
 * because MySQL translates its templates and writes the identifiers into them
 * untranslated, so the name is readable in any language where the template is
 * not. The earliest wins because each dialect's wording names the missing
 * column before any other column, and the missing table before any other
 * table.
 */
export function firstIdentifierNamed(
  text: string,
  candidates: Iterable<string>
): string | undefined {
  let best: { name: string; at: number } | undefined;
  for (const name of candidates) {
    const at = identifierAt(text, name);
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  return best?.name;
}

/**
 * The table `text` says the missing `column` belongs to, or undefined when it
 * names none, as MySQL's unqualified wording does.
 *
 * Read from the three places a dialect puts it: a qualifier (`t.x`, in
 * PostgreSQL's and MySQL's wording for a read), PostgreSQL's `of relation "t"`
 * for a write, and SQLite's `table t has no column named x` for an INSERT.
 */
export function tableOfMissingColumn(
  text: string,
  column: string
): string | undefined {
  const at = identifierAt(text, column);
  if (at > 0 && text[at - 1] === ".") {
    return /([A-Za-z0-9_$]+)["`]?$/.exec(text.slice(0, at - 1))?.[1];
  }
  return (
    /of relation "([^"]+)"/i.exec(text)?.[1] ??
    /^table (\S+) has no column named/i.exec(text)?.[1]
  );
}
