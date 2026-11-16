/**
 * The Builder's own answer to the renames it made.
 *
 * A saved field renamed in the Builder reaches the save under its new name, which the save's
 * preview first sees as one column dropped and another added, and offers as a rename candidate.
 * Left to the schema dialog, that pair could be answered as a drop and an add, losing the field's
 * values. The Builder knows the field was renamed, so it answers the pair as a rename itself, on
 * every table holding the column (its translations table too). A rename the preview does not offer
 * as a pair cannot be kept as one, so the save stops before anything is applied rather than drop
 * the values. A rename whose column stays the same (`metaTitle` to `meta_title`) changes no column,
 * and needs no pair.
 *
 * Columns are compared as the save spells them (`fieldColumnName`), so a camelCase name a plugin
 * declared is matched by the column it became.
 *
 * @module lib/builder/rename-answers
 */
import { fieldColumnName } from "nextly/config";

import type {
  SchemaPreviewRenameCandidate,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";

import type { PendingChange } from "./pending-changes";
import { reviewDeletesData } from "./review-deletes-data";

/** A saved field the draft renamed. */
export interface DraftRename {
  /** What the field is called, for the sentence that names it. */
  label: string;
  /** Its name as saved. */
  previousName: string;
  /** Its name in the draft. */
  name: string;
}

/** The renames among a draft's pending changes: every saved field whose name changed. */
export function draftRenamesOf(
  changes: readonly PendingChange[]
): DraftRename[] {
  return changes
    .filter(change => change.kind === "renamed")
    .map(change => ({
      label: change.label || change.name,
      previousName: change.previousName ?? "",
      name: change.name,
    }));
}

/**
 * The preview's candidates the Builder answers as renames, and the first rename that has none.
 * A rename whose column stays the same is not looked for.
 */
export function renameAnswers(
  renames: readonly DraftRename[],
  candidates: readonly SchemaPreviewRenameCandidate[]
): {
  decided: SchemaPreviewRenameCandidate[];
  missing: DraftRename | null;
} {
  const decided: SchemaPreviewRenameCandidate[] = [];
  for (const rename of renames) {
    const from = fieldColumnName(rename.previousName);
    const to = fieldColumnName(rename.name);
    if (from === to) continue;
    const pairs = candidates.filter(c => c.from === from && c.to === to);
    if (pairs.length === 0) return { decided, missing: rename };
    decided.push(...pairs);
  }
  return { decided, missing: null };
}

/**
 * `resolutions` with every decided pair answered as a rename. For a column a decided pair renames,
 * the schema dialog's answers are overruled: the decided pair is the rename, and any other pair
 * from that column is a drop and an add. A decided pair the dialog gave no answer for is added.
 */
export function withDecidedRenames(
  resolutions: readonly SchemaRenameResolution[],
  decided: readonly SchemaPreviewRenameCandidate[]
): SchemaRenameResolution[] {
  const drop = (table: string, from: string) => `${table}::${from}`;
  const pair = (table: string, from: string, to: string) =>
    `${table}::${from}::${to}`;
  const decidedDrops = new Set(decided.map(c => drop(c.table, c.from)));
  const decidedPairs = new Set(decided.map(c => pair(c.table, c.from, c.to)));
  const answered = resolutions.map(
    (each): SchemaRenameResolution =>
      decidedDrops.has(drop(each.tableName, each.fromColumn))
        ? {
            ...each,
            choice: decidedPairs.has(
              pair(each.tableName, each.fromColumn, each.toColumn)
            )
              ? "rename"
              : "drop_and_add",
          }
        : each
  );
  const unanswered = decided.filter(
    c =>
      !answered.some(
        each =>
          pair(each.tableName, each.fromColumn, each.toColumn) ===
          pair(c.table, c.from, c.to)
      )
  );
  return [
    ...answered,
    ...unanswered.map(
      (c): SchemaRenameResolution => ({
        tableName: c.table,
        fromColumn: c.from,
        toColumn: c.to,
        choice: "rename",
      })
    ),
  ];
}

/** Why a save stops for a rename the preview does not offer as one, naming the field. */
export function renameNotOffered(rename: DraftRename): string {
  return (
    `${rename.label} was renamed from ${rename.previousName} to ${rename.name}, but this save ` +
    "does not see the two as one field, so saving would drop its values. Save the rename on its " +
    "own, before other changes to the field."
  );
}

/**
 * `preview` as the schema dialog shows it once the Builder's renames are decided: a decided rename
 * is no field removed beside one added, and no pair left to choose for, so its columns leave those
 * lists, and the save is called destructive only when something else still deletes values.
 */
export function previewWithDecidedRenames(
  preview: SchemaPreviewResponse,
  decided: readonly SchemaPreviewRenameCandidate[]
): SchemaPreviewResponse {
  if (decided.length === 0) return preview;
  const fromColumns = new Set(decided.map(c => c.from));
  const toColumns = new Set(decided.map(c => c.to));
  const decidedDrops = new Set(decided.map(c => `${c.table}::${c.from}`));
  const changes = {
    ...preview.changes,
    removed: preview.changes.removed.filter(
      field => !fromColumns.has(fieldColumnName(field.name))
    ),
    added: preview.changes.added.filter(
      field => !toColumns.has(fieldColumnName(field.name))
    ),
  };
  const deletesData = reviewDeletesData(changes);
  return {
    ...preview,
    changes,
    renamed: (preview.renamed ?? []).filter(
      c => !decidedDrops.has(`${c.table}::${c.from}`)
    ),
    hasDestructiveChanges: preview.hasDestructiveChanges && deletesData,
    classification:
      preview.classification === "destructive" && !deletesData
        ? "safe"
        : preview.classification,
  };
}
