/**
 * Reads the stored language list (`nextly_languages`) for the language registry.
 *
 * The fingerprint is the row count with the sum of the rows' revisions: every write raises a
 * revision, so the pair moves on every change, and reading it costs one aggregate over a table
 * of a handful of rows. A database an upgrade has not reached yet has no table, which reads as
 * nothing stored, so such a site keeps behaving as it did.
 *
 * @module domains/i18n/stored-language-reader
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { count, sum } from "drizzle-orm";

import { languagesTables } from "../../schemas/languages";
import { isMissingTable } from "../field-groups/migration/session";

import type { StoredLanguage } from "./config/stored-languages";
import type { StoredLanguageReader } from "./language-registry";

/**
 * The narrow view of the query builder this module uses: `getDrizzle()` is typed `unknown`
 * because the builder differs per driver, so it is narrowed structurally here rather than cast.
 */
interface LanguageSelect<Row> extends Promise<Row[]> {
  from(table: unknown): LanguageSelect<Row>;
}
interface LanguageExecutor {
  select<Row>(projection: Record<string, unknown>): LanguageSelect<Row>;
}

/** What the fingerprint is when the table is not there yet. */
const NO_TABLE = "missing";

export function storedLanguageReader(
  adapter: DrizzleAdapter
): StoredLanguageReader {
  const { dialect } = adapter.getCapabilities();
  const table = languagesTables(dialect).nextlyLanguages;
  const db = (): LanguageExecutor => adapter.getDrizzle();
  const orNothing = async <T>(read: () => Promise<T>, nothing: T) => {
    try {
      return await read();
    } catch (error) {
      if (isMissingTable(error, dialect)) return nothing;
      throw error;
    }
  };
  return {
    fingerprint: () =>
      orNothing(async () => {
        const [row] = await db()
          .select<{ rows: unknown; revisions: unknown }>({
            rows: count(),
            revisions: sum(table.revision),
          })
          .from(table);
        return `${Number(row?.rows ?? 0)}:${Number(row?.revisions ?? 0)}`;
      }, NO_TABLE),
    rows: () =>
      orNothing(
        () =>
          db()
            .select<StoredLanguage>({
              code: table.code,
              label: table.label,
              direction: table.direction,
              fallback: table.fallback,
              position: table.position,
              isDefault: table.isDefault,
              active: table.active,
            })
            .from(table),
        []
      ),
  };
}
