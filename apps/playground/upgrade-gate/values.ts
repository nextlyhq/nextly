/**
 * Content for the upgrade gate's restored install, and the check that the
 * upgrade kept every value of it.
 *
 * The release's install holds the playground's schema and its system rows, but
 * no content, so an upgrade that moved a column's values somewhere else, or
 * lost them on the way, would plan the same operations and pass. The gate
 * therefore writes one entry into each content table first, with a distinct
 * value in every free-text column a person writes, in the table itself and,
 * where the install keeps the entity's translatable fields per language, in
 * the entry's rows of its translations table (`<table>_locales`) for the
 * default language and for another (`seedContent`). After the upgrade it
 * looks for each value where Nextly now keeps it (`lostValues`):
 *
 * - a value of the table itself or of the default language: the same column
 *   of the same row, or that column of the entry's default-language row;
 * - a value of another language: that column of the entry's row for the
 *   language, or, for a field that stopped being translated, the
 *   localization archive (`nextly_i18n_archive`), which keeps it under the
 *   entry and the language.
 *
 * A value found nowhere it may be kept is lost.
 *
 * Content tables are the collections' and Singles' own (`dc_`, `single_`), not
 * their translations tables and not a table with a foreign key, whose rows
 * would need another row first. A column Nextly writes itself (named `_...`,
 * the id, `created_by`) or one with a default is left to the database, so the
 * entry is one an editor could have saved.
 */
import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import pg from "pg";

import type { Catalog, Dialect } from "./catalog";

/** One value written into the install before the upgrade. */
export interface SeededValue {
  table: string;
  id: string;
  column: string;
  value: string;
  /** The language row of `<table>_locales` it was written to; absent for the table itself. */
  locale?: string;
}

/** The playground's default language, and another it declares. */
const DEFAULT_LOCALE = "en";
const OTHER_LOCALE = "es";

/** Runs one statement with positional parameters, returning its rows. */
type Query = (
  sql: string,
  params?: readonly unknown[]
) => Promise<Record<string, unknown>[]>;

/** A connection to `url` for the duration of `run`. */
async function withQuery<T>(
  dialect: Dialect,
  url: string,
  run: (query: Query) => Promise<T>
): Promise<T> {
  if (dialect === "sqlite") {
    const db = new Sqlite(url.replace(/^file:/, ""));
    try {
      return await run(async (sql, params = []) => {
        const statement = db.prepare(sql);
        return statement.reader
          ? (statement.all(...params) as Record<string, unknown>[])
          : (statement.run(...params), []);
      });
    } finally {
      db.close();
    }
  }
  if (dialect === "mysql") {
    const connection = await mysql.createConnection(url);
    try {
      return await run(async (sql, params = []) => {
        const [rows] = await connection.query(sql, [...params]);
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      });
    } finally {
      await connection.end();
    }
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(async (sql, params = []) => {
      // Positional `?` written once for every dialect, numbered for pg.
      let n = 0;
      const numbered = sql.replace(/\?/g, () => `$${++n}`);
      return (await client.query(numbered, [...params])).rows as Record<
        string,
        unknown
      >[];
    });
  } finally {
    await client.end();
  }
}

