/**
 * A shared field that becomes translated while its entity stays translated.
 *
 * In a translated entity a shared field's value lives on the main table, and a translated field's
 * values live in the companion `<table>_locales`, one row per language. Making a shared field
 * translated adds its companion column and takes away its main column, so the value it held has to
 * move first: it becomes the default language's value. The other languages have none yet, and are
 * given none. One planner for every path that can make the change, so they cannot move it
 * differently.
 *
 * @module domains/i18n/migration/field-joins-translation
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnMovedToCompanion } from "../../schema/pipeline/moved-to-companion";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { isFieldLocalized } from "../classify-fields";

import { ddlType, q } from "./ddl-types";
import { deriveCompanionSpec } from "./derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  buildCompanionCreateOnlySql,
  buildDefaultLocaleRefreshStatements,
  buildMissingDefaultRowsInsert,
} from "./generate-up";
import {
  type FieldLeavesFile,
  planFieldLeavesTranslationMigration,
} from "./plan-field-leaves-migration";
import type { CompanionFieldLike } from "./reconcile-companion";
import type { CompanionMigrationSpec } from "./types";

/**
 * The fields of a translated entity that become translated in this change, having been shared
 * before it: shared in `oldFields`, translated in `newFields`. The mirror of
 * `fieldsLeavingTranslation`. A field added in the same change has no value to move and is not one
 * of them.
 */
export function fieldsJoiningTranslation(
  oldFields: readonly CompanionFieldLike[],
  newFields: readonly CompanionFieldLike[]
): string[] {
  const nowTranslated = new Set(
    newFields.filter(f => isFieldLocalized(f, true)).map(f => f.name)
  );
  return oldFields
    .filter(f => !isFieldLocalized(f, true) && nowTranslated.has(f.name))
    .map(f => f.name);
}

/** What moving the joining fields' values takes, and which fields they are. */
export interface FieldsJoiningTranslationPlan {
  /**
   * The fields whose companion columns these statements make: the joining fields, or, where they
   * create the companion, every translated field. The companion reconcile skips their ADD.
   */
  fields: string[];
  /** Whether these statements create the companion, which the reconcile then treats as existing. */
  createsCompanion: boolean;
  /** Their companion columns' names, for a caller that asks which the companion already has. */
  columns: string[];
  /**
   * Statements to run after the companion exists and before the main table loses the fields'
   * columns: each column added to the companion, the default language's rows created where an
   * entry has none, and every default-language row given the main row's value. Empty when no field
   * joins.
   */
  statements: string[];
}

/**
 * Plans moving the values of the fields joining translation into the default language's companion
 * rows.
 *
 * Safe to run again before the main table changes: the insert adds only missing rows and the
 * update writes the same values. The column's ADD is not, on any dialect, so a caller that runs it
 * against a database passes the companion's existing columns, and a column already there (added
 * by a run that stopped part-way, or by the unattended reconcile at boot) is not added twice.
 */
