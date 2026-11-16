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

/** A rename the save cannot keep as one, and why: the pair is not offered, or it changes values. */
export interface RenameNotKept {
  rename: DraftRename;
  /** The pair is offered, but the column's values would not come through it unchanged. */
  valuesChange: boolean;
  /** The preview's reason the values change, when it gives one. */
  reason?: string;
}

/**
 * The preview's candidates the Builder answers as renames, and the first rename it cannot keep as
 * one: a pair the preview does not offer, or one whose values would not come through unchanged
 * (types that do not fit, or a conversion that rewrites them). A rename whose column stays the
 * same is not looked for.
 */
export function renameAnswers(
  renames: readonly DraftRename[],
  candidates: readonly SchemaPreviewRenameCandidate[]
): {
  decided: SchemaPreviewRenameCandidate[];
  missing: RenameNotKept | null;
} {
  const decided: SchemaPreviewRenameCandidate[] = [];
  for (const rename of renames) {
    const from = fieldColumnName(rename.previousName);
    const to = fieldColumnName(rename.name);
    if (from === to) continue;
    const pairs = candidates.filter(c => c.from === from && c.to === to);
    if (pairs.length === 0) {
      return { decided, missing: { rename, valuesChange: false } };
    }
    const changing = pairs.find(c => !c.typesCompatible || !c.preservesValues);
    if (changing) {
      return {
        decided,
        missing: {
          rename,
          valuesChange: true,
          reason: changing.valueChangeReason,
        },
      };
    }
    decided.push(...pairs);
  }
  return { decided, missing: null };
}

/** Whether `c` shares a decided pair's dropped column or its new column, on the same table. */
function competesWithDecided(
  c: SchemaPreviewRenameCandidate,
  decided: readonly SchemaPreviewRenameCandidate[]
): boolean {
  return decided.some(
    d => d.table === c.table && (d.from === c.from || d.to === c.to)
  );
}

/**
 * The rename answers the save is sent: every decided pair a rename, and every other pair from a
 * decided pair's dropped column or onto its new column a drop and an add, whatever the schema
 * dialog answered. A pair onto the new column answered as a rename could take that column first and
 * leave the Builder's rename a drop. The dialog's answers for every other pair stand.
 */
export function withDecidedRenames(
  resolutions: readonly SchemaRenameResolution[],
  decided: readonly SchemaPreviewRenameCandidate[],
  candidates: readonly SchemaPreviewRenameCandidate[]
): SchemaRenameResolution[] {
  const key = (table: string, from: string, to: string) =>
    `${table}::${from}::${to}`;
  const decidedKeys = new Set(decided.map(c => key(c.table, c.from, c.to)));
  const answers = new Map<string, SchemaRenameResolution>(
    resolutions.map(each => [
      key(each.tableName, each.fromColumn, each.toColumn),
      each,
    ])
  );
  for (const c of [...candidates, ...decided]) {
    const k = key(c.table, c.from, c.to);
    if (decidedKeys.has(k) || competesWithDecided(c, decided)) {
      answers.set(k, {
        tableName: c.table,
        fromColumn: c.from,
        toColumn: c.to,
        choice: decidedKeys.has(k) ? "rename" : "drop_and_add",
      });
    }
  }
  return [...answers.values()];
}

/** Why a save stops for a rename it cannot keep as one, naming the field. */
export function renameNotOffered(notKept: RenameNotKept): string {
  const { rename } = notKept;
  const renamed = `${rename.label} was renamed from ${rename.previousName} to ${rename.name}`;
  const why = notKept.valuesChange
    ? `, but this save would not carry its values over unchanged${notKept.reason ? ` (${notKept.reason})` : ""}`
    : ", but this save does not see the two as one field, so saving would drop its values";
  return `${renamed}${why}. Save the rename on its own, before other changes to the field.`;
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
    // A pair from a decided pair's dropped column, or onto its new column, is the Builder's to
    // answer, not the person's.
    renamed: (preview.renamed ?? []).filter(
      c => !competesWithDecided(c, decided)
    ),
    hasDestructiveChanges: preview.hasDestructiveChanges && deletesData,
    classification:
      preview.classification === "destructive" && !deletesData
        ? "safe"
        : preview.classification,
  };
}
