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
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "../pipeline/diff/build-from-fields";
import {
  getColumnDescriptor,
  getSystemColumnDescriptors,
} from "../services/field-column-descriptor";

import type { SeedEntityTable } from "./draft";

/** An entity as the config declares it, as far as its columns depend on it. */
export interface SeedableEntity {
  entityKind: SeedEntityTable["entityKind"];
  tableName: string;
  fields: readonly { name: string; type: string }[];
  status?: boolean;
  localized?: boolean;
}

type BuilderFields = Parameters<typeof buildDesiredTableFromFields>[1];
type DescribedField = Parameters<typeof getColumnDescriptor>[0];

/** The seed columns of one entity table, for one dialect. */
export function entitySeedColumns(
  entity: SeedableEntity,
  dialect: SupportedDialect
): SeedEntityTable["columns"] {
  // Code-first: the seed is built from the config, which is what these
  // entities come from, and the builder only decides column TYPES — the
  // names, which are what the draft checks, do not depend on it.
  const builtBy = "codeFirst" as const;
  const fields = entity.fields as unknown as BuilderFields;
  const spec =
    entity.entityKind === "component"
      ? buildDesiredTableFromComponentFields(
          entity.tableName,
          fields,
          dialect,
          {
            builtBy,
            localized: entity.localized === true,
          }
        )
      : buildDesiredTableFromFields(entity.tableName, fields, dialect, {
          builtBy,
          hasStatus: entity.status === true,
          localized: entity.localized === true,
        });

  // Every kind a column of this table can have, by name: the fields', and
  // every system column the entity kind could carry.
  const typed = new Map<string, { kind: string; length?: number }>();
  if (entity.entityKind !== "component") {
    for (const system of getSystemColumnDescriptors(dialect, {
      hasTitleField: false,
      hasSlugField: false,
      hasStatus: true,
      isSingle: entity.entityKind === "single",
    })) {
      typed.set(system.name, {
        kind: system.kind,
        ...(system.length !== undefined ? { length: system.length } : {}),
      });
    }
  }
  for (const field of entity.fields) {
    const descriptor = getColumnDescriptor(
      field as unknown as DescribedField,
      dialect,
      builtBy
    );
    if (descriptor === null) continue;
    typed.set(descriptor.name, {
      kind: descriptor.kind,
      ...(descriptor.length !== undefined ? { length: descriptor.length } : {}),
    });
  }

  return spec.columns.map(column => ({
    name: column.name,
    nullable: column.nullable,
    ...(typed.get(column.name) ?? {}),
  }));
}
