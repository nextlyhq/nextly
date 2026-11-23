/**
 * An entity's moves as its migration file carries them, whichever road writes the file: the
 * Schema Builder's save, which is told its moves, and `migrate:create`, which asks about each
 * candidate. Both plan the moves of one entity from the same facts and hand the generator the
 * same facts back, so the two files cannot differ for one move.
 *
 * @module domains/schema/field-moves/entity-moves
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { planEntityMoves, type EntityMoves } from "./plan-moves";

type PlanArgs = Parameters<typeof planEntityMoves>[0];

/**
 * One entity whose definition moves fields, as either road knows it: what it is, its table and
 * the generator that made it, its fields before and after, the moves, and what else names its
 * fields (its admin settings and stored hooks) or fills its columns first (`filledColumns`).
 */
export type MovingEntity = Pick<
  PlanArgs,
  | "before"
  | "after"
  | "moves"
  | "localized"
  | "renames"
  | "table"
  | "kind"
  | "builtBy"
  | "admin"
  | "hooks"
  | "filledColumns"
> & { slug: string };

/**
 * The entity's moves planned, or the refusal of the first that cannot keep its values, thrown
 * before anything is written (`planEntityMoves`). The media library records a collection's and a
 * Single's uses by the field's path under the entity; a field group's uses are recorded under
 * each entity that uses it, so none are moved with it.
 */
export function planMovingEntity(
  entity: MovingEntity,
  dialect: SupportedDialect
): EntityMoves {
  const { slug, ...plan } = entity;
  return planEntityMoves({
    ...plan,
    dialect,
    ...(entity.kind === "fieldGroup"
      ? {}
      : { mediaUses: { kind: entity.kind, slug } }),
  });
}

/** The facts of an entity's planned moves the generator takes beside their statements. */
export interface MovesFileFacts {
  /** Each column a move drops, named as the move it is in the file's header. */
  valueMoves: { table: string; column: string; reason: string }[];
  /** Each column a move out of a group adds nullable and fills before it is made required. */
  refilledColumns: EntityMoves["refilledColumns"];
  /** The table whose rows the moves change, where they carry any values. */
  valuesMovedIn: string[];
}

/**
 * What the generator takes of `moves` beside their statements. `reasons` names, by column, what a
 * dropped column had that its group does not carry, where the road could read it from the table;
 * a column it has none for is named by its move alone.
 */
export function movesFileFacts(
  moves: EntityMoves,
  table: string,
  reasons: ReadonlyMap<string, string> = new Map()
): MovesFileFacts {
  return {
    valueMoves: moves.movedColumns.map(moved => ({
      table: moved.table,
      column: moved.column,
      reason:
        reasons.get(moved.column) ??
        `moved into the group ${moved.into}; its values are copied there first`,
    })),
    refilledColumns: moves.refilledColumns,
    // A move's statements are its copies: a plan with none changes no rows.
    valuesMovedIn:
      moves.up.first.length + moves.up.last.length > 0 ? [table] : [],
  };
}
