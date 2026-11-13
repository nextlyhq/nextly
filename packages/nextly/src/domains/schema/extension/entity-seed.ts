/**
 * The columns an entity table is seeded into the schema draft with.
 *
 * The draft refuses a contributed column whose name the table already has,
 * and judges a contributed index against the columns it names — but only
 * against columns it knows. These seeds are what it knows: every field column
 * and system column (`slug`, `created_at`, ...) the table carries, so a
 * contribution reusing one of those names is refused at declaration rather
 * than shadowing the real column in the spec, the hidden-column strip and the
 * runtime table.
 *
 * Derived from the builders the diff itself describes the table with — the
 * names are whatever those produce — so the seed cannot list a column the
 * table does not have or miss one it does. Each column's kind comes from the
 * same descriptors; a column no descriptor types (a component's system
 * columns) is seeded by name alone.
 *
 * @module domains/schema/extension/entity-seed
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
  type DeclaredIndex,
} from "../pipeline/diff/build-from-fields";
import {
  getColumnDescriptor,
  getSystemColumnDescriptors,
  kindAndSizes,
} from "../services/field-column-descriptor";

import type { SeedEntityTable } from "./draft";

/** An entity as the config declares it, as far as its columns depend on it. */
export interface SeedableEntity {
  entityKind: SeedEntityTable["entityKind"];
  tableName: string;
  fields: readonly { name: string; type: string }[];
  status?: boolean;
  localized?: boolean;
  /** Compound indexes the config declares (a collection's `indexes`), by field. */
  indexes?: readonly DeclaredIndex[];
}

type BuilderFields = Parameters<typeof buildDesiredTableFromFields>[1];
type DescribedField = Parameters<typeof getColumnDescriptor>[0];

/** The seed columns of one entity table, for one dialect. */
export function entitySeedColumns(
  entity: SeedableEntity,
  dialect: SupportedDialect
): SeedEntityTable["columns"] {
  return entitySeed(entity, dialect).columns;
}

/**
 * The seed of one entity table, for one dialect: its columns, and the
 * indexes its own fields and config give it (a unique or indexed field, a
 * declared compound index), by column, so an override that would leave one
 * unbuildable is refused when declared. An expression index names no
 * column, and none of its columns can be told apart, so it is left out.
 */
export function entitySeed(
  entity: SeedableEntity,
  dialect: SupportedDialect
): {
  columns: SeedEntityTable["columns"];
  indexes: NonNullable<SeedEntityTable["ownIndexes"]>;
} {
  // Code-first: the seed is built from the config, which is what these
  // entities come from, and the builder only decides column TYPES — the
  // names, which are what the draft checks, do not depend on it.
  const builtBy = "codeFirst" as const;
  // Where the entity's translatable values live, as its desired and runtime
  // tables decide it (`storesPerLanguage`): with every field kept per
  // language, a translatable field's column is on the language table even
  // for an entity not marked translatable, and the main table has none.
  const localized = storesPerLanguage(entity);
  const fields = entity.fields as unknown as BuilderFields;
  const spec =
    entity.entityKind === "component"
      ? buildDesiredTableFromComponentFields(
          entity.tableName,
          fields,
          dialect,
          {
            builtBy,
            localized,
          }
        )
      : buildDesiredTableFromFields(entity.tableName, fields, dialect, {
          builtBy,
          hasStatus: entity.status === true,
          ...(entity.indexes !== undefined
            ? { indexes: [...entity.indexes] }
            : {}),
          localized,
        });

  // Every kind a column of this table can have, by name: the fields', and
  // every system column the entity kind could carry. A decimal's precision
  // and scale ride along: a foreign key referencing it is compared to them.
  const typed = new Map<
    string,
    Omit<SeedEntityTable["columns"][number], "name" | "nullable">
  >();
  if (entity.entityKind !== "component") {
    for (const system of getSystemColumnDescriptors(dialect, {
      hasTitleField: false,
      hasSlugField: false,
      hasStatus: true,
      isSingle: entity.entityKind === "single",
    })) {
      typed.set(system.name, kindAndSizes(system));
    }
  }
  // The columns the entity's own fields generate, as opposed to the ones its
  // kind gives it: only these may have their storage overridden. A field of
  // the same name as a system column (`title`, `slug`) is the field's.
  const fieldColumns = new Set<string>();
  for (const field of entity.fields) {
    const descriptor = getColumnDescriptor(
      field as unknown as DescribedField,
      dialect,
      builtBy
    );
    if (descriptor === null) continue;
    typed.set(descriptor.name, kindAndSizes(descriptor));
    fieldColumns.add(descriptor.name);
  }
  return {
    columns: spec.columns.map(column => ({
      name: column.name,
      nullable: column.nullable,
      ...(typed.get(column.name) ?? {}),
      ...(fieldColumns.has(column.name) ? { field: true } : {}),
    })),
    indexes: (spec.indexes ?? [])
      .filter(index => index.columns.length > 0)
      .map(index => ({ columns: [...index.columns], unique: index.unique })),
  };
}
