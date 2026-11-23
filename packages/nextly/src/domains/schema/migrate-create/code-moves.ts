/**
 * Fields moved into or out of a group in code, as `migrate:create` writes them. Code says only where
 * each field is now, so the moves are read from the latest snapshot's record of each entity's
 * declaration and the config's (`moveCandidates`), and each is asked about (`promptMoves`). An
 * accepted move is planned as the Schema Builder's save plans one (`planMovingEntity`), so its
 * values are copied to the new place before the old place goes, and back on the way down.
 *
 * A declined move, or one the record cannot show, stays what the table diff makes of it: a delete
 * at the old place and an empty field at the new one.
 *
 * @module domains/schema/migrate-create/code-moves
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { movesFileFacts, planMovingEntity } from "../field-moves/entity-moves";
import { moveCandidates } from "../field-moves/move-candidates";
import { workingDraftsStop } from "../field-moves/move-statements";
import type { EntityMoves } from "../field-moves/plan-moves";
import type { Operation } from "../pipeline/diff/types";
import type { ColumnOrigin } from "../services/field-column-descriptor";

import {
  recordedSettingsOf,
  type EntitySettingsRecord,
  type SettingsEntityKind,
} from "./entity-settings";
import type { AddedStatements, MinimalConfigEntity } from "./generate";
import { placeOf, type MoveCandidate, type MoveDecision } from "./prompt-moves";

/** What the accepted moves add to the migration, in the generator's own terms. */
export interface CodeMovesPlan {
  appended: { up: AddedStatements; down: AddedStatements };
  valueMoves: { table: string; column: string; reason: string }[];
  refilledColumns: { table: string; column: string }[];
  valuesMovedIn: string[];
}

export const NO_CODE_MOVES: CodeMovesPlan = {
  appended: { up: { first: [], last: [] }, down: { first: [], last: [] } },
  valueMoves: [],
  refilledColumns: [],
  valuesMovedIn: [],
};

/** The fields a recorded declaration lists, or none where it lists none. */
function recordedFields(
  record: EntitySettingsRecord | undefined,
  kind: SettingsEntityKind,
  slug: string
): FieldDefinition[] | undefined {
  const fields = recordedSettingsOf(record, kind, slug)?.settings.fields;
  return Array.isArray(fields) ? (fields as FieldDefinition[]) : undefined;
}

/**
 * The admin settings of the config's declaration that name top-level fields, as the planner
 * refuses a move under them (`refuseNamedByAdmin`), the Schema Builder's save included.
 */
function adminReferencesOf(entity: MinimalConfigEntity): {
  useAsTitle?: string;
  defaultColumns?: string[];
} {
  const admin = entity.settings?.settings.admin;
  if (admin === null || typeof admin !== "object" || Array.isArray(admin)) {
    return {};
  }
  const { useAsTitle, defaultColumns } = admin as Record<string, unknown>;
  return {
    ...(typeof useAsTitle === "string" ? { useAsTitle } : {}),
    ...(Array.isArray(defaultColumns)
      ? {
          defaultColumns: defaultColumns.filter(
            (name): name is string => typeof name === "string"
          ),
        }
      : {}),
  };
}

/** What a run's moves are planned from, and how it asks and warns. */
interface CodeMovesRun {
  entities: readonly {
    kind: SettingsEntityKind;
    entity: MinimalConfigEntity;
  }[];
  previous: EntitySettingsRecord | undefined;
  previousTables: ReadonlySet<string>;
  dialect: SupportedDialect;
  originOf: (
    entity: MinimalConfigEntity,
    kind: SettingsEntityKind
  ) => ColumnOrigin;
  decide: (candidates: MoveCandidate[]) => Promise<MoveDecision[]>;
  interactive: boolean;
  warn: (message: string) => void;
}

/** One entity's accepted moves, with its fields on both sides. */
interface AcceptedMoves {
  before: FieldDefinition[];
  after: FieldDefinition[];
  moves: { from: readonly string[]; to: readonly string[] }[];
}

/**
 * The moves of `entity` the run accepts, asked about one by one, each declined one named as the
 * delete and add it stays; `unrecorded` for an entity whose table stood at the latest snapshot,
 * which records no fields for it, so its moves cannot be shown.
 */
