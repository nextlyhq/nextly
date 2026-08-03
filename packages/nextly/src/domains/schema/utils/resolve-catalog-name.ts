/**
 * Resolves a name Nextly stored to the name the database actually reports.
 *
 * Every caller that maps a stored name onto a live object routes through here, so
 * one rule governs the question. Independent versions of a naming rule drift, and
 * the drift stays invisible until it reaches a database whose comparison
 * behaviour exercises the difference.
 *
 * Whether two spellings name one object is **not** a property of the name. It is
 * a property of the server, so it is an input here rather than a constant, and
 * `identifierCaseRules` is the only place that maps a server to it.
 *
 * @module domains/schema/utils/resolve-catalog-name
 */

import { NextlyError } from "../../../errors/nextly-error";

/**
 * How a server decides whether two spellings name the same object.
 *
 * - `preserve` — case is significant. `SEO_META` and `seo_meta` are two
 *   different objects, and a stored name absent from the catalog is genuinely
 *   absent no matter what else the catalog holds.
 * - `fold-ascii` — case is not significant, but **only for `A`–`Z`**. This is
 *   SQLite, which documents that it understands upper and lower case for ASCII
 *   characters only: `Ä` and `ä` are two distinct tables there, and neither can
 *   be queried through the other's spelling.
 * - `fold-unicode` — case is not significant across the character set. This is
 *   MySQL, which lowercases names using the system character set rather than
 *   ASCII rules.
 *
 * The two folds are separate because collapsing them is wrong in both
 * directions: Unicode-folding on SQLite merges two real tables, and
 * ASCII-folding on MySQL fails to find a table the server itself lowercased.
 * Nextly's own identifiers are ASCII (`normalizeIdentifier` strips everything
 * else), so the distinction only bites on a name an author chose.
 */
export type IdentifierCase = "preserve" | "fold-ascii" | "fold-unicode";

/**
 * Fold a name for lookup, under the server's rules.
 *
 * `preserve` never reaches here — a preserving server has no folded lookup — so
 * the two folding modes are the whole domain.
 */
function foldName(name: string, mode: "fold-ascii" | "fold-unicode"): string {
  // ASCII rules fold `A`-`Z` and nothing else. `toLowerCase()` would also map
  // `Ä` to `ä`, merging two names SQLite keeps apart.
  if (mode === "fold-ascii") {
    return name.replace(/[A-Z]/g, character => character.toLowerCase());
  }

  // A server's case table maps one character to one character. JavaScript
  // applies Unicode's *full* mapping, which for `İ` (U+0130) produces `i` plus a
  // combining dot where a server produces `i` alone — so a folded lookup would
  // key `İTEM` as `i̇tem` while the catalog reports `item`. Taking the first code
  // point of the mapping is the simple mapping for every character whose full
  // mapping expands, so the two agree.
  let folded = "";
  for (const character of name) {
    const lowered = character.toLowerCase();
    folded += [...lowered][0] ?? character;
  }
  return folded;
}

/**
 * A server's rules, which differ between tables and columns on MySQL.
 *
 * Kept as two fields rather than one because collapsing them is wrong on the
 * dialect that matters most here: MySQL compares column names case-insensitively
 * on every server, while its table names follow `lower_case_table_names`. A
 * single value would have to be wrong for one of the two.
 */
export interface IdentifierCaseRules {
  readonly tables: IdentifierCase;
  readonly columns: IdentifierCase;
}

/**
 * The server whose rules are being described.
 *
 * MySQL requires `lowerCaseTableNames` because its table-name behaviour is
 * server configuration, not a dialect property, and no static default is safe:
 * assuming `fold` makes a missing table look present on a case-sensitive server,
 * and assuming `preserve` refuses a legitimate upgrade on a folding one. Making
 * it a required field means a caller cannot reach that guess by omission.
 */
export type IdentifierCaseServer =
  | { dialect: "postgresql" }
  | { dialect: "sqlite" }
  | { dialect: "mysql"; lowerCaseTableNames: number };

/**
 * Map a server to its identifier-comparison rules.
 *
 * - **Postgres** preserves both. Every identifier Nextly emits is quoted
 *   (`quoteIdent`), so the server stores exactly the name it was given and never
 *   folds it. Comparing folded here would merge two genuinely distinct tables.
 * - **SQLite** folds both, but **ASCII-only**: it understands upper and lower
 *   case for `A`–`Z` and nothing else, so `Ä` and `ä` are two distinct tables
 *   there and a Unicode fold would merge them.
 * - **MySQL** folds columns always. Its tables follow `lower_case_table_names`:
 *   `0` stores and compares case-sensitively, `1` lowercases names on creation,
 *   and `2` stores them as given but compares case-insensitively. Only `0`
 *   preserves. Under `1` the catalog reports a lowercased name for a table
 *   created with capitals, which is exactly the case a folded lookup must find.
 */
