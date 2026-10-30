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
//     is the explicit retirement plan for this translator: rewrite
//     the admin dialog to consume ClassifierEvent[] directly, deprecate
//     this v1 translator + endpoint with a sunset window, then delete.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { isVirtualField } from "../../../collections/fields/virtual";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { isFieldLocalized } from "../../i18n/classify-fields";
import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "../pipeline/classifier/count-helpers";
import type { PipelinePreviewResult } from "../pipeline/preview";
import {
  fieldProducesColumn,
  toSnakeCase,
} from "../services/field-column-descriptor";
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
  /**
   * Whether the entity is translated now. A translated field's values live in
   * the companion table, so that is where its removal is counted.
   */
  localized?: boolean;
}

/**
 * Translate pipeline preview output to legacy `SchemaPreviewResult`.
 *
 * What this does:
 *   1. Run `computeFieldDiff` on user-provided fields to produce the
 *      legacy `changes.{added,removed,changed,unchanged}` shape.
 *   2. Count the non-null values each removed field holds, where they are
 *      stored (`countRows - countNulls`, the pipeline's helpers). A count
 *      that cannot be read never fails the translation; it comes back as
 *      unknown, and the removal is classed as deleting data.
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
  const localized = context.localized === true;

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

  // Step 2: what each removed field holds, counted where its values are
  // stored. A count that cannot be read never fails the translation, and never
  // reads as "nothing is deleted" either: it comes back as unknown.
  const fieldRowCounts = await computeNonNullCounts(
    db,
    dialect,
    tableName,
    localized,
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
    const count = fieldRowCounts[field.name] ?? UNCOUNTED;
    // Deletes data when it holds values, and when its values could not be
    // counted: an unknown count is never taken for an empty column.
    const deletes = count.unknown || count.rowCount > 0;
    return {
      name: field.name,
      type: field.type,
      rowCount: count.rowCount,
      ...(count.unknown ? { rowCountUnknown: true as const } : {}),
      classification: deletes ? "destructive" : "safe",
    };
  });

  const changed: ChangedField[] = diff.changed.map(change => {
    const rowCount = fieldRowCounts[change.name]?.rowCount ?? 0;
    let classification: "safe" | "destructive" | "interactive" = "safe";
    if (togglesHasMany(change.name, currentFields, newFields)) {
      // One related entry or many is stored differently, so switching between
      // them can lose values, whatever else changed on the field with it.
      classification = "destructive";
    } else if (change.reason === "constraint_changed") {
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
  const removedWarnings = removed.flatMap(f => {
    if (f.rowCountUnknown) {
      return [
        `Removing field '${f.name}' may delete its values: could not count the rows '${f.name}' holds.`,
      ];
    }
    return f.rowCount > 0
      ? [
          `Removing field '${f.name}' will drop ${f.rowCount.toLocaleString()} rows of data.`,
        ]
      : [];
  });
  // A change can do both, so each says its own part: one warning for the
  // switch between one and many, one for a change of type.
  const changedWarnings = changed.flatMap(c => [
    ...(togglesHasMany(c.name, currentFields, newFields)
      ? [
          `Changing '${c.name}' between one and many related entries changes how its values are stored; values may be lost.`,
        ]
      : []),
    ...(c.reason === "type_changed"
      ? [
          `Changing field '${c.name}' type (${c.from} -> ${c.to}) may cause data loss.`,
        ]
      : []),
  ]);
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

/** A removed field's values, as far as the preview could count them. */
interface RemovedCount {
  rowCount: number;
  /** True when the count could not be read: never taken for an empty column. */
  unknown: boolean;
}

const UNCOUNTED: RemovedCount = { rowCount: 0, unknown: true };

/**
 * Whether a changed field switches between one related entry and many, which
 * stores its values differently. Read from the fields themselves rather than
 * from the diff's single reason, which names only the first difference it
 * finds; an absent flag and `false` both mean one.
 */
function togglesHasMany(
  name: string,
  currentFields: FieldDefinition[],
  newFields: FieldDefinition[]
): boolean {
  const before = currentFields.find(f => f.name === name);
  const after = newFields.find(f => f.name === name);
  if (!before || !after) return false;
  return (before.hasMany === true) !== (after.hasMany === true);
}

/**
 * Count each removed field's non-null values where they are stored:
 * - a field with no storage (a virtual field) holds nothing;
 * - a field whose values live in a table of their own (a field group, a
 *   many-to-many relationship) is not counted here, so its count is unknown;
 * - a translated field of a translated entity is counted in the companion
 *   table, across its languages; every other field on the main table;
 * - the column is the field's stored column name, not its name as written.
 * Any count that fails is unknown, never 0.
 */
async function computeNonNullCounts(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  localized: boolean,
  removed: FieldDefinition[]
): Promise<Record<string, RemovedCount>> {
  const counts: Record<string, RemovedCount> = {};
  // One row count per table, shared by the fields stored in it.
  const totals = new Map<string, Promise<number>>();
  const totalOf = (table: string): Promise<number> => {
    const known = totals.get(table);
    if (known) return known;
    const pending = countRowsHelper(db, dialect, table);
    totals.set(table, pending);
    return pending;
  };

  for (const field of removed) {
    if (isVirtualField(field)) {
      counts[field.name] = { rowCount: 0, unknown: false };
      continue;
    }
    if (!fieldProducesColumn(field)) {
      counts[field.name] = UNCOUNTED;
      continue;
    }
    const table = isFieldLocalized(field, localized)
      ? `${tableName}${STORAGE_FORMAT.companionSuffix}`
      : tableName;
    try {
      const total = await totalOf(table);
      const nulls = await countNullsHelper(
        db,
        dialect,
        table,
        toSnakeCase(field.name)
      );
      counts[field.name] = {
        rowCount: Math.max(0, total - nulls),
        unknown: false,
      };
    } catch {
      counts[field.name] = UNCOUNTED;
    }
  }
  return counts;
}
