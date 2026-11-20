/**
 * Read the fields a Schema Builder save moves off a preview or apply request body: each moved
 * field's path before the save and its path after, which the Builder knows because the person
 * dragged it. Preview and apply read them the same way, so the review shows what the apply writes.
 *
 * Absent means the save moves nothing. A present value is parsed here, at the boundary, and a
 * malformed one is refused rather than ignored: a move dropped in silence would let the save drop
 * the field's column with every value it holds.
 *
 * @module dispatcher/helpers/request-moves
 */
import { z } from "zod";

import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import type { FieldMoveRequest } from "../../domains/schema/field-moves/check-move";

/** A field's path: its name, under the names of the groups that hold it. */
const fieldPath = z.array(z.string().min(1).max(200)).min(1).max(20);

const requestedMoves = z
  .array(z.object({ from: fieldPath, to: fieldPath }).strict())
  .max(500);

/** The moves a save request carries in `hints.moves`, or none. */
export function readRequestedMoves(body: unknown): readonly FieldMoveRequest[] {
  const hints = (body as { hints?: unknown } | null | undefined)?.hints;
  if (hints === undefined || hints === null) return [];
  const moves = (hints as { moves?: unknown }).moves;
  if (moves === undefined) return [];
  const parsed = requestedMoves.safeParse(moves);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data;
}
