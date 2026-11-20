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

/** Whether `operations` add or delete a column of `table`: the change a move would read as. */
function changesColumnsOf(
  operations: readonly Operation[],
  table: string
): boolean {
  return operations.some(
    op =>
      (op.type === "add_column" || op.type === "drop_column") &&
      op.tableName === table
  );
}

/** What a run's moves are planned from, and how it asks and warns. */
interface CodeMovesRun {
  entities: readonly {
    kind: SettingsEntityKind;
    entity: MinimalConfigEntity;
  }[];
  previous: EntitySettingsRecord | undefined;
  previousTables: ReadonlySet<string>;
  operations: readonly Operation[];
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
 * delete and add it stays. An entity the latest snapshot records no fields for, though its table
 * stood then, cannot show its moves, and is named as such where its columns change.
 */
async function acceptedMovesOf(
  run: CodeMovesRun,
  kind: SettingsEntityKind,
  entity: MinimalConfigEntity
): Promise<AcceptedMoves | undefined> {
  const before = recordedFields(run.previous, kind, entity.slug);
  if (before === undefined) {
    if (
      run.previousTables.has(entity.tableName) &&
      changesColumnsOf(run.operations, entity.tableName)
    ) {
      run.warn(
        `Moves can't be detected for "${entity.slug}": the latest snapshot does not record its fields, so a field moved into or out of a group is written as a delete at its old place and an empty field at its new one. Check the migration before you run it.`
      );
    }
    return undefined;
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
 * The statements that stop a run over a working draft keeping a moved field at its old place
 * (`workingDraftsStop`). A field group's values sit in the drafts of every entity that uses it,
 * under paths a run cannot know offline, so none is written for one: the run says so instead.
 */
function draftsStopsOf(
  run: CodeMovesRun,
  kind: SettingsEntityKind,
  slug: string,
  moves: AcceptedMoves["moves"]
): string[] {
  if (kind === "fieldGroup") {
    run.warn(
      `Working drafts are not checked for field group "${slug}": a draft that holds ${moves.map(m => placeOf(m.from)).join(", ")} keeps it where it was, and publishing it after this migration drops that change. Publish or discard such drafts before you run the migration.`
    );
    return [];
  }
  return moves.flatMap(move =>
    workingDraftsStop(run.dialect, { kind, slug }, move.from)
  );
}

/**
 * Finds, asks about and plans every entity's moves since the latest snapshot. `decide` answers the
 * candidates (the terminal question, or `--accept-moves`); `interactive` says whether a person
 * answered, so a candidate declined for want of a terminal is named with how to carry it. A move
 * the planner refuses is refused here, before anything is written.
 */
export async function planCodeMoves(run: CodeMovesRun): Promise<CodeMovesPlan> {
  // The drafts stops of every entity lead the file, before any entity's values move.
  const stops: string[] = [];
  const planned: { moves: EntityMoves; table: string }[] = [];
  for (const { kind, entity } of run.entities) {
    const accepted = await acceptedMovesOf(run, kind, entity);
    if (accepted === undefined) continue;
    stops.push(...draftsStopsOf(run, kind, entity.slug, accepted.moves));
    planned.push({
      table: entity.tableName,
      moves: planMovingEntity(
        {
          kind,
          slug: entity.slug,
          ...accepted,
          // Where the values are stored, not whether the entity is translated.
          localized: storesPerLanguage(entity),
          renames: [],
          table: entity.tableName,
          builtBy: run.originOf(entity, kind),
        },
        run.dialect
      ),
    });
  }
  const facts = planned.map(({ moves, table }) => movesFileFacts(moves, table));
  const all = planned.map(({ moves }) => moves);
  return {
    appended: {
      up: {
        first: [...stops, ...all.flatMap(m => m.up.first)],
        last: all.flatMap(m => m.up.last),
      },
      down: {
        first: all.flatMap(m => m.down.first),
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
