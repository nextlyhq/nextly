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
 * @module domains/schema/pipeline/ui-type-changes
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import {
  getColumnDescriptor,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import {
  type EntityTypeChangeInput,
  refuseFieldTypeChanges,
} from "../value-conversion/type-change/field-type-changes";

import { builtByFor } from "./registered-collections";
import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "./types";

/** How a refusal names each kind of entity. */
const KIND_LABEL = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
} as const;

type EntityKind = keyof typeof KIND_LABEL;

interface SavedEntity {
  kind: EntityKind;
  entity: DesiredCollection | DesiredSingle | DesiredFieldGroup;
  /** The fields the registry records for it before the save. */
  previous: FieldDefinition[];
  /** The fields as the save leaves them. */
  next: FieldDefinition[];
}

/** The entities the save states its old fields for and may change: none of code's. */
function builderSaved(desired: DesiredSchema): SavedEntity[] {
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
  return all.flatMap(({ kind, entity }) =>
    entity.recordedFields === undefined || entity.locked === true
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
  const { kind, entity, previous } = saved;
  return {
    label: `${KIND_LABEL[kind]} '${entity.slug}'`,
    table: entity.tableName,
    // A field translated before the save keeps each language's value in the companion table.
    ...(storesPerLanguage(entity)
      ? {
          translationsTable: `${entity.tableName}_locales`,
          translatedBefore: new Set(
            resolveLocalizedFieldNames(previous, true)
          ),
        }
      : {}),
    builtBy: builtByFor(kind, entity.builderOwned),
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
  for (const saved of builderSaved(desired)) {
    await refuseFieldTypeChanges(db, dialect, {
      ...entityInput(saved),
      previous: saved.previous,
      next: saved.next,
    });
  }
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
  desired: DesiredSchema,
  renames: readonly ConfirmedColumnRename[],
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  if (renames.length === 0) return;
  for (const saved of builderSaved(desired)) {
    const input = entityInput(saved);
    const columnOf = (field: FieldDefinition) =>
      getColumnDescriptor(field, dialect, input.builtBy)?.name.toLowerCase();
    // The entity's own table, or its companion for a translated field's rename.
    const tables = new Set(
      [saved.entity.tableName, `${saved.entity.tableName}_locales`].map(t =>
        t.toLowerCase()
      )
    );
    const renamed = new Map<string, string>();
    for (const rename of renames) {
      if (!tables.has(rename.tableName.toLowerCase())) continue;
      const from = saved.previous.find(
        f => columnOf(f) === rename.fromColumn.toLowerCase()
      );
      const to = saved.next.find(
        f => columnOf(f) === rename.toColumn.toLowerCase()
      );
      if (from !== undefined && to !== undefined && from.name !== to.name) {
        renamed.set(from.name, to.name);
      }
    }
    if (renamed.size === 0) continue;
    const newNames = new Set(renamed.values());
    await refuseFieldTypeChanges(db, dialect, {
      ...input,
      previous: saved.previous.filter(f => renamed.has(f.name)),
      next: saved.next.filter(f => newNames.has(f.name)),
      renamed,
    });
  }
}
