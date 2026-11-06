/**
 * A translated relation switched between storage shapes, on the translations (`_locales`) table
 * that holds its values.
 *
 * A field translated per language keeps its value in the entity's companion table, not on the main
 * table, so the schema push, which leaves companions to the localization layer, plans nothing for
 * it. The switch is the same as on a main table, though, and is judged by the same rule
 * (`conversionBetweenShapes`): one id and a list of them convert into each other, and a switch to
 * or from naming several collections requires the column empty. So the companion's column gets
 * the same operations, derived here once, for the three places that need them: the apply's
 * refusals, which count its rows before any DDL; the companion reconcile, which runs them after
 * the main table's apply; and a generated migration, which carries them.
 *
 * @module domains/schema/pipeline/companion-shape-switches
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import {
  type ColumnOrigin,
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  relationStorageShape,
  toSnakeCase,
} from "../services/field-column-descriptor";

import type { ChangeColumnTypeOp } from "./diff/types";
import { conversionBetweenShapes } from "./diff/types";
import { referenceConversionStatements } from "./reference-list-conversion";
import { builtByFor } from "./registered-collections";
import { generateSQL } from "./sql-templates";
import type { DesiredSchema } from "./types";

interface FieldShape {
  name?: unknown;
  type?: unknown;
  hasMany?: unknown;
  relationTo?: unknown;
  options?: unknown;
  localized?: unknown;
}

/** One entity's companion and the fields before and after a change. */
export interface CompanionSwitchArgs {
  /** The entity's main table; its companion is `<tableName>_locales`. */
  tableName: string;
  oldFields: readonly unknown[];
  newFields: readonly unknown[];
  /** Whether the entity keeps translated fields per language, before and after. */
  wasLocalized: boolean;
  isLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  /** A field group's row, where a many-to-many keeps its list. */
  component?: boolean;
}

/** The type a field's companion column has, as the main table's builder would make it. */
function columnTypeOf(
  field: FieldShape,
  args: CompanionSwitchArgs
): string | undefined {
  const describe = args.component
    ? getComponentRowColumnDescriptor
    : getColumnDescriptor;
  return (
    describe(field as unknown as FieldDefinition, args.dialect, args.builtBy) ??
    undefined
  )?.dialectType;
}

/** The fields translated per language, by name. */
function translatedByName(
  fields: readonly unknown[],
  localized: boolean
): Map<string, FieldShape> {
  const shaped = fields as readonly FieldShape[];
  const names = new Set(
    resolveLocalizedFieldNames(
      shaped.filter(f => typeof f.name === "string") as Parameters<
        typeof resolveLocalizedFieldNames
      >[0],
      localized
    )
  );
  return new Map(
    shaped.flatMap(f =>
      typeof f.name === "string" && names.has(f.name) ? [[f.name, f]] : []
    )
  );
}

/**
 * The operations a change makes on the companion's columns of translated relations whose shape it
 * switches: a conversion between one id and a list, or a guard requiring the column empty followed
 * by the plain retype the new shape needs. Only for a field translated both before and after: one
 * that joins or leaves translation moves its values between tables, which the localization layer
 * does. Each operation names the companion table.
 */
export function companionShapeSwitchOps(
  args: CompanionSwitchArgs
): ChangeColumnTypeOp[] {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const before = translatedByName(args.oldFields, args.wasLocalized);
  const after = translatedByName(args.newFields, args.isLocalized);
  const tableName = `${args.tableName}_locales`;
  const ops: ChangeColumnTypeOp[] = [];
  for (const [name, now] of after) {
    const was = before.get(name);
    if (was === undefined) continue;
    const conversion = conversionBetweenShapes(
      relationStorageShape(was, args.component),
      relationStorageShape(now, args.component)
    );
    const fromType = columnTypeOf(was, args);
    const toType = columnTypeOf(now, args);
    if (conversion === undefined || !fromType || !toType) continue;
    const columnName = toSnakeCase(name);
    const base = { type: "change_column_type" as const, tableName, columnName };
    if (conversion === "requireEmpty") {
      ops.push({ ...base, fromType, toType: fromType, conversion });
      if (fromType !== toType) ops.push({ ...base, fromType, toType });
      continue;
    }
    ops.push({ ...base, fromType, toType, conversion });
  }
  return ops;
}

/**
 * The companion operations an apply of `desired` makes, for every entity whose save states what
 * its fields were (`recordedFields`): the ones its refusals count rows for before anything runs.
 */
