/**
 * What each column a save drops, because its field moved into a group, had that the group's JSON
 * value does not carry, read from the live table before the save runs and said as one sentence per
 * move (`notCarriedSentence`): the line the review shows the person, and the reason the migration
 * file's header gives for dropping the column.
 *
 * The facts are the database's the save was made against. The file may run against another whose
 * column differs; the header records what the person was shown.
 *
 * @module domains/schema/field-moves/moved-column-facts
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import {
  readColumnExtras,
  readForeignKeyColumns,
  readIndexColumns,
  readReceivingDefaults,
} from "../pipeline/live-table-facts";

import { notCarried, notCarriedSentence } from "./not-carried";

/** A column dropped because its field moved into a group, and the group it went to. */
export interface MovedColumn {
  column: string;
  into: string;
}

/**
 * The sentence for each of `moved` on `table`, by column. A column the live table does not have
 * gets none: there is nothing of it to name.
 */
export async function movedColumnSentences(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  moved: readonly MovedColumn[]
): Promise<Map<string, string>> {
  const sentences = new Map<string, string>();
  if (moved.length === 0) return sentences;
  const columns = moved.map(each => each.column);
  const [snapshot, extras, defaults, indexes, foreignKeys] = await Promise.all([
    introspectLiveSnapshot(db, dialect, [table]),
    readColumnExtras(db, dialect, table, columns),
    readReceivingDefaults(db, dialect, table),
    readIndexColumns(db, dialect, table),
    readForeignKeyColumns(db, dialect, table),
  ]);
  const live = snapshot.tables[0]?.columns ?? [];
  for (const { column, into } of moved) {
    const spec = live.find(each => each.name === column);
    if (spec === undefined) continue;
    const extra = extras.get(column);
    // A character set or collation every column added to the table takes unnamed is the table's,
    // not the column's: only one of its own is named.
    const own = (value: string | null | undefined, standard: string | null) =>
      value && value !== standard ? value : null;
    const keys = foreignKeys.get(column);
    const items = notCarried({
      type: spec.type,
      nullable: spec.nullable,
      comment: extra?.comment ?? null,
      charset: own(extra?.charset, defaults.charset),
      collation: own(extra?.collation, defaults.collation),
      indexes: [...indexes]
        .filter(([, covered]) => covered.includes(column))
        .map(([name]) => name),
      // SQLite names no foreign key: one there is named by the column it stands on.
      foreignKey:
        keys === undefined ? null : keys.length > 0 ? keys.join(", ") : column,
    });
    sentences.set(column, notCarriedSentence(column, into, items));
  }
  return sentences;
}