async function acceptedMovesOf(
  run: CodeMovesRun,
  kind: SettingsEntityKind,
  entity: MinimalConfigEntity
): Promise<AcceptedMoves | "unrecorded" | undefined> {
  const before = recordedFields(run.previous, kind, entity.slug);
  if (before === undefined) {
    return run.previousTables.has(entity.tableName) ? "unrecorded" : undefined;
  }
  const after = entity.fields as unknown as FieldDefinition[];
  const candidates = moveCandidates(before, after).map(
    (move): MoveCandidate => ({ slug: entity.slug, ...move })
  );
  if (candidates.length === 0) return undefined;
  const decisions = await run.decide(candidates);
  // Without a terminal, how to carry a declined one; at one, the person declined it.
  const how = run.interactive
    ? ""
    : " If it is a move, run nextly migrate:create at a terminal and answer yes, or pass --accept-moves.";
  for (const { candidate } of decisions.filter(d => !d.accepted)) {
    const from = placeOf(candidate.from);
    const to = placeOf(candidate.to);
    run.warn(
      `${entity.slug}: ${from} → ${to} is not carried as a move. The migration deletes ${from} with its values and adds ${to} empty.${how}`
    );
  }
  const moves = decisions
    .filter(decision => decision.accepted)
    .map(({ candidate }) => ({ from: candidate.from, to: candidate.to }));
  return moves.length === 0 ? undefined : { before, after, moves };
}

/**
 * The statements that stop a run over a working draft keeping a moved field where the run moves it
 * away from (`workingDraftsStop`): its old place for the UP, its new one for the DOWN, which moves
 * it back. A field group's values sit in the drafts of every entity that uses it, under paths a
 * run cannot know offline, so none is written for one: the run says so instead.
 */
function draftsStopsOf(
  run: CodeMovesRun,
  kind: SettingsEntityKind,
  slug: string,
  moves: AcceptedMoves["moves"]
): { up: string[]; down: string[] } {
  if (kind === "fieldGroup") {
    run.warn(
      `Working drafts are not checked for field group "${slug}": a draft that holds ${moves.map(m => placeOf(m.from)).join(", ")} keeps it where it was, and publishing it after this migration drops that change. Publish or discard such drafts before you run the migration, and before you roll it back.`
    );
    return { up: [], down: [] };
  }
  const stop = (at: readonly string[]) =>
    workingDraftsStop(run.dialect, { kind, slug }, at);
  return {
    up: moves.flatMap(move => stop(move.from)),
    down: moves.flatMap(move => stop(move.to)),
  };
}

/**
 * Refuses moves on an entity whose table this run renames (a new `dbName`): its table stood under
 * another name at the latest snapshot, and the moves' statements, which run before the table's
 * own change, would name a table not made yet.
 */
function refuseMovesIntoRenamedTable(
  run: CodeMovesRun,
  entity: MinimalConfigEntity,
  moves: AcceptedMoves["moves"]
): void {
  if (run.previousTables.has(entity.tableName)) return;
  const [first] = moves;
  const message = `${entity.slug}'s table becomes ${entity.tableName} in this migration, so ${placeOf(first.from)} → ${placeOf(first.to)} cannot be carried with it: change the table's name and move fields in migrations of their own.${INSTEAD}`;
  throw NextlyError.validation({
    errors: [{ path: placeOf(first.to), code: "FIELD_MOVE_REFUSED", message }],
    logContext: { slug: entity.slug, table: entity.tableName },
  });
}

/** What a run that cannot carry a move can do instead, added to the planner's refusal. */
const INSTEAD =
  " To write it as a delete at the old place and an empty field at the new one instead, which loses its values, answer no when nextly migrate:create asks, or leave out --accept-moves.";

/**
 * The entity's moves planned (`planMovingEntity`), or the planner's refusal of the first that
 * cannot keep its values, saying what this road can do instead: decline the move.
 */
