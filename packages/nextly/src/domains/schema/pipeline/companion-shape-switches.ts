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

import { NextlyError } from "../../../errors/nextly-error";
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

import { introspectLiveSnapshot } from "./diff/introspect-live";
import type {
  ChangeColumnTypeOp,
  NextlySchemaSnapshot,
  TableSpec,
} from "./diff/types";
import { conversionBetweenShapes } from "./diff/types";
import { relationEntities, type RelationEntity } from "./recorded-shapes";
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
interface CompanionSwitchArgs {
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
function companionShapeSwitchOps(
  args: CompanionSwitchArgs
): ChangeColumnTypeOp[] {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const before = translatedByName(args.oldFields, args.wasLocalized);
  const after = translatedByName(args.newFields, args.isLocalized);
  return [...after].flatMap(([name, now]) => {
    const was = before.get(name);
    return was === undefined ? [] : companionFieldOps(args, name, was, now);
  });
}

/** One translated field's operations on the companion (`companionShapeSwitchOps`). */
function companionFieldOps(
  args: CompanionSwitchArgs,
  name: string,
  was: FieldShape,
  now: FieldShape
): ChangeColumnTypeOp[] {
  const conversion = conversionBetweenShapes(
    relationStorageShape(was, args.component),
    relationStorageShape(now, args.component)
  );
  const fromType = columnTypeOf(was, args);
  const toType = columnTypeOf(now, args);
  if (conversion === undefined || !fromType || !toType) return [];
  const base = {
    type: "change_column_type" as const,
    tableName: `${args.tableName}_locales`,
    columnName: toSnakeCase(name),
  };
  if (conversion !== "requireEmpty") {
    return [{ ...base, fromType, toType, conversion }];
  }
  return [
    { ...base, fromType, toType: fromType, conversion },
    ...(fromType === toType ? [] : [{ ...base, fromType, toType }]),
  ];
}

/**
 * The companion operations an apply of `desired` makes, for every entity whose save states what
 * its fields were (`recordedFields`): the ones its refusals count rows for before anything runs.
 */
function desiredCompanionSwitchOps(
  desired: DesiredSchema,
  dialect: SupportedDialect
): ChangeColumnTypeOp[] {
  return relationEntities(desired).flatMap(({ entity, kind }) =>
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
function companionSwitchStatements(
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
  refuseMigratedSwitchesMovingTable(args, byKind);
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

/**
 * Refuses, as the apply does (`relationSwitches`), a relation switched between storage shapes in
 * the same change that makes its field translated or stops translating it: the migration's move
 * between the main table and the companion copies the value in the shape it no longer has.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_SWITCH_WITH_TRANSLATION`) naming each such field
 */
function refuseMigratedSwitchesMovingTable(
  args: {
    entities: readonly MigrationEntity[];
    previous: PreviousEntityRecords | null | undefined;
  },
  byKind: Record<MigrationEntity["kind"], keyof PreviousEntityRecords>
): void {
  const errors = args.entities.flatMap(({ kind, entity }) => {
    const record = args.previous?.[byKind[kind]][entity.slug];
    const oldFields = record?.settings.fields;
    if (record === undefined || !Array.isArray(oldFields)) return [];
    const translatedBefore = translatedByName(
      oldFields,
      storesPerLanguage({ localized: record.settings.localized })
    );
    const translatedAfter = translatedByName(
      entity.fields,
      storesPerLanguage(entity)
    );
    return switchedRelationFields(
      entity.fields,
      oldFields,
      kind === "fieldGroup"
    )
      .filter(name => translatedBefore.has(name) !== translatedAfter.has(name))
      .map(name => ({
        path: `fields.${name}`,
        code: "RELATIONSHIP_SWITCH_WITH_TRANSLATION",
        message:
          `'${entity.slug}': field '${name}' cannot change how its related entries are stored in ` +
          `the same change that ${translatedAfter.has(name) ? "makes it translated" : "stops translating it"}. ` +
          `Make the two changes one at a time.`,
      }));
  });
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-switch-with-translation" },
  });
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

/** What `relationSwitches` reads: the change, and the tables before and after it. */
export interface RelationSwitchArgs {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  /** The managed tables as they stand. */
  live: NextlySchemaSnapshot;
  /** The tables the change leaves, as the diff compares them. */
  desiredSnapshot: NextlySchemaSnapshot;
}

/**
 * A change's relation switches beyond what the main tables' diff plans from the same rule: the
 * operations on each translated relation's companion that exists, with those companions as they
 * stand, so the preview, the confirmation, the refusals and the apply all read one set.
 *
 * Refuses, before anything runs, a switch made in the same change that moves the field between
 * its entity's main table and its companion (it starts or stops being translated): the move copies
 * the value as it is, in the shape it no longer has.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_SWITCH_WITH_TRANSLATION`) naming each such field
 */
export async function relationSwitches(
  args: RelationSwitchArgs
): Promise<{ ops: ChangeColumnTypeOp[]; tables: TableSpec[] }> {
  refuseSwitchesMovingTable(args);
  const ops = desiredCompanionSwitchOps(args.desired, args.dialect);
  if (ops.length === 0) return { ops: [], tables: [] };
  const names = [...new Set(ops.map(op => op.tableName))];
  const { tables } = await introspectLiveSnapshot(args.db, args.dialect, names);
  const present = new Set(tables.map(table => table.name.toLowerCase()));
  return {
    ops: ops.filter(op => present.has(op.tableName.toLowerCase())),
    tables,
  };
}

/** Whether `snapshot` holds a column `column` on table `table`. */
function holdsColumn(
  snapshot: NextlySchemaSnapshot,
  table: string,
  column: string
): boolean | undefined {
  const spec = snapshot.tables.find(
    t => t.name.toLowerCase() === table.toLowerCase()
  );
  if (spec === undefined) return undefined;
  return spec.columns.some(c => c.name.toLowerCase() === column.toLowerCase());
}

/**
 * The refusal of `name`'s switch when the change also moves its column to or from the companion:
 * on the main table before and not after, or the other way. Undefined where it stays put, or where
 * the main table is not on both sides.
 */
function movingSwitchRefusal(
  args: RelationSwitchArgs,
  { entity, label }: RelationEntity,
  name: string
): { path: string; code: string; message: string } | undefined {
  const column = toSnakeCase(name);
  const onMainBefore = holdsColumn(args.live, entity.tableName, column);
  const onMainAfter = holdsColumn(
    args.desiredSnapshot,
    entity.tableName,
    column
  );
  if (onMainBefore === undefined || onMainAfter === undefined) return undefined;
  if (onMainBefore === onMainAfter) return undefined;
  return {
    path: `fields.${name}`,
    code: "RELATIONSHIP_SWITCH_WITH_TRANSLATION",
    message:
      `${label} '${entity.slug}': field '${name}' cannot change how its related entries are ` +
      `stored in the same change that ${onMainAfter ? "stops translating it" : "makes it translated"}. ` +
      `Make the two changes one at a time.`,
  };
}

function refuseSwitchesMovingTable(args: RelationSwitchArgs): void {
  const errors = relationEntities(args.desired).flatMap(each =>
    each.entity.recordedFields === undefined
      ? []
      : switchedRelationFields(
          each.entity.fields,
          each.entity.recordedFields,
          each.component
        ).flatMap(name => movingSwitchRefusal(args, each, name) ?? [])
  );
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-switch-with-translation" },
  });
}

/**
 * The names of the fields among `fields` whose relation switches storage shape from what
 * `recordedFields` stored (`conversionBetweenShapes`).
 */
function switchedRelationFields(
  fields: readonly unknown[],
  recordedFields: readonly unknown[],
  component: boolean
): string[] {
  const before = new Map(
    (recordedFields as readonly FieldShape[]).flatMap(f =>
      typeof f.name === "string" ? [[f.name, f] as const] : []
    )
  );
  return (fields as readonly FieldShape[]).flatMap(field => {
    if (typeof field.name !== "string") return [];
    const was = before.get(field.name);
    return was !== undefined &&
      conversionBetweenShapes(
        relationStorageShape(was, component),
        relationStorageShape(field, component)
      ) !== undefined
      ? [field.name]
      : [];
  });
}

/**
 * Whether `desired` switches any relation's storage shape from what its recorded fields stored, on
 * a main table, a field group or a companion alike: a change to apply even where no column's type
 * shows it (SQLite keeps every shape as text, and a translated relation's column is on its
 * companion, which the main tables' diff does not read).
 */
export function hasRelationSwitches(
  desired: Pick<DesiredSchema, "collections" | "singles" | "components">
): boolean {
  return relationEntities(desired).some(
    ({ entity, component }) =>
      entity.recordedFields !== undefined &&
      switchedRelationFields(entity.fields, entity.recordedFields, component)
        .length > 0
  );
}

/**
 * Refuses a field-group relation switched between storage shapes on a road that cannot convert
 * it: `db:sync` adds an existing field group's missing columns and never changes one, so the rows
 * would keep the shape the registry no longer records. Names the field and the roads that do.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_SWITCH_NOT_CARRIED`) naming each such field
 */
export function refuseFieldGroupSwitches(
  rows: readonly { slug?: unknown; fields?: unknown }[],
  fieldGroups: readonly { slug: string; fields: readonly unknown[] }[]
): void {
  const recorded = new Map(
    rows.flatMap(row =>
      typeof row.slug === "string" && Array.isArray(row.fields)
        ? [[row.slug, row.fields as unknown[]] as const]
        : []
    )
  );
  const errors = fieldGroups.flatMap(group => {
    const before = recorded.get(group.slug);
    if (before === undefined) return [];
    return switchedRelationFields(group.fields, before, true).map(field => ({
      path: `fields.${field}`,
      code: "RELATIONSHIP_SWITCH_NOT_CARRIED",
      message:
        `Field group '${group.slug}': field '${field}' changes how its related entries are ` +
        `stored, which \`db:sync\` cannot convert on an existing field group. Apply it with a ` +
        `Schema Builder save, a configuration reload under \`next dev\`, or a migration from ` +
        `\`migrate:create\`.`,
    }));
  });
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-switch-not-carried" },
  });
}
