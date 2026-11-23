/**
 * A Schema Builder save's field type changes, refused before the push runs anything: each entity
 * the save states its old fields for (`recordedFields`) is judged, value by value, against the
 * fields it saves (`refuseFieldTypeChanges`). A blocked change, or a lossy one the owner has not
 * consented to, refuses the whole save with every refusal named, before any statement runs. A
 * locked entity is code's, and the save changes none of its columns.
 *
 * A field that keeps its name is judged before the push plans anything (`refuseUiTypeChanges`); a
 * field the save renames is judged once the renames are answered (`refuseRenamedUiTypeChanges`),
 * since only the answers say which old column the new field's values come from.
 *
 * A code-first apply (a reload under `next dev`, `nextly db:sync`, a development start) states its
 * old fields too, from each entity's registry row, and its field type changes are judged by the
 * same judgement in the same words (`configuredTypeChangeRefusals`), a field held inside a group's
 * or a repeater's JSON included. Only stricter: a change it allows still meets the code-first rule
 * after it, and a lossy change of a field on the row that the data-loss consent or a terminal
 * answers for is left to that rule, which clears values only so.
 *
 * @module domains/schema/pipeline/ui-type-changes
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { canPrompt } from "../migrate/can-prompt";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { consentForColumn } from "../repair-columns/consent";
import {
  fieldsStoredOnRow,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import {
  type ColumnAt,
  columnDescriptorAt,
} from "../value-conversion/type-change/field-type";
import {
  entityLabel,
  type EntityTypeChangeInput,
  fieldTypeChangeRefusals,
  perLanguageAfter,
  perLanguageBefore,
  refuseFieldTypeChanges,
  type TypeChangeRefusal,
} from "../value-conversion/type-change/field-type-changes";

import { introspectLiveSnapshot } from "./diff/introspect-live";
import { builtByFor } from "./registered-collections";
import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "./types";

type EntityKind = "collection" | "single" | "fieldGroup";

interface SavedEntity {
  kind: EntityKind;
  entity: DesiredCollection | DesiredSingle | DesiredFieldGroup;
  /** The fields the registry records for it before the save. */
  previous: FieldDefinition[];
  /** The fields as the save leaves them. */
  next: FieldDefinition[];
}

/**
 * The entities an apply states its old fields for and may change: a Schema Builder save's (none of
 * code's, which are locked), or a code-first apply's (none of the Builder's), as `owner` says.
 */
function savedEntities(
  desired: DesiredSchema,
  owner: "builder" | "configured"
): SavedEntity[] {
  const all: { kind: EntityKind; entity: SavedEntity["entity"] }[] = [
    ...Object.values(desired.collections).map(entity => ({
      kind: "collection" as const,
      entity,
    })),
    ...Object.values(desired.singles).map(entity => ({
      kind: "single" as const,
      entity,
    })),
    ...Object.values(desired.components).map(entity => ({
      kind: "fieldGroup" as const,
      entity,
    })),
  ];
  const changes = (entity: SavedEntity["entity"]): boolean =>
    owner === "builder" ? entity.locked !== true : entity.builderOwned !== true;
  return all.flatMap(({ kind, entity }) =>
    entity.recordedFields === undefined || !changes(entity)
      ? []
      : [
          {
            kind,
            entity,
            previous: entity.recordedFields as unknown as FieldDefinition[],
            next: entity.fields as unknown as FieldDefinition[],
          },
        ]
  );
}

/** What the precondition reads of one saved entity, besides the fields it judges. */
function entityInput(
  saved: SavedEntity
): Omit<EntityTypeChangeInput, "previous" | "next" | "renamed"> {
  const { kind, entity, previous, next } = saved;
  return {
    label: entityLabel(kind, entity.slug),
    table: entity.tableName,
    // A field translated before the save keeps each language's value in the companion table. The
    // desired entity says whether it is translated after the save; a save that turns translation
    // on or off has the values where they were, so the companion is always named and each value is
    // read from whichever of the two tables holds its column.
    translationsTable: `${entity.tableName}_locales`,
    ...perLanguageBefore(entity, entity.tableName, previous),
    ...perLanguageAfter(entity, next),
    builtBy: builtByFor(kind, entity.builderOwned),
    // A field group keeps its fields on its component rows, where a many-to-many has a column.
    ...(kind === "fieldGroup" ? { componentRow: true } : {}),
  };
}