function plannedOrRefused(
  entity: Parameters<typeof planMovingEntity>[0],
  dialect: SupportedDialect
): EntityMoves {
  try {
    return planMovingEntity(entity, dialect);
  } catch (error) {
    const errors = (
      error instanceof NextlyError
        ? (error.publicData as { errors?: unknown } | undefined)?.errors
        : undefined
    ) as ValidationPublicData["errors"] | undefined;
    if (!errors?.some(entry => entry.code === "FIELD_MOVE_REFUSED"))
      throw error;
    throw NextlyError.validation({
      errors: errors.map(entry =>
        entry.code === "FIELD_MOVE_REFUSED"
          ? { ...entry, message: `${entry.message}${INSTEAD}` }
          : entry
      ),
      ...(error instanceof Error ? { cause: error } : {}),
      logContext: { slug: entity.slug, road: "migrate:create" },
    });
  }
}

/**
 * Finds, asks about and plans every entity's moves since the latest snapshot. `decide` answers the
 * candidates (the terminal question, or `--accept-moves`); `interactive` says whether a person
 * answered, so a candidate declined for want of a terminal is named with how to carry it. A move
 * the planner refuses is refused here, before anything is written.
 */
export async function planCodeMoves(run: CodeMovesRun): Promise<CodeMovesPlan> {
  // The drafts stops of every entity lead each side of the file, before any entity's values move.
  const stops: { up: string[]; down: string[] } = { up: [], down: [] };
  const planned: { moves: EntityMoves; table: string }[] = [];
  const unrecorded: string[] = [];
  for (const { kind, entity } of run.entities) {
    const accepted = await acceptedMovesOf(run, kind, entity);
    if (accepted === "unrecorded") unrecorded.push(entity.slug);
    if (accepted === undefined || accepted === "unrecorded") continue;
    refuseMovesIntoRenamedTable(run, entity, accepted.moves);
    const drafts = draftsStopsOf(run, kind, entity.slug, accepted.moves);
    stops.up.push(...drafts.up);
    stops.down.push(...drafts.down);
    planned.push({
      table: entity.tableName,
      moves: plannedOrRefused(
        {
          kind,
          slug: entity.slug,
          ...accepted,
          // Where the values are stored, not whether the entity is translated.
          localized: storesPerLanguage(entity),
          renames: [],
          table: entity.tableName,
          builtBy: run.originOf(entity, kind),
          // The settings the config's declaration keeps, which may name a field it moves.
          admin: adminReferencesOf(entity),
        },
        run.dialect
      ),
    });
  }
  // Named whatever the diff shows: a field moved between two groups changes their JSON alone, no
  // column, and the record a later snapshot keeps lets the next run show its moves.
  if (unrecorded.length > 0) {
    const names = unrecorded.map(slug => `"${slug}"`).join(", ");
    const their = unrecorded.length === 1 ? "its" : "their";
    run.warn(
      `Moves can't be detected for ${names}: the latest snapshot does not record ${their} fields, so a field moved into, out of or between groups is written as a delete at its old place and an empty field at its new one, whose values are not carried. Check the migration before you run it.`
    );
  }
  const facts = planned.map(({ moves, table }) => movesFileFacts(moves, table));
  const all = planned.map(({ moves }) => moves);
  return {
    appended: {
      up: {
        first: [...stops.up, ...all.flatMap(m => m.up.first)],
        last: all.flatMap(m => m.up.last),
      },
      down: {
        first: [...stops.down, ...all.flatMap(m => m.down.first)],
        last: all.flatMap(m => m.down.last),
      },
    },
    valueMoves: facts.flatMap(f => f.valueMoves),
    refilledColumns: facts.flatMap(f => f.refilledColumns),
    valuesMovedIn: facts.flatMap(f => f.valuesMovedIn),
  };
}

/**
 * The operations the rename detector judges, without the columns the accepted moves drop or add:
 * a moved column's values travel with the move, so pairing it with another column as a rename
 * would carry them twice, or into the wrong field.
 */
export function withoutMovedColumns(
  operations: readonly Operation[],
  plan: Pick<CodeMovesPlan, "valueMoves" | "refilledColumns">
): Operation[] {
  const key = (table: string, column: string) => `${table}\u0000${column}`;
  const dropped = new Set(plan.valueMoves.map(m => key(m.table, m.column)));
  const added = new Set(plan.refilledColumns.map(c => key(c.table, c.column)));
  return operations.filter(op =>
    op.type === "drop_column"
      ? !dropped.has(key(op.tableName, op.columnName))
      : op.type === "add_column"
        ? !added.has(key(op.tableName, op.column.name))
        : true
  );
}
