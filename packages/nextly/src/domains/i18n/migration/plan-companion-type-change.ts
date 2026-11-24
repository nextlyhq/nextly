/**
 * The `retypes` file of a translated entity whose fields, translated before a change and after it,
 * take another type: each one's column in the entity's translations table given the type its new
 * field type makes there, on the way up, and its old one on the way down.
 *
 * Only the changing fields' own columns are named. Nothing reads or changes the table's other
 * columns, so a column this module does not know of (a translated repeater's or group's values,
 * kept beside the fields' columns) is left as it is.
 *
 * Each column is cast as the main table's column of the same change is, so both take the values
 * alike: PostgreSQL's `ALTER COLUMN … TYPE … USING`, MySQL's `MODIFY`, and on SQLite a column of
 * the new type filled with `CAST` and renamed into place. The values are judged before the file
 * runs (`nextly migrate` and the Schema Builder save judge each language's value), so a value the
 * cast would not read as the new type never reaches it.
 *
 * A field unique within each language, before the change and after it, has its per-language index
 * dropped first and created again on the new column, since the index's key depends on the column's
 * type (a text leaves its blank out). A field that becomes or stops being unique has its index
 * created or dropped by its own `unique` file, which runs after or before this one.
 *
 * @module domains/i18n/migration/plan-companion-type-change
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { conversionBetweenShapes } from "../../schema/pipeline/diff/types";
import { postgresAlterTypeUsing } from "../../schema/pipeline/sql-templates/postgres-alter-type-using";
import {
  relationStorageShape,
  type ColumnOrigin,
} from "../../schema/services/field-column-descriptor";

import {
  companionUniqueIndexChanges,
  companionUniqueIndexName,
  isTextKind,
  isUniqueField,
  type UniqueFieldLike,
} from "./companion-unique-indexes";
import { ddlType, q } from "./ddl-types";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { I18nTransitionKind } from "./transition-state";
import type { CompanionMigrationSpec, LocalizedColumnSpec } from "./types";

/** A translated field before a change and after it, under one name. */
export interface RetypedField {
  from: UniqueFieldLike;
  to: UniqueFieldLike;
}

export interface CompanionTypeChangePlan {
  /** Describes the retyped columns with their new types, and the fields they are of. */
  spec: CompanionMigrationSpec;
  upSql: string;
  downSql: string;
}

/** One column the file retypes, with its type on either side. */
interface Retyped {
  field: string;
  from: LocalizedColumnSpec;
  to: LocalizedColumnSpec;
  /** Unique within each language before the change and after it. */
  unique: boolean;
}

/**
 * The fields a change keeps per language before it and after it under one name, each as the
 * previous snapshot records it and as the change leaves it: those whose column the snapshot's table
 * keeps in its translations table (`localizedColumns`), on a table it records as translated. The
 * one question both `migrate:create`'s `retypes` plan and a save relying on that plan ask, so a
 * save never counts on a column's new type the file it writes does not carry. None where the
 * snapshot records no fields for the entity, or does not keep its table translated.
 */