/** An identifier quoted for `dialect`. */
function quote(dialect: Dialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** Whether a column line from the catalog describes free text. */
function isText(line: string): boolean {
  return /^(text|character varying|varchar|char|character|mediumtext|longtext|tinytext)\b/i.test(
    line
  );
}

/** The longest value a column line allows, where it states one. */
function maxLength(line: string): number | undefined {
  const match = /^[a-z ]+\((\d+)\)/i.exec(line);
  return match ? Number(match[1]) : undefined;
}

/** A value a required column of another type accepts, on every dialect. */
function filler(line: string, dialect: Dialect): unknown {
  if (/^json/i.test(line)) return "{}";
  if (/^bool/i.test(line) || /^tinyint\(1\)/i.test(line)) {
    return dialect === "postgresql" ? true : 1;
  }
  if (/^(timestamp|datetime|date)/i.test(line)) return "2026-01-01 00:00:00";
  if (
    /^(int|integer|bigint|smallint|numeric|decimal|real|double|float)/i.test(
      line
    )
  ) {
    return 1;
  }
  return "1";
}

/** The content tables of `catalog`: see the file's header. */
function contentTables(catalog: Catalog): string[] {
  return Object.keys(catalog)
    .filter(
      table =>
        /^(dc|single)_/.test(table) &&
        !table.endsWith("_locales") &&
        !Object.entries(catalog[table].constraints).some(([name, line]) =>
          /foreign key/i.test(`${name} ${line}`)
        )
    )
    .sort();
}

/**
 * Writes one entry into each content table of the install at `url`, with a
 * distinct value in each free-text column an editor writes, and returns those
 * values.
 */
export async function seedContent(
  dialect: Dialect,
  url: string,
  catalog: Catalog
): Promise<SeededValue[]> {
  const seeded: SeededValue[] = [];
  let counter = 0;
  await withQuery(dialect, url, async query => {
    for (const table of contentTables(catalog)) {
      const id = `gate-${table}`.slice(0, 36);
      const columns: string[] = ["id"];
      const values: unknown[] = [id];
      for (const [column, line] of Object.entries(
        catalog[table].columns
      ).sort()) {
        if (column === "id") continue;
        const required = /\bnot null\b/i.test(line);
        const defaulted = /\bdefault\b/i.test(line);
        const written =
          !column.startsWith("_") && column !== "created_by" && !defaulted;
        if (written && isText(line)) {
          // Short enough for the narrowest column, and unique in the install.
          const value = `v${++counter}`.slice(0, maxLength(line) ?? 64);
          columns.push(column);
          values.push(value);
          seeded.push({ table, id, column, value });
        } else if (required && !defaulted) {
          columns.push(column);
          values.push(filler(line, dialect));
        }
      }
      await query(
        `INSERT INTO ${quote(dialect, table)} (${columns.map(c => quote(dialect, c)).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        values
      );
      // Where the install already keeps the entity's translatable fields per
      // language, the entry has a row for the default language and one for
      // another, each with values of its own.
      const companion = `${table}_locales`;
      if (catalog[companion] === undefined) continue;
      for (const locale of [DEFAULT_LOCALE, OTHER_LOCALE]) {
        const localeColumns: string[] = ["_parent", "_locale"];
        const localeValues: unknown[] = [id, locale];
        for (const [column, line] of Object.entries(
          catalog[companion].columns
        ).sort()) {
          if (column.startsWith("_")) continue;
          const required = /\bnot null\b/i.test(line);
          const defaulted = /\bdefault\b/i.test(line);
          if (!defaulted && isText(line)) {
            const value = `v${++counter}`.slice(0, maxLength(line) ?? 64);
            localeColumns.push(column);
            localeValues.push(value);
            seeded.push({ table, id, column, value, locale });
          } else if (required && !defaulted) {
            localeColumns.push(column);
            localeValues.push(filler(line, dialect));
          }
        }
        await query(
          `INSERT INTO ${quote(dialect, companion)} (${localeColumns.map(c => quote(dialect, c)).join(", ")}) VALUES (${localeColumns.map(() => "?").join(", ")})`,
          localeValues
        );
      }
    }
  });
  return seeded;
}

/** Whether the localization archive keeps `value` for the entry `id` in `locale`. */
async function archived(
  query: Query,
  dialect: Dialect,
  id: string,
  locale: string,
  value: string
): Promise<boolean> {
  const q = (name: string) => quote(dialect, name);
  const rows = await query(
    `SELECT COUNT(*) AS n FROM ${q("nextly_i18n_archive")} WHERE ${q("entry_id")} = ? AND ${q("locale")} = ? AND ${q("value")} = ?`,
    [id, locale, value]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Each of `seeded` the database at `url` no longer holds where Nextly keeps it
 * (see the file's header), as `table.column`.
 */
export async function lostValues(
  dialect: Dialect,
  url: string,
  seeded: readonly SeededValue[]
): Promise<string[]> {
  return withQuery(dialect, url, async query => {
    const lost: string[] = [];
    for (const { table, id, column, value, locale } of seeded) {
      const read = async (from: string, where: string, params: unknown[]) => {
        try {
          const [row] = await query(
            `SELECT ${quote(dialect, column)} AS v FROM ${quote(dialect, from)} WHERE ${where}`,
            params
          );
          return row === undefined ? undefined : String(row.v);
        } catch {
          // No such column or table: the value is not kept there.
          return undefined;
        }
      };
      const inLanguage = (code: string) =>
        read(
          `${table}_locales`,
          `${quote(dialect, "_parent")} = ? AND ${quote(dialect, "_locale")} = ?`,
          [id, code]
        );
      const kept =
        locale === undefined || locale === DEFAULT_LOCALE
          ? (await read(table, `${quote(dialect, "id")} = ?`, [id])) ===
              value || (await inLanguage(DEFAULT_LOCALE)) === value
          : (await inLanguage(locale)) === value ||
            (await archived(query, dialect, id, locale, value));
      if (!kept) {
        lost.push(`${table}.${column}${locale ? ` (${locale})` : ""}`);
      }
    }
    return lost;
  });
}
