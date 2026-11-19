// Translates pipeline preview output (Operation[] + ClassifierEvent[]
// + RenameCandidate[]) into the legacy SchemaPreviewResult shape that
// the admin SchemaChangeDialog renders.
//
// This file keeps the public framework's
// `/api/collections/schema/{slug}/preview` endpoint backwards-
// compatible now that its internals run on the new pipeline. The
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
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { usesJunctionTable } from "../field-rules";
import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
  countRowsBreakingNotNull,
} from "../pipeline/classifier/count-helpers";
import type { PipelinePreviewResult } from "../pipeline/preview";
import {
  fieldProducesColumn,
  fieldsStoredOnRow,
  junctionTableNameFor,
  toSnakeCase,
  type ColumnOrigin,
} from "../services/field-column-descriptor";
import { rowFieldDiff } from "../services/field-diff";
import {
  relationshipTargetSlug,
  sameRelationTarget,
} from "../services/relationship-key-target";
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
  /**
   * Whether the save asks for the entity to be translated, when it says. Turning
   * translation on or off moves every field translated by default between the
   * tables, so a save that does only that is still a change.
   */
  requestedLocalized?: boolean;
  /**
   * The generator that built the table. A field group's many-to-many keeps its ids in its own row
   * (`componentRelationshipStoresJson`), with no link table, so it has none to drop or start.
   */
  builtBy?: ColumnOrigin;
}

/**
 * Translate pipeline preview output to legacy `SchemaPreviewResult`.
 *
 * What this does:
 *   1. Run `rowFieldDiff` on user-provided fields to produce the
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
 *      pushSchema; that side-channel is gone here because it
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
  // Where the fields' values are stored, before and after, by the shared rule: an entity keeps its
  // translatable values in the companion when translated, and every entity does under per-language
  // storage, where turning the entity's translation on or off moves none of them.
  const diff = rowFieldDiff(currentFields, newFields, {
    localized: storesPerLanguage({ localized }),
    newLocalized: storesPerLanguage({
      localized: context.requestedLocalized ?? localized,
    }),
  });

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

  // The links each relationship moving into or out of a link table drops, counted where they are.
  const droppedLinks =
    context.builtBy === "fieldGroup"
      ? new Map<string, LinksDropped>()
      : await countLinksDropped(
          db,
          dialect,
          { tableName, localized },
          currentFields,
          newFields
        );

  const changed: ChangedField[] = diff.changed.map(change => {
    const dropped = droppedLinks.get(change.name);
    const rowCount =
      dropped?.count.rowCount ?? fieldRowCounts[change.name]?.rowCount ?? 0;
    let classification: "safe" | "destructive" | "interactive" = "safe";
    if (togglesHasMany(change.name, currentFields, newFields)) {
      // One related entry or many is stored differently, so switching between
      // them can lose values, whatever else changed on the field with it.
      classification = "destructive";
    } else if (dropped !== undefined) {
      // Links moving into or out of a link table: neither way carries one over, so they go.
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
      // A link count that could not be read is unknown, never a known 0.
      ...(dropped?.count.unknown ? { rowCountUnknown: true as const } : {}),
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
    ...linkTableWarnings(c.name, droppedLinks),
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
      ...uniquenessWarnings(preview, context),
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
  // The row's fields, a field inside a group with no name among them, as the diff reads them.
  const before = fieldsStoredOnRow(currentFields).find(f => f.name === name);
  const after = fieldsStoredOnRow(newFields).find(f => f.name === name);
  if (!before || !after) return false;
  return (before.hasMany === true) !== (after.hasMany === true);
}

/**
 * A relationship whose links the save drops by moving them into or out of a link table: the links
 * it holds where they are now, what it was and what it becomes, and which way it moves.
 */
interface LinksDropped {
  count: RemovedCount;
  before: FieldDefinition;
  after: FieldDefinition;
  /**
   * Out of its link table (`leaving`); out of its column into a new, empty one (`joining`); or
   * kept a many-to-many but pointed elsewhere, its table dropped for an empty one (`retargeted`).
   */
  direction: "leaving" | "joining" | "retargeted";
}

/**
 * The links each kept relationship drops by moving into or out of a link table of its own
 * (`usesJunctionTable`), by field name, as the save drops them: neither way carries a link over.
 * - Leaving one, the save drops the table: counted there (`junctionTableNameFor`, the name its DROP
 *   uses), quoted as the save quotes it (`countRowsBreakingNotNull` with no column counts every
 *   row), so a name with a hyphen is counted, not refused.
 * - Joining one, the save drops the field's column and starts an empty table: counted in the column,
 *   as a removed field's values are (`computeNonNullCounts`).
 * A count that cannot be read is unknown, never 0, and the change still drops the links.
 */
async function countLinksDropped(
  db: unknown,
  dialect: SupportedDialect,
  at: { tableName: string; localized: boolean },
  currentFields: FieldDefinition[],
  newFields: FieldDefinition[]
): Promise<Map<string, LinksDropped>> {
  // The row's fields, a field inside a group with no name among them, as the diff reads them.
  const afterByName = new Map(
    fieldsStoredOnRow(newFields).map(field => [field.name, field])
  );
  const dropped = new Map<string, LinksDropped>();
  for (const before of fieldsStoredOnRow(currentFields)) {
    const after = afterByName.get(before.name);
    const direction = after && linkMoveOf(before, after);
    if (!after || !direction) continue;
    const count =
      direction === "joining"
        ? ((
            await computeNonNullCounts(
              db,
              dialect,
              at.tableName,
              at.localized,
              [before]
            )
          )[before.name] ?? UNCOUNTED)
        : await countJunctionLinks(db, dialect, at.tableName, before);
    dropped.set(before.name, { count, before, after, direction });
  }
  return dropped;
}

