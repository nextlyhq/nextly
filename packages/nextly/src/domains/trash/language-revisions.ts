/**
 * Each language's version counter, last changer and change time of a trashed
 * entry: kept at the delete and put back at the restore, so a client holding
 * an older version of a language is still told it is out of date.
 *
 * A translation table's runtime model does not declare these columns (the
 * same model serves field-group translation tables, which never carry them),
 * so the rows the trash keeps through it lack them. They are read and
 * written through `languageRevisionTable`, the model the counter's own reads
 * and writes go through. A translation table without them (one not yet
 * migrated) keeps and puts back nothing: the read runs under a savepoint.
 *
 * @module domains/trash/language-revisions
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";

import { MIGRATE_STEP_COLUMN_NAMES } from "../../lib/system-columns";
import type { KeptRow } from "../../schemas/trash";
import {
  languageRevisionTable,
  type SupportedDialect,
} from "../schema/services/runtime-schema-generator";

import { tolerantly } from "./capture-incoming";
import { keepRow, keptColumn } from "./kept-values";

/** Ids asked about in one statement. */
const ID_CHUNK = 200;

/** The part of a Drizzle handle a read through the model uses. */
interface SelectsAll {
  select(): {
    from(table: never): {
      where(condition: unknown): PromiseLike<Record<string, unknown>[]>;
    };
  };
}

/** The part of a Drizzle handle a write through the model uses. */
interface UpdatesRows {
  update(table: never): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): PromiseLike<unknown>;
    };
  };
}

/** The model's columns, by name. */
function columnsOf(
  dialect: SupportedDialect,
  table: string
): Record<string, never> {
  return languageRevisionTable(dialect, table) as Record<string, never>;
}

/**
 * The counters, changers and change times of the rows of translation table
 * `table` whose parent is one of `parents`, each with its parent and
 * language; none where the table does not have them.
 */
export async function keepLanguageRevisions(
  tx: TransactionContext,
  dialect: SupportedDialect,
  table: string,
  parents: readonly string[]
): Promise<KeptRow[]> {
  const model = columnsOf(dialect, table);
  const kept: KeptRow[] = [];
  for (let at = 0; at < parents.length; at += ID_CHUNK) {
    const rows =
      (await tolerantly(tx, async () =>
        tx
          .getDrizzle<SelectsAll>()
          .select()
          .from(model as never)
          .where(inArray(model._parent, [...parents.slice(at, at + ID_CHUNK)]))
      )) ?? [];
    kept.push(...rows.map(row => keepRow(row)));
  }
  return kept;
}

/**
 * Writes each kept language's counter, changer and change time back onto its
 * row of `table`, put back just before. A row not put back is not written.
 */
export async function putBackLanguageRevisions(
  tx: TransactionContext,
  dialect: SupportedDialect,
  table: string,
  kept: readonly KeptRow[]
): Promise<void> {
  if (kept.length === 0) return;
  const model = columnsOf(dialect, table);
  for (const row of kept) {
    const values = Object.fromEntries(
      MIGRATE_STEP_COLUMN_NAMES.filter(name => name in row).map(name => [
        name,
        keptColumn(row, name),
      ])
    );
    if (Object.keys(values).length === 0) continue;
    await tolerantly(tx, async () =>
      tx
        .getDrizzle<UpdatesRows>()
        .update(model as never)
        .set(values)
        .where(
          and(
            eq(model._parent, keptColumn(row, "_parent")),
            eq(model._locale, keptColumn(row, "_locale"))
          )
        )
    );
  }
}