export function buildFieldsJoiningTranslationStatements(args: {
  /** The entity's slug, for the companion this may create. */
  slug: string;
  /** Its main table; the companion is `<tableName>_locales`. */
  tableName: string;
  dialect: SupportedDialect;
  /** Which builder made the main table, which decides a column's bounds. */
  builtBy: ColumnOrigin;
  /** The language whose companion rows take the shared value. */
  defaultLocale: string;
  oldFields: readonly CompanionFieldLike[];
  newFields: readonly CompanionFieldLike[];
  /**
   * Whether the main table has `status` and the companion `_status` (Draft/Published, before this
   * change), so a default-language row created here takes the entry's publishing state.
   */
  status: boolean;
  /**
   * Whether the entity has Draft/Published after this change, which decides whether a companion
   * created here has `_status`. Defaults to `status`.
   */
  companionStatus?: boolean;
  /**
   * Whether the companion exists. A joining field may be the entity's first translated one, and
   * then the companion is created here, with every translated field's column, before the values
   * move into it.
   */
  companionExists: boolean;
  /** The companion's columns as they are now, when the caller has asked; omitted, every column is added. */
  companionColumns?: ReadonlySet<string>;
}): FieldsJoiningTranslationPlan {
  const joining = new Set(
    fieldsJoiningTranslation(args.oldFields, args.newFields)
  );
  const none = {
    fields: [],
    columns: [],
    createsCompanion: false,
    statements: [],
  };
  if (joining.size === 0) return none;

  const companionTable = `${args.tableName}_locales`;
  const columns = args.newFields
    .filter(f => joining.has(f.name))
    .flatMap(f => {
      const column = fieldToLocalizedColumnSpec(f, args.dialect, args.builtBy);
      return column ? [column] : [];
    });
  if (columns.length === 0) return none;

  const ref = {
    dialect: args.dialect,
    mainTable: args.tableName,
    companionTable,
    defaultLocale: args.defaultLocale,
  };
  const names = columns.map(c => c.name);
  const copy = [
    buildMissingDefaultRowsInsert(ref, names, {
      status: args.status && (args.companionStatus ?? args.status),
    }),
    // Existing rows keep their own publishing state: only the values move.
    ...buildDefaultLocaleRefreshStatements(ref, names),
  ];

  if (!args.companionExists) {
    const spec = deriveCompanionSpec({
      slug: args.slug,
      dbName: args.tableName,
      fields: [...args.newFields],
      dialect: args.dialect,
      defaultLocale: args.defaultLocale,
      collectionLocalized: true,
      status: args.companionStatus ?? args.status,
      builtBy: args.builtBy,
    });
    if (!spec) return none;
    return {
      fields: args.newFields
        .filter(f => isFieldLocalized(f, true))
        .map(f => f.name),
      columns: names,
      createsCompanion: true,
      statements: [
        // The file form, which a run that stopped part-way can repeat: the reconcile that follows
        // treats the companion as existing and does not create it again.
        buildCompanionCreateOnlySql(spec, { emittedToFile: true }).replace(
          /;\s*$/,
          ""
        ),
        ...copy,
      ],
    };
  }

  return {
    fields: [...joining],
    columns: names,
    createsCompanion: false,
    statements: [
      ...columns
        .filter(c => !args.companionColumns?.has(c.name))
        .map(
          c =>
            `ALTER TABLE ${q(companionTable, args.dialect)} ADD COLUMN ${q(c.name, args.dialect)} ${ddlType(c, args.dialect)}`
        ),
      ...copy,
    ],
  };
}

/**
 * The `joins` file `nextly migrate:create` writes for shared fields that become translated while
 * their entity stays translated. It runs before the main migration, which drops the fields' main
 * columns, and its DOWN runs after the main migration's DOWN has put them back.
 *
 * - UP adds each field's companion column and gives every entry's default-language row the main
 *   table's value (`buildFieldsJoiningTranslationStatements`), creating the row where an entry has
 *   none. The other languages are given no value they never had.
 * - DOWN is a field leaving translation, so it is that move's own statements
 *   (`planFieldLeavesTranslationMigration`): the other languages' values archived, the default
 *   language's copied back onto the main column, and the companion column dropped.
 *
 * `spec.columns` are the joining fields' companion columns; `oldFields` and `newFields` are the
 * entity's fields before and after, which say which fields join.
 */
export function planFieldJoinsTranslationMigration(args: {
  spec: CompanionMigrationSpec;
  builtBy: ColumnOrigin;
  oldFields: readonly CompanionFieldLike[];
  newFields: readonly CompanionFieldLike[];
  /**
   * Whether the companion exists before this file runs, as the migrations up to it left it: a
   * translated entity whose every field was shared has none, and the file then creates it.
   */
  companionExists: boolean;
  /**
   * Statements that make the restored main columns required again, run last on the way DOWN,
   * once the default language's values are back in them. The main migration's DOWN re-adds them
   * nullable, since rows hold no value at that point.
   */
  restoreRequired?: readonly string[];
}): FieldLeavesFile {
  const { spec } = args;
  const up = buildFieldsJoiningTranslationStatements({
    slug: spec.collection,
    tableName: spec.mainTable,
    dialect: spec.dialect,
    builtBy: args.builtBy,
    defaultLocale: spec.defaultLocale,
    oldFields: args.oldFields,
    newFields: args.newFields,
    status: spec.status === true,
    companionExists: args.companionExists,
  });
  const leaving = planFieldLeavesTranslationMigration(spec);
  const down = [
    leaving.archive.upSql,
    leaving.shared.upSql,
    // A companion this file created goes with it, leaving the database as the file found it.
    ...(up.createsCompanion
      ? [`DROP TABLE IF EXISTS ${q(spec.companionTable, spec.dialect)};`]
      : []),
    // Last, with every value back: a column made required while one is missing fails loudly here,
    // nullable and holding what came back, rather than dropping anything.
    ...(args.restoreRequired ?? []).map(s =>
      s.trim().endsWith(";") ? s : `${s};`
    ),
  ];
  return {
    upSql: up.statements.map(s => `${s};`).join("\n\n"),
    downSql: down.filter(part => part.trim().length > 0).join("\n\n"),
    spec,
  };
}