export function identifierCaseRules(
  server: IdentifierCaseServer
): IdentifierCaseRules {
  if (server.dialect === "postgresql") {
    return { tables: "preserve", columns: "preserve" };
  }
  if (server.dialect === "sqlite") {
    return { tables: "fold-ascii", columns: "fold-ascii" };
  }
  return {
    tables: server.lowerCaseTableNames === 0 ? "preserve" : "fold-unicode",
    columns: "fold-unicode",
  };
}

/**
 * A catalog listing, prepared once for repeated lookups.
 *
 * Built from `adapter.listTables()` for tables, or a table's column names for
 * columns. The folded index is kept even when the server preserves case: it is
 * not used to resolve then, but it is what lets a refusal say "the name you
 * stored is absent and one differing only in case is present", which is the
 * difference between an operator fixing a row and an operator guessing.
 */
export interface CatalogIndex {
  /** Names exactly as the database reported them. */
  readonly exact: ReadonlySet<string>;
  /** Lower-cased name to the first catalog entry that folded to it. */
  readonly folded: ReadonlyMap<string, string>;
  /** How this catalog's server compares the names it reported. */
  readonly identifierCase: IdentifierCase;
}

/** Index a catalog listing for lookup under a server's comparison rules. */
export function indexCatalog(
  names: readonly string[],
  identifierCase: IdentifierCase
): CatalogIndex {
  const exact = new Set(names);
  const folded = new Map<string, string>();
  for (const name of names) {
    // A preserving server has no folded lookup, so the index it would feed is
    // never consulted for resolution; ASCII rules are used to build it anyway so
    // `findCaseVariant` can still name a near-miss in a refusal.
    const key = foldName(
      name,
      identifierCase === "preserve" ? "fold-ascii" : identifierCase
    );
    // First writer wins, so an ambiguous fold cannot silently retarget an
    // object: if a case-preserving server holds both `SEO_META` and `seo_meta`,
    // a folded lookup keeps pointing at whichever the catalog listed first
    // rather than alternating between two real objects.
    if (!folded.has(key)) folded.set(key, name);
  }
  return { exact, folded, identifierCase };
}

/**
 * Resolve a stored name to the catalog's spelling of it, or `undefined`.
 *
 * An exact hit always wins, on every server. The folded fallback runs only where
 * the server folds, because there and only there do the two spellings name one
 * object:
 *
 * - On a **folding** server the fallback is necessary. MySQL under
 *   `lower_case_table_names=1` reports a table created as `SEO_META` as
 *   `seo_meta`, so an exact-only lookup would call a table that exists missing
 *   and orphan its rows.
 * - On a **preserving** server the fallback is unsound. Postgres, and MySQL with
 *   `lower_case_table_names=0`, hold `SEO_META` and `seo_meta` as distinct
 *   objects, so folding would report a missing object as present and let the
 *   caller address one that is not there — or, worse, a different application's.
 *
 * The value returned is always the name the catalog reported, because that is
 * the spelling later statements have to address, not the spelling Nextly
 * happened to store.
 */
export function resolveCatalogName(
  catalog: CatalogIndex,
  storedName: string
): string | undefined {
  if (catalog.exact.has(storedName)) return storedName;
  if (catalog.identifierCase === "preserve") return undefined;
  return catalog.folded.get(foldName(storedName, catalog.identifierCase));
}

/**
 * The catalog entry differing from `storedName` only by case, if there is one
 * and it is not the resolved answer.
 *
 * Only ever non-empty on a case-preserving server, where such an entry is a
 * *different* object. It exists for refusal messages: "`comp_hero` is missing"
 * sends an operator looking for a dropped table, while "`comp_hero` is missing
 * and `COMP_HERO` is present" names the actual problem.
 */
export function findCaseVariant(
  catalog: CatalogIndex,
  storedName: string
): string | undefined {
  if (catalog.exact.has(storedName)) return undefined;
  const variant = catalog.folded.get(
    foldName(
      storedName,
      catalog.identifierCase === "preserve"
        ? "fold-ascii"
        : catalog.identifierCase
    )
  );
  return variant === storedName ? undefined : variant;
}

/**
 * Read a MySQL server's `lower_case_table_names` from a raw value.
 *
 * Drivers disagree about the type of a server variable — some return the number,
 * some the string — and an unparseable value must not fall back to a default,
 * because both defaults are wrong on some server. Refusing keeps the guess out.
 */
export function parseLowerCaseTableNames(value: unknown): number {
  const parsed = typeof value === "string" ? parseSetting(value) : value;
  // Constrained to the values MySQL defines rather than to "any non-negative
  // integer". `Number("")` is `0`, so a blank value would otherwise read as the
  // case-sensitive setting, and an unrecognised number would be sorted into one
  // behaviour or the other — both are guesses about how the server compares
  // names, which is the one thing this must not do.
  if (parsed !== 0 && parsed !== 1 && parsed !== 2) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "cannot determine how this MySQL server compares table names: lower_case_table_names is unreadable",
      logContext: {
        reason: "lower_case_table_names is not 0, 1 or 2",
        value,
      },
    });
  }
  return parsed;
}

/** `undefined` for anything that is not a plain integer literal. */
function parseSetting(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