/**
 * Which way a kept relationship's links move, if they do: into a link table, out of one, or to a
 * new one for another target. Kept a many-to-many and pointed the same way, its link table is
 * carried (`sameRelationTarget`, the save's own pairing), so no link moves. The dialog's file road
 * asks the same of a save before it runs (`refuseUnansweredDialogQuestions`).
 */
export function linkMoveOf(
  before: FieldDefinition,
  after: FieldDefinition
): LinksDropped["direction"] | null {
  const hadTable = usesJunctionTable(before);
  const hasTable = usesJunctionTable(after);
  if (!hadTable) return hasTable ? "joining" : null;
  if (!hasTable) return "leaving";
  return sameRelationTarget(before, after) ? null : "retargeted";
}

/** The links a many-to-many's link table holds, or unknown where they cannot be counted. */
async function countJunctionLinks(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  field: FieldDefinition
): Promise<RemovedCount> {
  try {
    const { total } = await countRowsBreakingNotNull(db, dialect, {
      table: junctionTableNameFor(tableName, field),
      column: null,
    });
    return { rowCount: total, unknown: false };
  } catch {
    return UNCOUNTED;
  }
}

/** What a relationship is called on the side of the move that keeps no link table. */
function linkFieldKind(field: FieldDefinition): string {
  if (field.type !== "relationship") return `a ${field.type} field`;
  return field.hasMany === true ? "a list of links" : "a single link";
}

/**
 * The warning for a relationship whose links the save drops by moving them into or out of a link
 * table, with the links it holds, naming what it was or becomes on the side with no link table.
 */
function linkTableWarnings(
  name: string,
  dropped: ReadonlyMap<string, LinksDropped>
): string[] {
  const links = dropped.get(name);
  if (links === undefined) return [];
  if (links.direction === "joining") {
    const was = linkFieldKind(links.before);
    // A list keeps several links in each entry's value, so its count is of entries, not links.
    const held =
      links.before.hasMany === true
        ? `the links of its ${links.count.rowCount.toLocaleString()} entries`
        : `its ${links.count.rowCount.toLocaleString()} links`;
    return [
      links.count.unknown
        ? `Changing '${name}' from ${was} to many-to-many drops the column holding its links: could not count them; its new link table starts empty.`
        : `Changing '${name}' from ${was} to many-to-many drops the column holding ${held}; its new link table starts empty.`,
    ];
  }
  if (links.direction === "retargeted") {
    const target = relationshipTargetSlug(links.after) ?? "another collection";
    return [
      links.count.unknown
        ? `Changing '${name}' to link to '${target}' instead drops its link table and every link it holds: could not count them; its new link table starts empty.`
        : `Changing '${name}' to link to '${target}' instead drops its link table and the ${links.count.rowCount.toLocaleString()} links it holds; its new link table starts empty.`,
    ];
  }
  const becomes = linkFieldKind(links.after);
  return [
    links.count.unknown
      ? `Changing '${name}' from many-to-many to ${becomes} drops its link table and every link it holds: could not count them.`
      : `Changing '${name}' from many-to-many to ${becomes} drops its link table and the ${links.count.rowCount.toLocaleString()} links it holds.`,
  ];
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

/**
 * One line per kept field whose column this change makes unique, or stops being unique, as the
 * planned operations say: a unique index added or dropped on the entity's table. Read from the
 * operations rather than from the fields, so the preview names exactly what the apply will run,
 * including nothing for a column that is already unique.
 *
 * A relationship made unique is one-to-one, each entry pointing at its own target, and is named
 * that way.
 */
function uniquenessWarnings(
  preview: PipelinePreviewResult,
  context: TranslateContext
): string[] {
  // The row's fields, a field inside a group with no name among them, by the column each is.
  const kept = new Set(
    fieldsStoredOnRow(context.currentFields).map(field => field.name)
  );
  const byColumn = new Map(
    fieldsStoredOnRow(context.newFields)
      .filter(field => kept.has(field.name))
      .map(field => [toSnakeCase(field.name).toLowerCase(), field])
  );
  return uniqueIndexChanges(preview.operations, context.tableName).flatMap(
    ({ column, adding }) => {
      const field = byColumn.get(column);
      return field === undefined ? [] : [uniquenessLine(field, adding)];
    }
  );
}

/** Each single-column unique index the operations add or drop on `tableName`, by its column. */
function uniqueIndexChanges(
  operations: PipelinePreviewResult["operations"],
  tableName: string
): { column: string; adding: boolean }[] {
  return operations.flatMap(op =>
    (op.type === "add_index" || op.type === "drop_index") &&
    op.tableName === tableName &&
    op.index.unique &&
    op.index.columns.length === 1
      ? [
          {
            column: op.index.columns[0].toLowerCase(),
            adding: op.type === "add_index",
          },
        ]
      : []
  );
}

/** What the preview says of a field whose column becomes, or stops being, unique. */
function uniquenessLine(field: FieldDefinition, adding: boolean): string {
  if (field.type === "relationship") {
    return adding
      ? `"${field.name}" becomes one-to-one: its column will be made unique.`
      : `"${field.name}" is no longer one-to-one: its column will no longer be unique.`;
  }
  return adding
    ? `"${field.name}" becomes unique: its column will refuse a value another entry already holds.`
    : `"${field.name}" is no longer unique: its column will take a value another entry holds.`;
}