/** What one schema apply moves to the companions, and the statements that move it. */
export interface JoiningMovesForApply {
  /** The main-table columns whose values move; their drops are neither renames nor losses. */
  moved: (ColumnMovedToCompanion & { fieldName: string })[];
  /** The moves, to run before any drop, and after every refusal. */
  statements: string[];
}

/** An entity a schema apply describes, as the moves need it. */
interface ApplyEntity {
  slug: string;
  tableName: string;
  fields: readonly CompanionFieldLike[];
  localized?: boolean;
  status?: boolean;
  builderOwned?: boolean;
}

/**
 * The fields a schema apply makes translated, and how their values move, read from the apply
 * itself: a translated field of a translated entity whose main column the diff drops still holds
 * the field's value, which is moved to the default language's companion row before the drop.
 *
 * One answer for every caller of the apply (the Schema Builder's dialogs, and code-first sync at
 * `next dev`, on reload and in `db:sync`), drawn from the live tables: a column the diff does not
 * drop has nothing left to move, so an apply repeated after one that already moved and dropped it
 * plans nothing. A field that no statement here moves is not reported as moved, so its drop stays
 * one the apply asks about.
 */
export async function planJoiningMovesForApply(args: {
  desired: {
    collections: Record<string, ApplyEntity>;
    singles: Record<string, ApplyEntity>;
    components: Record<string, ApplyEntity>;
  };
  /** The diff's operations; the moved columns are among its drops. */
  operations: readonly {
    type: string;
    tableName?: string;
    columnName?: string;
  }[];
  db: unknown;
  dialect: SupportedDialect;
  defaultLocale: string;
}): Promise<JoiningMovesForApply> {
  const { builtByFor } = await import(
    "../../schema/pipeline/registered-collections"
  );
  const dropped = new Set(
    args.operations
      .filter(op => op.type === "drop_column")
      .map(op => `${op.tableName}::${op.columnName}`)
  );
  const entities = [
    ...Object.values(args.desired.collections).map(e => ({
      e,
      builtBy: builtByFor("collection", e.builderOwned),
    })),
    ...Object.values(args.desired.singles).map(e => ({
      e,
      builtBy: builtByFor("single", e.builderOwned),
    })),
    ...Object.values(args.desired.components).map(e => ({
      e,
      builtBy: builtByFor("fieldGroup", e.builderOwned),
      // A field group's row columns are described by their own rule, as its table is built.
      rowColumns: true,
    })),
  ];
  const result: JoiningMovesForApply = { moved: [], statements: [] };
  for (const entry of entities) {
    const { e, builtBy } = entry;
    if (e.localized !== true) continue;
    const joining = e.fields.flatMap(f => {
      if (!isFieldLocalized(f, true)) return [];
      const column = fieldToLocalizedColumnSpec(f, args.dialect, builtBy);
      return column && dropped.has(`${e.tableName}::${column.name}`)
        ? [{ field: f.name, column: column.name }]
        : [];
    });
    if (joining.length === 0) continue;
    await refuseReshapedJoins(e, builtBy, "rowColumns" in entry, joining, args);
    const plan = await planEntityMove(e, builtBy, joining, args);
    if (plan.statements.length === 0) continue;
    result.statements.push(...plan.statements);
    result.moved.push(
      ...joining
        .filter(j => plan.fields.includes(j.field))
        .map(j => ({
          tableName: e.tableName,
          columnName: j.column,
          fieldName: j.field,
        }))
    );
  }
  return result;
}

/**
 * Refuses a field that becomes translated in the same change that changes how it is stored, before
 * anything runs: its value would be copied as it is into a companion column of the new shape,
 * which PostgreSQL refuses part-way and MySQL and SQLite coerce or cut. The Builder's paths and
 * `migrate:create` refuse this from the entity's previous fields; a code-first apply has only the
 * desired schema, so the live main column is compared with the column the field would have if it
 * stayed shared, by the diff's own rule (`typesDiffer`).
 */