export function fieldsTranslatedThrough(args: {
  /** The entity's main table as the previous snapshot records it. */
  previousTable:
    | { localized?: boolean; localizedColumns?: readonly string[] }
    | undefined;
  /** The entity's fields as the previous snapshot's settings record them. */
  recorded: unknown;
  next: readonly UniqueFieldLike[];
  /** Whether a field is kept per language after the change. */
  translatedAfter: (field: UniqueFieldLike) => boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): RetypedField[] {
  if (args.previousTable?.localized !== true) return [];
  if (!Array.isArray(args.recorded)) return [];
  const kept = new Set(args.previousTable.localizedColumns ?? []);
  // A recorded declaration's fields, as `settingsOf` keeps them: each one's name and type.
  const before = new Map(
    (args.recorded as UniqueFieldLike[]).map(field => [field.name, field])
  );
  return args.next.flatMap(to => {
    const from = before.get(to.name);
    if (from === undefined || !args.translatedAfter(to)) return [];
    const column = fieldToLocalizedColumnSpec(from, args.dialect, args.builtBy);
    // Translated before: its column is one the translations table kept.
    return column !== null && kept.has(column.name) ? [{ from, to }] : [];
  });
}

/**
 * The columns among `fields` whose type in the translations table differs on `dialect`, each with
 * its type on either side. A field the change leaves without a companion column on either side
 * (`fieldToLocalizedColumnSpec` gives none) has nothing here to retype.
 */
export function retypedCompanionColumns(args: {
  fields: readonly RetypedField[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): Retyped[] {
  return args.fields.flatMap(({ from, to }) => {
    // A relation switched between storage shapes (one id and a list of them, or to or from naming
    // several collections) has its translations column converted by the switch's own statements,
    // which carry or guard each value (`migrationCompanionSwitches`). A plain cast ahead of them
    // would meet an id where a list is wanted, so the switch is left to them.
    if (
      conversionBetweenShapes(
        relationStorageShape(from),
        relationStorageShape(to)
      ) !== undefined
    ) {
      return [];
    }
    const before = fieldToLocalizedColumnSpec(from, args.dialect, args.builtBy);
    const after = fieldToLocalizedColumnSpec(to, args.dialect, args.builtBy);
    if (before === null || after === null || before.name !== after.name) {
      return [];
    }
    if (ddlType(before, args.dialect) === ddlType(after, args.dialect)) {
      return [];
    }
    return [
      {
        field: to.name,
        from: before,
        to: after,
        unique: isUniqueField(from) && isUniqueField(to),
      },
    ];
  });
}

/**
 * The `retypes` file for `fields`, or undefined where none of their translations columns takes
 * another type on `dialect`.
 */
export function planCompanionTypeChange(args: {
  slug: string;
  kind: I18nTransitionKind;
  tableName: string;
  dialect: SupportedDialect;
  defaultLocale: string;
  fields: readonly RetypedField[];
  /** The column rule the entity's tables are made by: a Builder collection's is the Builder's. */
  builtBy: ColumnOrigin;
}): CompanionTypeChangePlan | undefined {
  const { dialect } = args;
  const companionTable = `${args.tableName}_locales`;
  const retyped = retypedCompanionColumns(args);
  if (retyped.length === 0) return undefined;
  const statements = (way: "up" | "down") =>
    retyped.flatMap(column =>
      columnStatements({
        companionTable,
        dialect,
        field: column.field,
        from: way === "up" ? column.from : column.to,
        to: way === "up" ? column.to : column.from,
        unique: column.unique,
      })
    );
  const asFile = (list: string[]) => list.map(s => `${s};`).join("\n\n");
  return {
    spec: {
      dialect,
      collection: args.slug,
      kind: args.kind,
      mainTable: args.tableName,
      companionTable,
      defaultLocale: args.defaultLocale,
      parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
      columns: retyped.map(column => column.to),
      retyped: retyped.map(column => ({
        field: column.field,
        column: column.to.name,
      })),
    },
    upSql: asFile(statements("up")),
    downSql: asFile(statements("down")),
  };
}

/** One column's change of type, with its per-language unique index around it where it has one. */
function columnStatements(args: {
  companionTable: string;
  dialect: SupportedDialect;
  field: string;
  from: LocalizedColumnSpec;
  to: LocalizedColumnSpec;
  unique: boolean;
}): string[] {
  const { companionTable, dialect, from, to } = args;
  const index = (spec: LocalizedColumnSpec, wanted: boolean) =>
    companionUniqueIndexChanges({
      dialect,
      companionTable,
      wanted: wanted
        ? [
            {
              field: args.field,
              column: spec.name,
              text: isTextKind(spec.kind),
              kind: spec.kind,
            },
          ]
        : [],
      translatedColumns: [spec.name],
      liveIndexNames: wanted
        ? new Set<string>()
        : new Set([companionUniqueIndexName(companionTable, spec.name)]),
    });
  return [
    ...(args.unique ? index(from, false).drops : []),
    ...retypeStatements(companionTable, from, to, dialect),
    ...(args.unique ? index(to, true).creates : []),
  ];
}

/** The statements that give one translations column another type, casting what it holds. */
function retypeStatements(
  companionTable: string,
  from: LocalizedColumnSpec,
  to: LocalizedColumnSpec,
  dialect: SupportedDialect
): string[] {
  const table = q(companionTable, dialect);
  const column = q(to.name, dialect);
  const toType = ddlType(to, dialect);
  if (dialect === "postgresql") {
    return [
      `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${toType} ${postgresAlterTypeUsing(column, ddlType(from, dialect), toType)}`,
    ];
  }
  if (dialect === "mysql") {
    // A translations column is nullable with no default, which is all MODIFY has to restate.
    return [`ALTER TABLE ${table} MODIFY COLUMN ${column} ${toType} NULL`];
  }
  // SQLite cannot change a column's type in place: a column of the new type takes the cast values
  // and the old one's name.
  const scratch = q(`__retype_${to.name}`, dialect);
  return [
    `ALTER TABLE ${table} ADD COLUMN ${scratch} ${toType}`,
    `UPDATE ${table} SET ${scratch} = CAST(${column} AS ${toType})`,
    `ALTER TABLE ${table} DROP COLUMN ${column}`,
    `ALTER TABLE ${table} RENAME COLUMN ${scratch} TO ${column}`,
  ];
}
