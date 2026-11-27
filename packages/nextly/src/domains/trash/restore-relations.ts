/**
 * The relations a restore reconciles with what is there now, decided before
 * and checked inside its transaction.
 *
 * - Every row it puts back (the entry's own row, its rows per language, its
 *   field-group rows and theirs) may hold one id in a single relation or
 *   upload column. A target deleted since is put back as nothing, as the
 *   database's `set null` would have left it, rather than refused by the
 *   relation's foreign key on every attempt; the restore names those fields.
 * - What other entities held pointing at the entry is put back only where
 *   the field that held it still exists, under that name, and still points
 *   at this collection: a field renamed, removed or pointed elsewhere since
 *   is not written to by its old name.
 *
 * @module domains/trash/restore-relations
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { STORAGE_FORMAT } from "../../schemas/storage-format";
import type { KeptIncoming, TrashedEntry } from "../../schemas/trash";
import { usesJunctionTable } from "../schema/field-rules";
import { fieldsStoredOnRow } from "../schema/services/field-column-descriptor";

import type { CapturedField } from "./capture-entry";
import { singleRelationTarget } from "./capture-incoming";
import { keptColumn } from "./kept-values";
import { idsPresent, relationTargetsOf } from "./put-back-references";

/** For each table a restore writes, its relation columns and their targets. */
export type RelationColumns = Map<string, Map<string, string>>;

/** A table and its rows per language, as one entity stores its fields. */
function withCompanion(table: string): [string, string] {
  return [table, `${table}${STORAGE_FORMAT.companionSuffix}`];
}

/**
 * The relation columns of the entry's own table and of every field group's
 * table, each with its table of rows per language, from the definitions as
 * they are now.
 */
export function relationColumnsOf(
  collection: { tableName: string; fields: readonly CapturedField[] },
  fieldGroups: readonly {
    tableName: string;
    fields: readonly CapturedField[];
  }[]
): RelationColumns {
  const columns: RelationColumns = new Map();
  const add = (table: string, fields: readonly CapturedField[]) => {
    const targets = relationTargetsOf(fields);
    if (targets.size === 0) return;
    for (const name of withCompanion(table)) columns.set(name, targets);
  };
  add(collection.tableName, collection.fields);
  for (const group of fieldGroups) add(group.tableName, group.fields);
  return columns;
}

/** Every collection the relation columns point at. */
export function targetSlugsOf(columns: RelationColumns): string[] {
  const slugs = new Set<string>();
  for (const targets of columns.values()) {
    for (const slug of targets.values()) slugs.add(slug);
  }
  return [...slugs];
}

/** One id a column holds, as text; undefined for nothing or not one id. */
function idHeld(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return `${value}`;
  return undefined;
}

/** The key of a target id, by its collection. */
function targetKey(slug: string, id: string): string {
  return `${slug}\u0000${id}`;
}

/** The ids the kept rows hold in relation columns, by target collection. */
function targetIdsHeld(
  stored: TrashedEntry,
  columns: RelationColumns
): Map<string, Set<string>> {
  const asked = new Map<string, Set<string>>();
  const ask = (slug: string, id: string) => {
    const ids = asked.get(slug) ?? new Set<string>();
    ids.add(id);
    asked.set(slug, ids);
  };
  for (const kept of stored.tables) {
    const targets = columns.get(kept.table);
    if (targets === undefined) continue;
    for (const row of kept.rows) {
      for (const [field, slug] of targets) {
        const id = idHeld(keptColumn(row, field));
        if (id !== undefined) ask(slug, id);
      }
    }
  }
  return asked;
}

/**
 * The targets the kept rows name that are gone now, each by
 * {@link targetKey}: asked of each target's table in bounded statements,
 * a table this process does not hold reading as holding nothing.
 */
export async function goneTargets(
  tx: TransactionContext,
  stored: TrashedEntry,
  columns: RelationColumns,
  targetTables: ReadonlyMap<string, string | undefined>
): Promise<Set<string>> {
  const asked = targetIdsHeld(stored, columns);
  const gone = new Set<string>();
  for (const [slug, ids] of asked) {
    const table = targetTables.get(slug);
    const present =
      table === undefined
        ? new Set<string>()
        : await idsPresent(tx, table, [...ids]);
    for (const id of ids) if (!present.has(id)) gone.add(targetKey(slug, id));
  }
  return gone;
}

/**
 * Empties, on a row about to be put back, each relation column whose target
 * is gone; answers the fields it emptied.
 */
export function clearGone(
  table: string,
  row: Record<string, unknown>,
  columns: RelationColumns,
  gone: ReadonlySet<string>
): string[] {
  const targets = columns.get(table);
  if (targets === undefined) return [];
  const cleared: string[] = [];
  for (const [field, slug] of targets) {
    const id = idHeld(row[field]);
    if (id !== undefined && gone.has(targetKey(slug, id))) {
      row[field] = null;
      cleared.push(field);
    }
  }
  return cleared;
}

/** The fields of an entity, as its definition is now; undefined where gone. */
export type EntityFieldsOf = (
  kind: "collection" | "single",
  slug: string
) => Promise<readonly CapturedField[] | undefined>;

/**
 * A kept reference by where it is written, the same on every read of one
 * trash record: the decision is made from one read and applied to the read
 * the transaction locks, so it cannot go by the object.
 */
function incomingKey(kept: KeptIncoming): string {
  const column = kept.kind === "links" ? kept.sourceColumn : kept.column;
  return `${kept.kind}\u0000${kept.table}\u0000${column}`;
}

/**
 * Whether each kept reference from another entity still holds: the field
 * that held it is still there, under that name, and still points at the
 * collection `slug` the entry is restored into, the same way it did. Decided
 * before the transaction, from the definitions as they are now; a reference
 * kept before its source was recorded holds as it was kept.
 */
export async function incomingStillHolding(
  incoming: readonly KeptIncoming[],
  slug: string,
  fieldsOf: EntityFieldsOf
): Promise<(kept: KeptIncoming) => boolean> {
  const holding = new Set<string>();
  for (const kept of incoming) {
    if (kept.source === undefined) {
      holding.add(incomingKey(kept));
      continue;
    }
    const fields = await fieldsOf(kept.source.kind, kept.source.slug);
    const field = fieldsStoredOnRow(fields ?? []).find(
      each => each.name === kept.source?.field
    );
    if (field === undefined) continue;
    const points =
      kept.kind === "links"
        ? usesJunctionTable(field) &&
          (field.options as { target?: unknown } | undefined)?.target === slug
        : singleRelationTarget(field) === slug;
    if (points) holding.add(incomingKey(kept));
  }
  return kept => holding.has(incomingKey(kept));
}