export function desiredCompanionSwitchOps(
  desired: DesiredSchema,
  dialect: SupportedDialect
): ChangeColumnTypeOp[] {
  const entities = [
    ...Object.values(desired.collections).map(e => [e, "collection"] as const),
    ...Object.values(desired.singles).map(e => [e, "single"] as const),
    ...Object.values(desired.components).map(e => [e, "fieldGroup"] as const),
  ];
  return entities.flatMap(([entity, kind]) =>
    entity.recordedFields === undefined
      ? []
      : companionShapeSwitchOps({
          tableName: entity.tableName,
          oldFields: entity.recordedFields,
          newFields: entity.fields,
          // What the entity was is not recorded beside its fields; a change of translation is the
          // localization layer's, and companions only exist while it stores per language.
          wasLocalized: storesPerLanguage(entity),
          isLocalized: storesPerLanguage(entity),
          dialect,
          builtBy: builtByFor(kind, entity.builderOwned),
          component: kind === "fieldGroup",
        })
  );
}

/** The statements that carry `ops` out, in order, as a migration file or the reconcile runs them. */
export function companionSwitchStatements(
  ops: readonly ChangeColumnTypeOp[],
  dialect: SupportedDialect
): string[] {
  // Every guard first: a refusal after any statement has run would leave a dialect that commits
  // each statement half-changed.
  const guards = ops.filter(op => op.conversion === "requireEmpty");
  const rest = ops.filter(op => op.conversion !== "requireEmpty");
  return [...guards, ...rest].flatMap(op =>
    op.conversion === undefined
      ? [generateSQL(op, dialect)]
      : referenceConversionStatements(op, dialect)
  );
}

/** An entity a migration describes: its kind, table, fields and translation setting. */
interface MigrationEntity {
  kind: "collection" | "single" | "fieldGroup";
  entity: {
    slug: string;
    tableName: string;
    fields: readonly unknown[];
    localized?: boolean;
  };
}

/** The previous snapshot's record of each entity's declaration, by kind and slug. */
interface PreviousEntityRecords {
  collections: Record<
    string,
    { source: string; settings: Record<string, unknown> }
  >;
  singles: Record<
    string,
    { source: string; settings: Record<string, unknown> }
  >;
  fieldGroups: Record<
    string,
    { source: string; settings: Record<string, unknown> }
  >;
}

/** A migration's companion statements: guards to lead the file, the rest to follow its DDL. */
export interface MigrationCompanionSwitches {
  up: { guards: string[]; rest: string[] };
  down: { guards: string[]; rest: string[] };
}

/**
 * The companion statements a generated migration carries for each translated relation whose shape
 * changed since the previous snapshot, read from that snapshot's record of each entity's fields.
 * Without such a record (a snapshot written before settings were recorded) nothing is planned, as
 * before. Guards lead both the UP and the DOWN; conversions follow the rest of the file.
 */
export function migrationCompanionSwitches(args: {
  entities: readonly MigrationEntity[];
  previous: PreviousEntityRecords | null | undefined;
  dialect: SupportedDialect;
}): MigrationCompanionSwitches {
  const byKind = {
    collection: "collections",
    single: "singles",
    fieldGroup: "fieldGroups",
  } as const;
  const ops = args.entities.flatMap(({ kind, entity }) => {
    const record = args.previous?.[byKind[kind]][entity.slug];
    const oldFields = record?.settings.fields;
    if (record === undefined || !Array.isArray(oldFields)) return [];
    return companionShapeSwitchOps({
      tableName: entity.tableName,
      oldFields,
      newFields: entity.fields,
      wasLocalized: storesPerLanguage({ localized: record.settings.localized }),
      isLocalized: storesPerLanguage(entity),
      dialect: args.dialect,
      builtBy: builtByFor(kind, record.source === "builder"),
      component: kind === "fieldGroup",
    });
  });
  const split = (list: readonly ChangeColumnTypeOp[]) => ({
    guards: companionSwitchStatements(
      list.filter(op => op.conversion === "requireEmpty"),
      args.dialect
    ),
    rest: companionSwitchStatements(
      list.filter(op => op.conversion !== "requireEmpty"),
      args.dialect
    ),
  });
  return { up: split(ops), down: split(inverseCompanionOps(ops)) };
}

/** `ops` undone, last first: each conversion the other way, and each guard again. */
function inverseCompanionOps(
  ops: readonly ChangeColumnTypeOp[]
): ChangeColumnTypeOp[] {
  const back = {
    referenceList: "referenceScalar",
    referenceScalar: "referenceList",
    requireEmpty: "requireEmpty",
  } as const;
  return [...ops].reverse().map(op => ({
    ...op,
    fromType: op.toType,
    toType: op.fromType,
    ...(op.conversion === undefined ? {} : { conversion: back[op.conversion] }),
  }));
}
