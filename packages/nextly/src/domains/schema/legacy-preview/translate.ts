// Translates pipeline preview output (Operation[] + ClassifierEvent[]
// + RenameCandidate[]) into the legacy SchemaPreviewResult shape that
// the admin SchemaChangeDialog renders.
//
// F8 PR 3 introduced this file to keep the public framework's
// `/api/collections/schema/{slug}/preview` endpoint backwards-
// compatible while migrating internals onto the new pipeline. The
// translator is documented compatibility code:
//   - Single source of truth for preview data is now the pipeline
//     (Phase A diff + Phase B classifier in `pipeline/preview.ts`).
//   - This translator emits the legacy 3-option resolution set
//     (provide_default / mark_nullable / cancel). The pipeline's
//     4th option `delete_nonconforming` is intentionally omitted
//     here — the legacy dialog has no UX for it.
//   - The 4th option is reachable via the terminal (clack) prompt.
//   - Task 22 (`tasks/nextly-dev-tasks/22-modernize-admin-schema-dialog.md`)
//     is the explicit retirement plan for this translator: rewrite
//     the admin dialog to consume ClassifierEvent[] directly, deprecate
//     this v1 translator + endpoint with a sunset window, then delete.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "../pipeline/classifier/count-helpers";
import type { PipelinePreviewResult } from "../pipeline/preview";
import { computeFieldDiff } from "../services/field-diff";
import type {
  AddedField,
  ChangedField,
  InteractiveField,
  RemovedField,
  SchemaPreviewResult,
} from "../services/schema-change-types";

export interface TranslateContext {
  tableName: string;
  currentFields: FieldDefinition[];
  newFields: FieldDefinition[];
  db: unknown;
  dialect: SupportedDialect;
}

/**
 * Translate pipeline preview output to legacy `SchemaPreviewResult`.
 *
 * What this does:
 *   1. Run `computeFieldDiff` on user-provided fields to produce the
 *      legacy `changes.{added,removed,changed,unchanged}` shape.
 *   2. Query non-null row counts on each removed field (best-effort —
 *      errors return 0). Pre-pipeline `SchemaChangeService.preview`
 *      did the same with `COUNT(*) WHERE col IS NOT NULL`; we compute
 *      it as `countRows - countNulls` to reuse pipeline helpers.
 *   3. Map each ClassifierEvent to either an InteractiveField (3-option
 *      legacy shape) or a warning string. type_change events become
 *      warnings only — the legacy dialog has no per-field force-cast UX.
 *   4. Compute classification per legacy rules: most-severe-wins across
 *      all field-level classifications, plus the pipeline's level.
 *   5. Default `ddlPreview` to []. Legacy did a best-effort dry-run
 *      pushSchema; in PR 3 we drop that side-channel because it
 *      coupled preview to drizzle-kit timing. No admin UI consumer
 *      reads `ddlPreview` today.
 */