async function refuseReshapedJoins(
  e: ApplyEntity,
  builtBy: ColumnOrigin,
  rowColumns: boolean,
  joining: readonly { field: string; column: string }[],
  args: { db: unknown; dialect: SupportedDialect }
): Promise<void> {
  const [
    { introspectLiveSnapshot },
    { typesDiffer },
    { getColumnDescriptor, getComponentRowColumnDescriptor },
    { refusalsForFieldsJoiningTranslation },
    { NextlyError },
  ] = await Promise.all([
    import("../../schema/pipeline/diff/introspect-live"),
    import("../../schema/pipeline/diff/declared-size"),
    import("../../schema/services/field-column-descriptor"),
    import("./field-leaves-translation-rules"),
    import("../../../errors/nextly-error"),
  ]);
  const live = (
    await introspectLiveSnapshot(args.db, args.dialect, [e.tableName])
  ).tables.find(t => t.name === e.tableName);
  const describe = rowColumns
    ? getComponentRowColumnDescriptor
    : getColumnDescriptor;
  const reshaped = joining.filter(j => {
    const column = live?.columns.find(c => c.name === j.column);
    const field = e.fields.find(f => f.name === j.field);
    const shared = field
      ? describe(
          { ...field, localized: false } as unknown as Parameters<
            typeof describe
          >[0],
          args.dialect,
          builtBy
        )
      : null;
    return (
      column !== undefined &&
      shared !== null &&
      // The column the field would have, from its descriptor alone: PostgreSQL and MySQL report a
      // live column's length or precision apart from its type, and keeping that beside the new
      // type would compare the old bound with itself.
      typesDiffer(column, {
        name: column.name,
        type: shared.dialectType,
        nullable: column.nullable,
      })
    );
  });
  if (reshaped.length === 0) return;
  const refusals = refusalsForFieldsJoiningTranslation({
    reshaped: reshaped.map(j => j.field),
    surface: builtBy === "codeFirst" ? "code" : "builder",
  });
  throw NextlyError.validation({
    errors: refusals,
    logContext: { entity: e.slug, fields: refusals.map(r => r.path) },
  });
}

/** One entity's move, planned against its companion as it is now. */
async function planEntityMove(
  e: ApplyEntity,
  builtBy: ColumnOrigin,
  joining: readonly { field: string; column: string }[],
  args: { db: unknown; dialect: SupportedDialect; defaultLocale: string }
): Promise<FieldsJoiningTranslationPlan> {
  const { introspectLiveSnapshot } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const companionTable = `${e.tableName}_locales`;
  const snapshot = await introspectLiveSnapshot(args.db, args.dialect, [
    e.tableName,
    companionTable,
  ]);
  const columnsOf = (table: string) =>
    snapshot.tables.find(t => t.name === table)?.columns.map(c => c.name);
  const onMain = new Set(columnsOf(e.tableName) ?? []);
  const companionColumns = columnsOf(companionTable);
  const onCompanion = new Set(companionColumns ?? []);
  const names = new Set(joining.map(j => j.field));
  // The move takes a companion column already there as the field's and copies into it, so one
  // that cannot hold the field's values is refused first, before the push drops the main column.
  const { companionColumnsThatCannotHold } = await import(
    "./companion-column-holds"
  );
  const cannotHold = companionColumnsThatCannotHold({
    fields: e.fields.filter(f => names.has(f.name)),
    live: snapshot.tables.find(t => t.name === companionTable)?.columns ?? [],
    dialect: args.dialect,
    builtBy,
    surface: builtBy === "codeFirst" ? "code" : "builder",
  });
  if (cannotHold.length > 0) {
    const { NextlyError } = await import("../../../errors/nextly-error");
    throw NextlyError.validation({
      errors: cannotHold.map(c => c.refusal),
      logContext: {
        entity: e.slug,
        companionTable,
        columns: cannotHold.map(c => c.columns),
        // A command line prints the context, not the per-field errors, so the way on goes here too.
        reasons: cannotHold.map(c => c.refusal.message),
      },
    });
  }
  return buildFieldsJoiningTranslationStatements({
    slug: e.slug,
    tableName: e.tableName,
    dialect: args.dialect,
    builtBy,
    defaultLocale: args.defaultLocale,
    // The fields as they are on the live main table: the joining ones still shared there.
    oldFields: e.fields.map(f =>
      names.has(f.name) ? { ...f, localized: false } : f
    ),
    newFields: e.fields,
    // A companion created here has `_status` when the entity has Draft/Published, so the
    // default-language rows it gets take each entry's publishing state.
    status:
      onMain.has("status") &&
      (companionColumns === undefined
        ? e.status === true
        : onCompanion.has("_status")),
    companionStatus: e.status === true,
    companionExists: companionColumns !== undefined,
    companionColumns: onCompanion,
  });
}
