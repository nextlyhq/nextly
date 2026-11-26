/**
 * What `nextly migrate`, `nextly migrate:check` and `nextly migrate:create` say when a change they
 * meet is text-like fields moving from an entity's main table to its per-language table
 * (`<table>_locales`): a site whose migrations were written before every installation kept such
 * fields per language meets it on its first run of this release. Listed bare, the move reads as
 * columns dropped, so each command names it as a move, says nothing is lost, and gives the two
 * safe ways forward. One wording for all three, so they never disagree.
 *
 * Import-free, so the CLI's error mappings read it without loading the schema pipeline. Which
 * fields move is decided by `perLanguageMovesIn` (`domains/schema/migrate-create/per-language-moves`).
 *
 * @module domains/i18n/per-language-move-guidance
 */

/** One entity's fields whose columns move from its main table to its per-language table. */
export interface PerLanguageMove {
  /** The entity's main table, such as `dc_posts`. */
  table: string;
  /** Its per-language table, `<table>_locales`. */
  localesTable: string;
  /** Each field that moves, by name and type, in declaration order. */
  fields: { name: string; type: string }[];
  /** The main-table columns those fields' values leave. */
  columns: string[];
}

/** The note a drop of a column that moves carries, or "" for any other column. */
export function movedColumnNote(
  moves: readonly PerLanguageMove[],
  table: string,
  column: string
): string {
  const move = moves.find(m => m.table === table && m.columns.includes(column));
  return move === undefined ? "" : ` (moves to ${move.localesTable})`;
}

/** One entity's moving fields: `dc_posts: title, summary -> dc_posts_locales`. */
export function describePerLanguageMove(move: PerLanguageMove): string {
  return `${move.table}: ${move.fields.map(f => f.name).join(", ")} -> ${move.localesTable}`;
}

/** Each entity's moving fields as an indented line. */
function moveLines(moves: readonly PerLanguageMove[]): string[] {
  return moves.map(m => `  ${describePerLanguageMove(m)}`);
}

/** Why the listed drops are not data loss, naming every field that moves and where. */
export function perLanguageMoveWhy(moves: readonly PerLanguageMove[]): string {
  return [
    "Not data loss: Nextly keeps every text-like field in a per-language table, `<table>_locales`, " +
      "even on a site with one language, unless the field is marked `localized: false`. " +
      "These fields would move there:",
    ...moveLines(moves),
    "Nothing is lost: the migration that moves them copies every value into the per-language " +
      "table before it removes a column from the main table.",
  ].join("\n");
}

/**
 * The two safe ways forward: keep the fields on the main table, or move them on purpose. `then`
 * is what the command running it asks for after either edit: marking a field records a settings
 * change, which takes a migration too, one that moves no values.
 */
export function perLanguageMoveNext(
  moves: readonly PerLanguageMove[],
  then: string
): string {
  const example = moves[0]?.fields[0] ?? { name: "title", type: "text" };
  return [
    "Choose one of two safe ways forward:",
    "  1. Keep them on the main table: add `localized: false` to each field listed, as Nextly's own " +
      `plugins do, for example \`${example.type}({ name: "${example.name}", localized: false })\`. ` +
      "Nothing moves; then " +
      then,
    "  2. Move them on purpose: declare a `localization` block with its default language in the " +
      'config, for example `localization: { locales: ["en"], defaultLocale: "en" }`, then ' +
      then,
  ].join("\n");
}

/**
 * The `next` of a SCHEMA_DRIFT that lists moves among its changes: the two safe ways forward and,
 * where any listed change is not a move (`others`), `createMigration`, the remedy those others need
 * whichever way is chosen. Told, never counted: a table's moves are one line of the list however
 * many fields move.
 */
export function perLanguageDriftNext(
  moves: readonly PerLanguageMove[],
  others: boolean,
  createMigration: string
): string {
  return [
    perLanguageMoveNext(
      moves,
      'run `nextly migrate:create --name="<migration-name>"`, commit the result, and run `nextly migrate` again.'
    ),
    ...(others ? [`For the other changes listed: ${createMigration}`] : []),
  ].join("\n");
}

/**
 * The moves an error recorded in its log context, as {@link PerLanguageMove}s: an empty list
 * for a value of any other shape, so a reader falls back to the error's own words.
 */
export function perLanguageMovesFrom(value: unknown): PerLanguageMove[] {
  if (!Array.isArray(value)) return [];
  const isText = (v: unknown): v is string => typeof v === "string";
  const moves = value.filter(
    (m): m is PerLanguageMove =>
      typeof m === "object" &&
      m !== null &&
      isText((m as PerLanguageMove).table) &&
      isText((m as PerLanguageMove).localesTable) &&
      Array.isArray((m as PerLanguageMove).columns) &&
      (m as PerLanguageMove).columns.every(isText) &&
      Array.isArray((m as PerLanguageMove).fields) &&
      (m as PerLanguageMove).fields.every(
        f =>
          typeof f === "object" &&
          f !== null &&
          isText(f.name) &&
          isText(f.type)
      )
  );
  return moves.length === value.length ? moves : [];
}
