/**
 * The site's content languages, when they are managed in Settings rather than declared in code.
 *
 * A leaf module so the SQLite fallback DDL can name the table without importing the schema.
 *
 * @module schemas/languages/table-name
 */
export const LANGUAGES_TABLE = "nextly_languages";
