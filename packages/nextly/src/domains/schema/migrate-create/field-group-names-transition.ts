/**
 * Which field-group names a project's migration history is on, and the one step that moves it.
 *
 * A history records its naming in each snapshot (`fieldGroupStorage`, read by
 * `snapshotFieldGroupNaming`). Every file `migrate:create` writes stays on the newest snapshot's
 * naming, because a diff between two namings plans to drop every `comp_` table and create its
 * `fg_` twin: the data would be lost to a rename nobody asked for. The only way across is the
 * explicit transition, `nextly migrate:create --field-group-names=current`, which writes a file
 * with no statement whose snapshot is the newest one under the current names. The storage itself
 * moves through `nextly migrate:field-groups`, never inside `nextly migrate`.
 *
 * @module domains/schema/migrate-create/field-group-names-transition
 */

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import {
  underNaming,
  type FieldGroupNaming,
} from "../../field-groups/services/field-group-storage-names";
import type {
  ContributedElements,
  NextlySchemaSnapshot,
} from "../pipeline/diff/types";

import { snapshotFieldGroupNaming, type SnapshotFile } from "./snapshot-io";

/** The command that moves a project's history to the current field-group names. */
export const FIELD_GROUP_TRANSITION_COMMAND =
  "nextly migrate:create --field-group-names=current";

/** The command that moves a database's field-group storage to the current names. */
export const FIELD_GROUP_STORAGE_MIGRATION_COMMAND =
  "nextly migrate:field-groups --apply --backup-confirmed";

/** Why a plan across two namings is refused: a sentence every such refusal gives. */
const ACROSS_NAMINGS =
  "Planned across the two, every field-group table would be dropped and created again, and its rows lost.";

/**
 * The naming a run writes its file under: the newest snapshot's, so a history never changes
 * naming by accident. A project with no history yet takes the naming its caller resolved the
 * field groups under, else legacy.
 */
export function historyFieldGroupNaming(
  latest: Pick<SnapshotFile, "fieldGroupStorage"> | null,
  requested: FieldGroupNaming | undefined
): FieldGroupNaming {
  if (latest === null) return requested ?? "legacy";
  return snapshotFieldGroupNaming(latest);
}

/**
 * The naming a `migrate:create` run writes its file under, given the newest snapshot it starts
 * from: refused where the run's field groups were named under the other naming
 * (`refuseNamingAgainstHistory`), and null for a transition with nothing to move
 * (`transitionNeeded`).
 */
export function fieldGroupNamingOfRun(
  latest: { data: Pick<SnapshotFile, "fieldGroupStorage"> } | null | undefined,
  run: { fieldGroupNaming?: FieldGroupNaming; fieldGroupTransition?: boolean }
): FieldGroupNaming | null {
  const history = latest?.data ?? null;
  refuseNamingAgainstHistory(history, run.fieldGroupNaming);
  if (run.fieldGroupTransition === true && !transitionNeeded(history)) {
    return null;
  }
  return historyFieldGroupNaming(history, run.fieldGroupNaming);
}

/**
 * Refuses a run whose field groups were named under a naming the history is not on, before
 * anything is planned. Diffed, every field-group table would read as dropped under one name and
 * created under the other. Names the step that moves the history instead.
 */
export function refuseNamingAgainstHistory(
  latest: Pick<SnapshotFile, "fieldGroupStorage"> | null,
  requested: FieldGroupNaming | undefined
): void {
  if (latest === null || requested === undefined) return;
  const history = snapshotFieldGroupNaming(latest);
  if (requested === history) return;
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      requested === "current"
        ? "This database's field groups are on the current names (dynamic_field_groups, fg_<slug>), and the project's migration history is still on the legacy ones (dynamic_components, comp_<slug>). " +
          `${ACROSS_NAMINGS} Nothing was written. Run \`${FIELD_GROUP_TRANSITION_COMMAND}\` to move the history to the current names first.`
        : "The project's migration history keeps field groups under the current names (dynamic_field_groups, fg_<slug>), and this run named them under the legacy ones (dynamic_components, comp_<slug>). " +
          `${ACROSS_NAMINGS} Nothing was written. Move this database's field groups with \`${FIELD_GROUP_STORAGE_MIGRATION_COMMAND}\`.`,
    logContext: {
      reason: "field-group-naming-differs-from-history",
      history,
      requested,
    },
  });
}

