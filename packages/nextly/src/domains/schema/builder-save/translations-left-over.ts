/**
 * What a Builder save left on a translations table that its snapshots say is gone. A save's own
 * migration files add what that table gains; what it loses is dropped in a step of its own after
 * them, with no file and no ledger row to say it ran. A process killed between the two leaves every
 * file recorded and the registry row naming the field no more, while the column, and every
 * language's values in it, are still there: such a save did not apply whole, whatever its files say.
 *
 * Only what the save drops is asked after, and only by name: the rest of the table is what other
 * checks compare. A column a save adds is made by its files, so a recorded file says it is there.
 *
 * @module domains/schema/builder-save/translations-left-over
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { companionColumnNames } from "../../i18n/runtime/companion-io";
import { toSnakeCase } from "../field-rules";
import type { NextlySchemaSnapshot, TableSpec } from "../pipeline/diff/types";
import { identifierKey } from "../rename-target";

/** A column a save dropped from a translations table, still there. */
export interface LeftOverColumn {
  /** The column after its table, as a message names it. */
  column: string;
  /** Whose values it still holds, in words. */
  holds: string;
}

/**
 * The columns `before` records on each translations table that `target` does not, which the database
 * still has: none where the translations table is gone, or where `target` has the entity's table no
 * more (its delete's own file drops both). `renamed` is the save's renames, by field.
 */
export async function translationsLeftOver(
  adapter: DrizzleAdapter,
  before: NextlySchemaSnapshot,
  target: NextlySchemaSnapshot,
  renamed: ReadonlyArray<{ from: string; to: string }>
): Promise<LeftOverColumn[]> {
  const dialect = adapter.getCapabilities().dialect;
  const key = (name: string) => identifierKey(dialect, name);
  const over: LeftOverColumn[] = [];
  for (const was of before.tables) {
    const now = target.tables.find(table => table.name === was.name);
    if (now === undefined) continue;
    const kept = new Set(translationsColumnsOf(now).map(key));
    const dropped = translationsColumnsOf(was).filter(
      column => !kept.has(key(column))
    );
    if (dropped.length === 0) continue;
    const live = new Set(
      (await companionColumnNames(adapter, was.name)).map(key)
    );
    for (const column of dropped) {
      if (!live.has(key(column))) continue;
      over.push({
        column: `${was.name}_locales.${column}`,
        holds: heldBy(column, now, renamed, key),
      });
    }
  }
  return over;
}

/**
 * The columns a snapshot's table records on its translations table: its translated fields', and the
 * ones its repeaters and groups keep their text per language in, recorded apart from those.
 */
function translationsColumnsOf(table: TableSpec): string[] {
  return [...(table.localizedColumns ?? []), ...(table.overlayColumns ?? [])];
}

/** Whose values `column` still holds, the save's table being `now`. */
function heldBy(
  column: string,
  now: TableSpec,
  renamed: ReadonlyArray<{ from: string; to: string }>,
  key: (name: string) => string
): string {
  const rename = renamed.find(
    each => key(toSnakeCase(each.from)) === key(column)
  );
  if (rename !== undefined) {
    return `the values of the field the save renamed to "${rename.to}"`;
  }
  return now.columns.some(each => key(each.name) === key(column))
    ? `the values of a field that is no longer translated, not yet moved to ${now.name}.${column}`
    : "the values of a field the save removed";
}
