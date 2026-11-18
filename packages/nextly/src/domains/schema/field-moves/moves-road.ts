/**
 * The road a save that moves fields must take. A moved field's values are kept only by the
 * statements its migration file carries (`planEntityMoves`): a push would add and drop columns
 * from the definitions alone and lose them. So a save with moves takes the file, and one that the
 * same reasons would send to the push instead is refused before anything runs, the moves never
 * dropped in silence.
 *
 * Which saves go to the push is the caller's one answer (`PushReason`), the same one that picks
 * the road for every other save, so the refusal narrows as that answer does.
 *
 * @module domains/schema/field-moves/moves-road
 */
import { NextlyError } from "../../../errors/nextly-error";

import type { FieldMoveRequest } from "./check-move";

/**
 * Why a save goes to the push rather than its migration file: a translated entity, every save of
 * which the push applies, or a change whose values only the push carries. Null when it takes the
 * file.
 */
export type PushReason = "translated" | "carries-values" | null;

const MESSAGES = {
  translated: "Fields in a translated collection can't be moved yet.",
  "carries-values":
    "Moving a field keeps its values only through the migration file, and this save also makes a change that needs a direct apply. Save the move on its own.",
  "no-writer":
    "Moving a field keeps its values only through a migration file, and this app writes none for the Schema Builder.",
} as const;

/**
 * Refuses a save's moves when it would not take its migration file: `writes` is whether the app
 * writes one at all, and `pushReason` asked only when there are moves to keep.
 */
export async function refuseMovesOffTheFile(args: {
  moves: readonly FieldMoveRequest[];
  writes: boolean;
  pushReason: () => Promise<PushReason>;
}): Promise<void> {
  // A field moved into or out of a group with no name keeps its path and its column: nothing of
  // it travels, so it needs no file.
  const [first] = args.moves.filter(
    move =>
      move.from.length !== move.to.length ||
      move.from.some((segment, at) => segment !== move.to[at])
  );
  if (first === undefined) return;
  const reason = args.writes ? await args.pushReason() : "no-writer";
  if (reason === null) return;
  throw NextlyError.validation({
    errors: [
      {
        path: first.to.join("."),
        code: "FIELD_MOVE_REFUSED",
        message: MESSAGES[reason],
      },
    ],
    logContext: { reason, moves: args.moves.length },
  });
}