/**
 * Whether a transition run has anything to do: refused with no history to move, and nothing to
 * do (null) when the history is already on the current names.
 */
export function transitionNeeded(
  latest: Pick<SnapshotFile, "fieldGroupStorage"> | null
): boolean {
  if (latest === null) {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage:
        "`--field-group-names=current` moves an existing migration history to the current field-group names, and this project has no migration yet. " +
        "There is no history to move. Nothing was written. Write its first migration with `nextly migrate:create --name <name>`.",
      logContext: { reason: "field-group-transition-without-history" },
    });
  }
  return snapshotFieldGroupNaming(latest) === "legacy";
}

/**
 * Refuses a transition while the configuration has a change to migrate, naming the tables and
 * whether settings or permissions changed too: the transition file does one thing, so a database
 * that applies it learns nothing else from it, and a change hidden in its snapshot would be
 * missing from every later run.
 */
export function refuseChangesToTransition(pending: {
  tables: readonly string[];
  beyondTables: boolean;
}): void {
  if (pending.tables.length === 0 && !pending.beyondTables) return;
  const tables = [...new Set(pending.tables)].sort().map(t => `"${t}"`);
  const what =
    tables.length > 0
      ? `changes to ${tables.join(", ")}${pending.beyondTables ? " and to settings or permissions" : ""}`
      : "changes to settings or permissions";
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `\`--field-group-names=current\` moves the history to the current field-group names, and the config has ${what} to migrate. ` +
      "The move changes nothing else, so a change written into its snapshot would be missing from every database that applies it. " +
      "Nothing was written. Write those first with `nextly migrate:create --name <name>`, then run it again.",
    logContext: {
      reason: "field-group-transition-with-changes",
      tables: [...new Set(pending.tables)].sort(),
    },
  });
}

/**
 * Each field-group table's current name, by its legacy one: the slug's name under the current
 * names (`fg_<slug>` for `comp_<slug>`), and a table under a name of its own kept as it is, as
 * `nextly migrate:field-groups` renames them.
 */
export function currentNamesOf(
  legacyTables: Iterable<string>
): ReadonlyMap<string, string> {
  return new Map(
    [...legacyTables].map(table => [table, underNaming("current", table)])
  );
}

/**
 * `snapshot` as `nextly migrate:field-groups` leaves the database: each field-group table in
 * `renames` (legacy name to current name) under its current name, with its type discriminator
 * under the current column name, and every reference to either moved with it, in its own indexes
 * and keys and in every other table's foreign keys. A table keeps its columns, indexes, keys and
 * checks through a rename, so nothing else changes.
 */
export function snapshotUnderCurrentNames(
  snapshot: NextlySchemaSnapshot,
  renames: ReadonlyMap<string, string>
): NextlySchemaSnapshot {
  return {
    ...snapshot,
    tables: snapshot.tables.map(table => {
      const own = renames.has(table.name);
      const ownColumn = own ? currentTypeColumn : (column: string) => column;
      return {
        ...table,
        name: renames.get(table.name) ?? table.name,
        columns: table.columns.map(column => ({
          ...column,
          name: ownColumn(column.name),
        })),
        ...(table.indexes === undefined
          ? {}
          : {
              indexes: table.indexes.map(index => ({
                ...index,
                columns: index.columns.map(ownColumn),
              })),
            }),
        ...(table.foreignKeys === undefined
          ? {}
          : {
              foreignKeys: table.foreignKeys.map(key => {
                const target = renames.get(key.referencesTable);
                return {
                  ...key,
                  columns: key.columns.map(ownColumn),
                  ...(target === undefined
                    ? {}
                    : {
                        referencesTable: target,
                        referencesColumns:
                          key.referencesColumns.map(currentTypeColumn),
                      }),
                };
              }),
            }),
      };
    }),
  };
}

/** A column name, with the legacy type column under its current name. */
function currentTypeColumn(column: string): string {
  return column === STORAGE_FORMAT.columns.type
    ? MIGRATION_TARGET.columnType
    : column;
}

/** `contributions` keyed by each field-group table's current name. */
export function contributionsUnderCurrentNames(
  contributions: Readonly<Record<string, ContributedElements>>,
  renames: ReadonlyMap<string, string>
): Record<string, ContributedElements> {
  return Object.fromEntries(
    Object.entries(contributions).map(([table, elements]) => [
      renames.get(table) ?? table,
      elements,
    ])
  );
}
