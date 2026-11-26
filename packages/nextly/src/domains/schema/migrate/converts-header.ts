/**
 * The mark a migration file carries where its field type changes convert each value as the new
 * type reads it, rather than leaving the database's cast to reach them: the version of the
 * conversion rules it was written under, and each column it converts, by table. A Schema Builder
 * save that converts its values here writes it (`formatMigrationFile`), and `nextly migrate`
 * reading it converts the values of the database it runs on the same way, judged by the same
 * rules, before the file's statements change the column. A file without it keeps the plain cast.
 *
 * The version names the rules, so a later Nextly converts a file alike or refuses it: a file
 * written under rules this version does not know is refused before any statement, never converted
 * by other rules or left to the cast.
 *
 * @module domains/schema/migrate/converts-header
 */
import { NextlyError } from "../../../errors/nextly-error";

import { isUpMarker } from "./sql-sections";

/** The version of the conversion rules this Nextly converts by, and writes into the mark. */
const CONVERSION_RULES_VERSION = 1;

/** The header line's start: `-- Converts values: rules 1; posts.price, posts_locales.title`. */
const CONVERTS_HEADER = "-- Converts values:";

/** One column a file converts. */
export interface ConvertedColumnName {
  table: string;
  column: string;
  /** The value it writes into the rows of a required field its change would leave with none. */
  fill?: { value: unknown };
}

/** What a file's mark states: the rules it was written under and the columns it converts. */
export interface ConvertsMark {
  rules: number;
  columns: readonly ConvertedColumnName[];
}

/** The header line marking a file that converts `columns`, or nothing where it converts none. */
export function convertsHeaderLine(
  columns: readonly ConvertedColumnName[]
): string {
  if (columns.length === 0) return "";
  const names = columns.map(columnEntry).join(", ");
  return `${CONVERTS_HEADER} rules ${String(CONVERSION_RULES_VERSION)}; ${names}\n`;
}

/**
 * A column as a mark names it: `posts.price`, with its fill where it has one, `posts.price fill 0`. The
 * fill is its JSON, percent-encoded, so it holds no space, comma, quote or line break of its own.
 */
function columnEntry(column: ConvertedColumnName): string {
  const name = `${column.table}.${column.column}`;
  if (column.fill === undefined) return name;
  const fill = encodeURIComponent(JSON.stringify(column.fill.value)).replace(
    /[!'()*]/g,
    character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
  return `${name} fill ${fill}`;
}

/** A column read back from a mark (`columnEntry`), or null where it is not one. */
function columnFrom(entry: string): ConvertedColumnName | null {
  const match = COLUMN.exec(entry.trim());
  if (match === null) return null;
  const [, table, column, fill] = match;
  if (fill === undefined) return { table, column };
  try {
    return {
      table,
      column,
      fill: { value: JSON.parse(decodeURIComponent(fill)) as unknown },
    };
  } catch {
    return null;
  }
}

/** A mark's line as written (`convertsHeaderLine`). */
const MARK = /^-- Converts values:\s*rules\s+(\d+)\s*;\s*(.+)$/;

/** A table and column name as a mark writes them: identifiers, joined by a dot, and a fill, if any. */
const COLUMN = /^([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)(?: fill (\S+))?$/;

/**
 * The mark of a migration file's `content`, read in its header (the lines above `-- UP`), or null
 * where it has none: a file written before the mark, or one whose changes the cast converts.
 *
 * @throws {NextlyError} where the header has the mark's line but it cannot be read, or names
 *   rules this version does not know: the file is refused, never run by the cast in their place
 */
export function readConvertsMark(
  content: string,
  filename: string
): ConvertsMark | null {
  const lines = content.split(/\r?\n/);
  const up = lines.findIndex(line => isUpMarker(line.trim()));
  const header = up === -1 ? lines : lines.slice(0, up);
  const line = header
    .map(each => each.trim())
    .find(each => each.startsWith(CONVERTS_HEADER));
  if (line === undefined) return null;
  const match = MARK.exec(line);
  const columns = (match?.[2] ?? "").split(",").map(columnFrom);
  if (match === null || columns.some(column => column === null)) {
    throw markRefusal(
      filename,
      `its line \`${line}\` cannot be read. A file the Schema Builder writes states it as \`${CONVERTS_HEADER} rules ${String(CONVERSION_RULES_VERSION)}; <table>.<column>, …\`.`
    );
  }
  const rules = Number(match[1]);
  if (rules !== CONVERSION_RULES_VERSION) {
    throw markRefusal(
      filename,
      `it was written under conversion rules ${String(rules)}, and this version of Nextly converts by rules ${String(CONVERSION_RULES_VERSION)}.`
    );
  }
  return {
    rules,
    columns: columns.flatMap(column => column ?? []),
  };
}

/**
 * The refusal of a marked migration whose snapshots do not both record the fields, the one it is
 * judged from and the one it is judged to (the file's own and the newest before it, either way
 * round): a snapshot missing from `meta/`, or one written before snapshots recorded fields. Which
 * value converts, and to what, is read from the two, so nothing is converted, and nothing is left
 * to the database's cast instead.
 */
export function unjudgeableMarkRefusal(filename: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: `migrations.${filename}`,
        code: "TYPE_CHANGE_BLOCKED",
        message: `Migration ${filename} converts its field type changes' values, but the snapshots it is judged between do not both record the fields: one is missing from meta/, or was written before snapshots recorded them. Nothing was changed.`,
      },
    ],
    logContext: { reason: "converts-snapshot-missing", file: filename },
  });
}

/** The refusal of a file whose mark cannot be followed, saying why. */
function markRefusal(filename: string, why: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: `migrations.${filename}`,
        code: "TYPE_CHANGE_BLOCKED",
        message: `Migration ${filename} converts its field type changes' values, but ${why} Nothing was changed.`,
      },
    ],
    logContext: { reason: "converts-mark-unreadable", file: filename },
  });
}
