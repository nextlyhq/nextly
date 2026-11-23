/**
 * The saved fields a draft moves into or out of a group, as the save sends them (`hints.moves`):
 * each by its path as saved and its path in the draft. The server copies every entry's value along
 * each move in the migration it writes, so a moved field keeps its values rather than being
 * dropped and added.
 *
 * Read from the draft's pending changes (`pendingChanges`), which place every field by its id, so
 * the moves and the rest of the review are one reading of the draft.
 *
 * @module lib/builder/draft-moves
 */
import { fieldColumnName } from "nextly/config";

import { validationIssues } from "@admin/lib/api/parseApiError";
import type {
  SchemaPreviewResponse,
  SchemaSaveHints,
} from "@admin/services/schemaApi";

import type { PendingChange } from "./pending-changes";
import { classificationOf } from "./rename-answers";
import { reviewDeletesData } from "./review-deletes-data";

/** One saved field the draft moves into or out of a group. */
export interface DraftMove {
  /** The field's id in the draft, so a refusal of its move is shown at its row. */
  fieldId: string;
  /** What the field is called, for the sentence that names it. */
  label: string;
  /** Its path as saved: the names of the fields holding it, then its own. */
  from: string[];
  /** Its path in the draft. */
  to: string[];
}

/**
 * The moves a draft's pending changes make, and the fields moved in the same draft that renames or
 * retypes them (`withOtherChange`), which the server refuses as one save: those are not sent as
 * moves, and the save asks for them to be saved apart.
 */
export function draftMovesOf(changes: readonly PendingChange[]): {
  moves: DraftMove[];
  withOtherChange: string[];
} {
  const otherwiseChanged = new Set(
    changes
      .filter(c => c.kind === "renamed" || c.kind === "typeChanged")
      .map(c => c.fieldId)
  );
  const moves: DraftMove[] = [];
  const withOtherChange: string[] = [];
  for (const change of changes) {
    if (change.kind !== "moved") continue;
    if (change.movedFrom === undefined || change.movedTo === undefined) {
      continue;
    }
    const label = change.label || change.name;
    if (otherwiseChanged.has(change.fieldId)) {
      withOtherChange.push(label);
      continue;
    }
    moves.push({
      fieldId: change.fieldId,
      label,
      from: change.movedFrom,
      to: change.movedTo,
    });
  }
  return { moves, withOtherChange };
}

/** The refusal of a save that moves a field and renames or retypes it too. */
export function moveWithOtherChangeRefusal(labels: readonly string[]): string {
  return `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} moved and also renamed or retyped. Save the move and the other change separately, so the move keeps every value.`;
}

/** What a preview and an apply send of the moves: none, where the draft moves nothing. */
export function movesHints(
  moves: readonly DraftMove[]
): SchemaSaveHints | undefined {
  return moves.length === 0
    ? undefined
    : { moves: moves.map(move => ({ from: move.from, to: move.to })) };
}

/** A path as the review names it: `meta.subtitle`. */
export function movePath(path: readonly string[]): string {
  return path.join(".");
}

/** The code the server's refusal of a move carries, at the path the field moves to. */
const MOVE_REFUSED = "FIELD_MOVE_REFUSED";

/**
 * The server's refusals of a save's moves, by the moved field's id, each with its message as the
 * server wrote it: a refusal names its move by the path the field moves to. One that names no move
 * of the draft marks no field; the save's toast still carries every message.
 */
export function refusedMovesOf(
  error: unknown,
  moves: readonly DraftMove[]
): ReadonlyMap<string, string> {
  const fieldAt = new Map(moves.map(move => [movePath(move.to), move.fieldId]));
  const refused = new Map<string, string>();
  for (const issue of validationIssues(error)) {
    if (issue.code !== MOVE_REFUSED || issue.message === undefined) continue;
    const fieldId =
      issue.path === undefined ? undefined : fieldAt.get(issue.path);
    if (fieldId !== undefined && !refused.has(fieldId)) {
      refused.set(fieldId, issue.message);
    }
  }
  return refused;
}

/**
 * The preview as the review shows it once the moves are the save's: a field moved off the top
 * level is not a removed column, and one moved onto it is not an added one. Its values move with
 * it, in the migration the save writes. A save with moves has changes to apply even where no column
 * changes (a move between two groups).
 */
export function previewWithMoves(
  preview: SchemaPreviewResponse,
  moves: readonly DraftMove[]
): SchemaPreviewResponse {
  if (moves.length === 0) return preview;
  const columnOf = (path: readonly string[]) =>
    path.length === 1 ? fieldColumnName(path[0] ?? "") : undefined;
  const leftColumns = new Set(moves.map(move => columnOf(move.from)));
  const arrivedColumns = new Set(moves.map(move => columnOf(move.to)));
  const changes = {
    ...preview.changes,
    removed: preview.changes.removed.filter(
      row => !leftColumns.has(fieldColumnName(row.name))
    ),
    added: preview.changes.added.filter(
      row => !arrivedColumns.has(fieldColumnName(row.name))
    ),
  };
  const interactiveFields = preview.interactiveFields.filter(
    field =>
      !(
        field.reason === "new_required_no_default" &&
        arrivedColumns.has(fieldColumnName(field.name))
      )
  );
  const deletesData = reviewDeletesData(changes);
  // A pair from a moved field's old column, or onto its new one, is the move's, not a rename.
  const renamed = (preview.renamed ?? []).filter(
    c => !leftColumns.has(c.from) && !arrivedColumns.has(c.to)
  );
  return {
    ...preview,
    hasChanges: true,
    changes,
    renamed,
    interactiveFields,
    hasDestructiveChanges: preview.hasDestructiveChanges && deletesData,
    // The preview asks about the drop of each moved field's old column, which is the move's to
    // answer: the save still asks only while a prompt, a removal, a change asking for an answer or
    // a rename pair is left.
    classification: classificationOf(
      preview.classification,
      deletesData,
      interactiveFields.length > 0 ||
        changes.removed.length > 0 ||
        changes.changed.some(c => c.classification === "interactive") ||
        renamed.length > 0
    ),
  };
}
