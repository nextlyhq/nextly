/**
 * The schema a desired schema describes, as the diff compares it.
 *
 * Two readers ask this: the apply, which then makes the database match, and
 * the schema preview, which shows what the apply would do. The preview built
 * its own snapshot from the entities alone, so it left out what the extension
 * schema adds: the tables plugins and the app declare, and the columns,
 * indexes and checks hooks contribute to entity tables. It then showed a
 * contributed column as one to drop and a declared table as one to create,
 * neither of which the apply would do. Both build it here, from the same
 * inputs, so they compare the same thing.
 *
 * @module domains/schema/pipeline/desired-snapshot
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { chooseTypeColumns } from "../../field-groups/storage/resolve-storage-names";
import type { ExtensionSchema } from "../extension/build-extension-schema";
import { withEntityContributions } from "../extension/entity-contributions";
import { identifierCaseRules } from "../utils/resolve-catalog-name";

import { desiredCollectionTable } from "./desired-collection-table";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "./diff/build-from-fields";
import type { NextlySchemaSnapshot, TableSpec } from "./diff/types";
import { builtByFor } from "./registered-collections";
import type { DesiredSchema } from "./types";

/**
 * Every table a desired schema manages: its entities' and the extension's.
 *
 * The live snapshot is introspected over exactly these. Without the extension
 * tables it omits them, and the diff compares each declared table against
 * nothing and plans to create it on every apply.
 */
export function desiredSchemaTableNames(
  desired: DesiredSchema,
  extensions: ExtensionSchema | null
): string[] {
  return [
    ...Object.values(desired.collections).map(c => c.tableName),
    ...Object.values(desired.singles).map(s => s.tableName),
    ...Object.values(desired.components).map(c => c.tableName),
    ...(extensions?.specs.map(spec => spec.name) ?? []),
  ];
}

export interface DesiredSnapshot {
  snapshot: NextlySchemaSnapshot;
  /**
   * The type discriminator column each field-group table already has, read
   * from the live tables. Returned because the apply's Drizzle tables need the
   * same answer the snapshot was built with.
   */
  fieldGroupTypeColumns: Map<string, string>;
}

/**
 * Build the desired snapshot against the live one it will be diffed with.
 *
 * `liveSnapshot` must be introspected over `desiredSchemaTableNames(desired,
 * extensions)`: hook-contributed checks are merged over the live table's, and
 * a field group's discriminator column is the one its live table has.
 */
export function buildDesiredSnapshot(args: {
  desired: DesiredSchema;
  dialect: SupportedDialect;
  liveSnapshot: NextlySchemaSnapshot;
  extensions: ExtensionSchema | null;
}): DesiredSnapshot {
  const { desired, dialect, liveSnapshot, extensions } = args;

  // Derived from the snapshot just taken, not from a fresh catalog read, so
  // the desired shape and the live shape come from ONE observation of the
  // database. A diff across two observations that disagree is the one thing
  // this must never produce.
  const fieldGroupTypeColumns = chooseTypeColumns(
    liveSnapshot.tables.map(table => ({
      table: table.name,
      columns: table.columns.map(column => column.name),
    })),
    Object.values(desired.components).map(c => c.tableName),
    // MySQL is given the folding setting rather than queried for it. The
    // names being matched are ones the caller asked the server to describe,
    // so a case-insensitive table match cannot select a different object than
    // the one requested, while an exact match would miss a server that
    // reported it folded. Column names fold on MySQL regardless, which is
    // what the discriminator lookup needs.
    dialect === "mysql"
      ? identifierCaseRules({ dialect, lowerCaseTableNames: 1 })
      : identifierCaseRules({ dialect })
  );

  // What hooks contributed to each entity table (columns, their defaults,
  // their enum checks and indexes), applied by the one helper the app's
  // migration stream applies them with, for all three entity kinds, so a push
  // and a generated migration cannot describe the table differently. Checks
  // are merged over the LIVE table's, so tracking them does not propose
  // dropping ones the pipeline never declared.
  const liveTablesByName = new Map(
    liveSnapshot.tables.map(table => [table.name, table])
  );
  const withContributions = (spec: TableSpec): TableSpec =>
    withEntityContributions(
      spec,
      extensions,
      liveTablesByName.get(spec.name),
      dialect
    );

  const snapshot: NextlySchemaSnapshot = {
    tables: [
      ...Object.values(desired.collections).map(c =>
        withContributions(desiredCollectionTable(c, dialect))
      ),
      ...Object.values(desired.singles).map(s =>
        withContributions(
          buildDesiredTableFromFields(
            s.tableName,
            s.fields as unknown as Parameters<
              typeof buildDesiredTableFromFields
            >[1],
            dialect,
            {
              builtBy: builtByFor("single", s.builderOwned),
              hasStatus: s.status === true,
              // A localized single's translatable columns live in its
              // companion, so they are left off the main table.
              localized: s.localized === true,
            }
          )
        )
      ),
      ...Object.values(desired.components).map(c =>
        withContributions(
          buildDesiredTableFromComponentFields(
            c.tableName,
            c.fields as unknown as Parameters<
              typeof buildDesiredTableFromComponentFields
            >[1],
            dialect,
            {
              builtBy: builtByFor("fieldGroup", c.builderOwned),
              localized: c.localized === true,
              typeColumn: fieldGroupTypeColumns.get(c.tableName),
            }
          )
        )
      ),
      // Already compiled, so they are appended rather than rebuilt: the spec
      // the diff compares and the Drizzle table drizzle-kit pushes come from
      // one compiler, and rebuilding either here would make them two.
      ...(extensions?.specs ?? []),
    ],
  };

  return { snapshot, fieldGroupTypeColumns };
}