/**
 * Refuse the save's blocked and unconsented lossy type changes of fields that keep their names,
 * entity by entity.
 *
 * @throws {NextlyError} a validation error naming each refused field of the first entity that has
 *   one
 */
export async function refuseUiTypeChanges(
  desired: DesiredSchema,
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  for (const saved of savedEntities(desired, "builder")) {
    const input = entityInput(saved);
    const renamed = await landedRenames(saved, input, db, dialect);
    await refuseFieldTypeChanges(db, dialect, {
      ...input,
      previous: saved.previous,
      next: saved.next,
      ...(renamed.size > 0 ? { renamed } : {}),
    });
  }
}

/** One code-first entity's refused field type changes. */
export interface ConfiguredTypeChangeRefusals {
  kind: EntityKind;
  slug: string;
  refusals: TypeChangeRefusal[];
}

/**
 * Whether the code-first rule answers for a lossy type change of the column `table`.`column`, which
 * the judgement then leaves to it: the data-loss consent naming the column, or a terminal that asks.
 */
export type ConfiguredLossAnswered = (table: string, column: string) => boolean;

/**
 * Each code-first entity's field type changes, judged as a Schema Builder save judges them, over the
 * values its columns and its containers' JSON hold, with each refusal in the Builder's words
 * (`fieldTypeChangeRefusals`). A lossy change of a field on the row that `answered` covers is left to
 * the code-first rule, which clears its values only under that answer. A value held inside JSON is
 * never cleared, so no answer covers its change.
 */
export async function configuredTypeChangeRefusals(
  desired: DesiredSchema,
  db: unknown,
  dialect: SupportedDialect,
  answered: ConfiguredLossAnswered
): Promise<ConfiguredTypeChangeRefusals[]> {
  const refused: ConfiguredTypeChangeRefusals[] = [];
  for (const saved of savedEntities(desired, "configured")) {
    const refusals = await fieldTypeChangeRefusals(
      db,
      dialect,
      configuredInput(saved, dialect, answered)
    );
    if (refusals.length > 0) {
      refused.push({ kind: saved.kind, slug: saved.entity.slug, refusals });
    }
  }
  return refused;
}

/**
 * Refuse a code-first apply's refused field type changes (`configuredTypeChangeRefusals`), entity by
 * entity, before it plans anything: a lossy change of a field on the row is left to the code-first
 * rule where the data-loss consent names its column or a terminal will ask.
 *
 * @throws {NextlyError} a validation error naming each refused field of the first entity that has
 *   one
 */
export async function refuseConfiguredTypeChanges(
  desired: DesiredSchema,
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  const answered = configuredLossAnswer(canPrompt());
  for (const saved of savedEntities(desired, "configured")) {
    await refuseFieldTypeChanges(
      db,
      dialect,
      configuredInput(saved, dialect, answered)
    );
  }
}

/**
 * The code-first rule's answer for a lossy type change: the data-loss consent naming its column, as
 * `db:sync` and the development push read it, or, where `asks`, the terminal's question.
 */
export function configuredLossAnswer(asks: boolean): ConfiguredLossAnswered {
  const consent = resolveDataLossConsent({
    env: process.env,
    honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
  });
  return (table, column) =>
    asks || consentForColumn(consent, table, column, "a type change").covered;
}

/**
 * What the judgement reads of one code-first entity: its fields before and after, and, as
 * acknowledged, each field on the row whose column's lossy change `answered` covers.
 */
function configuredInput(
  saved: SavedEntity,
  dialect: SupportedDialect,
  answered: ConfiguredLossAnswered
): EntityTypeChangeInput {
  const input = entityInput(saved);
  const acknowledged = new Set<string>();
  for (const field of fieldsStoredOnRow(saved.next)) {
    const column = columnDescriptorAt(field, dialect, input)?.name;
    if (column !== undefined && answered(saved.entity.tableName, column)) {
      acknowledged.add(field.name);
    }
  }
  return {
    ...input,
    previous: saved.previous,
    next: saved.next,
    acknowledged,
  };
}

/**
 * A rename an earlier apply already made: MySQL commits a rename on its own, so an apply refused
 * after it and before the type change that followed leaves the field's old values under its new
 * name. Found where the save drops one recorded field and adds one new field, and the table has
 * the new one's column and not the old one's; then the new field is judged as the old one's type
 * change. Anything else names no rename, and reads no table.
 */