export async function translatePipelinePreviewToLegacy(
  preview: PipelinePreviewResult,
  context: TranslateContext
): Promise<SchemaPreviewResult> {
  const { tableName, currentFields, newFields, db, dialect } = context;

  // Step 1: legacy field-level diff (pure function).
  const diff = computeFieldDiff(currentFields, newFields);

  if (!diff.hasChanges) {
    return {
      hasChanges: false,
      hasDestructiveChanges: false,
      classification: "safe",
      changes: {
        added: [],
        removed: [],
        changed: [],
        unchanged: diff.unchanged,
      },
      warnings: [],
      interactiveFields: [],
      ddlPreview: [],
    };
  }

  // Step 2: row counts on removed fields. Best-effort — never fails the
  // translation. `countRows - countNulls` mirrors legacy
  // `COUNT(*) WHERE col IS NOT NULL` semantics with two existing helpers.
  const fieldRowCounts = await computeNonNullCounts(
    db,
    dialect,
    tableName,
    diff.removed
  );

  // Step 3: map pipeline events.
  const interactiveFields: InteractiveField[] = [];
  const eventWarnings: string[] = [];
  for (const event of preview.events) {
    if (event.kind === "add_required_field_no_default") {
      interactiveFields.push({
        name: event.columnName,
        reason: "new_required_no_default",
        tableRowCount: event.tableRowCount,
        // Legacy 3-option set. Task 22 expands to 4 once the dialog is
        // upgraded to render ClassifierEvent[] natively.
        options: ["provide_default", "mark_nullable", "cancel"],
      });
    } else if (event.kind === "add_not_null_with_nulls") {
      interactiveFields.push({
        name: event.columnName,
        reason: "nullable_to_not_null_with_nulls",
        tableRowCount: event.tableRowCount,
        nullCount: event.nullCount,
        options: ["provide_default", "mark_nullable", "cancel"],
      });
    } else if (event.kind === "type_change") {
      // Legacy admin dialog has no per-field force-cast UX. Surface
      // the per-dialect warning copy instead.
      const warning =
        event.perDialectWarning[dialect === "postgresql" ? "pg" : dialect];
      eventWarnings.push(
        `Changing column '${event.columnName}' from '${event.fromType}' to '${event.toType}'. ${warning}`
      );
    }
  }

  // Step 4: classify each field per legacy rules, then roll up to overall.
  const added: AddedField[] = diff.added.map(field => {
    const isRequired = (field as { required?: boolean }).required === true;
    const hasDefault =
      (field as { default?: unknown }).default !== undefined ||
      (field as { defaultValue?: unknown }).defaultValue !== undefined;
    // Legacy classification: 'interactive' if pipeline emitted a matching event.
    const matchedEvent = preview.events.find(
      e =>
        e.kind === "add_required_field_no_default" &&
        e.columnName === field.name
    );
    return {
      name: field.name,
      type: field.type,
      required: isRequired,
      hasDefault,
      classification: matchedEvent ? "interactive" : "safe",
    };
  });

  const removed: RemovedField[] = diff.removed.map(field => {
    const rowCount = fieldRowCounts[field.name] ?? 0;
    return {
      name: field.name,
      type: field.type,
      rowCount,
      classification: rowCount > 0 ? "destructive" : "safe",
    };
  });

  const changed: ChangedField[] = diff.changed.map(change => {
    const rowCount = fieldRowCounts[change.name] ?? 0;
    let classification: "safe" | "destructive" | "interactive" = "safe";
    if (change.reason === "constraint_changed") {
      const matchedEvent = preview.events.find(
        e =>
          e.kind === "add_not_null_with_nulls" && e.columnName === change.name
      );
      if (matchedEvent) classification = "interactive";
    } else if (change.reason === "type_changed") {
      classification = "destructive";
    }
    return {
      name: change.name,
      from: change.from,
      to: change.to,
      rowCount,
      classification,
      reason: change.reason ?? "type_changed",
    };
  });

  // Roll up overall classification: most-severe-wins.
  const allFieldClassifications = [
    ...added.map(f => f.classification),
    ...removed.map(f => f.classification),
    ...changed.map(f => f.classification),
  ];
  let overall: "safe" | "destructive" | "interactive" = "safe";
  if (
    allFieldClassifications.includes("interactive") ||
    preview.classification === "interactive"
  ) {
    overall = "interactive";
  } else if (
    allFieldClassifications.includes("destructive") ||
    preview.classification === "destructive"
  ) {
    overall = "destructive";
  }

  // Combine field-diff warnings with classifier event warnings.
  const removedWarnings = removed
    .filter(f => f.rowCount > 0)
    .map(
      f =>
        `Removing field '${f.name}' will drop ${f.rowCount.toLocaleString()} rows of data.`
    );
  const changedWarnings = changed
    .filter(c => c.classification === "destructive")
    .map(
      c =>
        `Changing field '${c.name}' type (${c.from} -> ${c.to}) may cause data loss.`
    );
  const notNullWarnings = interactiveFields
    .filter(f => f.reason === "nullable_to_not_null_with_nulls")
    .map(
      f =>
        `Setting field '${f.name}' to required will fail: ${(f.nullCount ?? 0).toLocaleString()} rows have NULL values.`
    );

  return {
    hasChanges: true,
    hasDestructiveChanges: overall !== "safe",
    classification: overall,
    changes: {
      added,
      removed,
      changed,
      unchanged: diff.unchanged,
    },
    warnings: [
      ...removedWarnings,
      ...changedWarnings,
      ...notNullWarnings,
      ...eventWarnings,
    ],
    interactiveFields,
    ddlPreview: [],
  };
}

// Compute non-null row counts for each removed field via two count
// queries per field (countRows + countNulls). Best-effort: any query
// failure returns 0 for that field so the translator never blocks
// preview rendering.
async function computeNonNullCounts(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  removed: FieldDefinition[]
): Promise<Record<string, number>> {
  if (removed.length === 0) return {};

  const counts: Record<string, number> = {};

  // One countRows call upfront — same total for every removed field.
  let total = 0;
  try {
    total = await countRowsHelper(db, dialect, tableName);
  } catch {
    // Table may not exist (e.g. preview for a still-being-created
    // collection). Default totals to 0 and short-circuit per-field
    // null queries since they'd fail too.
    return Object.fromEntries(removed.map(f => [f.name, 0]));
  }

  for (const field of removed) {
    try {
      const nulls = await countNullsHelper(db, dialect, tableName, field.name);
      counts[field.name] = Math.max(0, total - nulls);
    } catch {
      counts[field.name] = 0;
    }
  }
  return counts;
}