async function landedRenames(
  saved: SavedEntity,
  // Where the entity keeps its fields, which decides each one's column (`columnDescriptorAt`).
  at: ColumnAt,
  db: unknown,
  dialect: SupportedDialect
): Promise<Map<string, string>> {
  const previous = fieldsStoredOnRow(saved.previous);
  const next = fieldsStoredOnRow(saved.next);
  const nextNames = new Set(next.map(f => f.name));
  const previousNames = new Set(previous.map(f => f.name));
  const dropped = previous.filter(f => !nextNames.has(f.name));
  const added = next.filter(f => !previousNames.has(f.name));
  if (dropped.length === 0 || added.length === 0) return new Map();
  const live = await introspectLiveSnapshot(db, dialect, [
    saved.entity.tableName,
  ]);
  const columns = new Set(
    (live.tables[0]?.columns ?? []).map(c => c.name.toLowerCase())
  );
  const has = (field: FieldDefinition) =>
    columns.has(
      columnDescriptorAt(field, dialect, at)?.name.toLowerCase() ?? ""
    );
  const gone = dropped.filter(f => !has(f));
  const landed = added.filter(has);
  const [from] = gone;
  const [to] = landed;
  return gone.length === 1 && landed.length === 1 && from && to
    ? new Map([[from.name, to.name]])
    : new Map();
}

/** A rename the save's answers confirmed, by table and column. */
export interface ConfirmedColumnRename {
  tableName: string;
  fromColumn: string;
  toColumn: string;
}

/**
 * Refuse the blocked and unconsented lossy type changes of fields the save renames, judged once
 * the renames are answered and before anything runs: the rename carries the old column's values to
 * the new name, where the new type then reads them. Only the renamed fields are judged here; the
 * rest were judged before the push planned anything (`refuseUiTypeChanges`).
 *
 * @throws {NextlyError} a validation error naming each refused field of the first entity that has
 *   one
 */
export async function refuseRenamedUiTypeChanges(
  source: "ui" | "code",
  desired: DesiredSchema,
  renames: readonly ConfirmedColumnRename[],
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  // A code-first apply's type changes are judged by its own rule, in the classifier.
  if (source !== "ui" || renames.length === 0) return;
  for (const saved of savedEntities(desired, "builder")) {
    const input = entityInput(saved);
    const columnOf = (field: FieldDefinition) =>
      columnDescriptorAt(field, dialect, input)?.name.toLowerCase();
    // The entity's own table, or its companion for a translated field's rename.
    const tables = new Set(
      [saved.entity.tableName, `${saved.entity.tableName}_locales`].map(t =>
        t.toLowerCase()
      )
    );
    const previous = fieldsStoredOnRow(saved.previous);
    const next = fieldsStoredOnRow(saved.next);
    const renamed = renamedFieldsOf(previous, next, renames, tables, columnOf);
    if (renamed.size === 0) continue;
    const newNames = new Set(renamed.values());
    await refuseFieldTypeChanges(db, dialect, {
      ...input,
      previous: previous.filter(f => renamed.has(f.name)),
      next: next.filter(f => newNames.has(f.name)),
      renamed,
    });
  }
}

/**
 * The fields the confirmed renames name, old name to new, among the fields kept on the row: a field
 * a group with no name holds is one of them by its own name. A rename on another table, or one that
 * names no field on either side, names none.
 *
 * @param tables the tables, lower-cased, whose renames are this entity's
 * @param columnOf a field's column name, lower-cased
 */
export function renamedFieldsOf(
  previous: readonly FieldDefinition[],
  next: readonly FieldDefinition[],
  renames: readonly ConfirmedColumnRename[],
  tables: ReadonlySet<string>,
  columnOf: (field: FieldDefinition) => string | undefined
): Map<string, string> {
  const renamed = new Map<string, string>();
  const previousOnRow = fieldsStoredOnRow(previous);
  const nextOnRow = fieldsStoredOnRow(next);
  for (const rename of renames) {
    if (!tables.has(rename.tableName.toLowerCase())) continue;
    const from = previousOnRow.find(
      f => columnOf(f) === rename.fromColumn.toLowerCase()
    );
    const to = nextOnRow.find(
      f => columnOf(f) === rename.toColumn.toLowerCase()
    );
    if (from !== undefined && to !== undefined && from.name !== to.name) {
      renamed.set(from.name, to.name);
    }
  }
  return renamed;
}
