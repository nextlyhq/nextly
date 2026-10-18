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
import type { CompanionFieldLike } from "./reconcile-companion";

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

/**
 * The main-table columns a change moves to the companion: each joining field's column, which the
 * companion names as the main table does. The push still drops them from main, and is told they
 * moved so it neither offers them as renames nor asks to confirm their loss. Nothing unless the
 * entity is translated before and after the change.
 */
export function columnsMovingToCompanion(args: {
  tableName: string;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  oldFields: readonly CompanionFieldLike[];
  newFields: readonly CompanionFieldLike[];
  wasLocalized: boolean;
  isLocalized: boolean;
}): ColumnMovedToCompanion[] {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const joining = new Set(
    fieldsJoiningTranslation(args.oldFields, args.newFields)
  );
  return args.oldFields
    .filter(f => joining.has(f.name))
    .flatMap(f => {
      const column = fieldToLocalizedColumnSpec(f, args.dialect, args.builtBy);
      return column
        ? [{ tableName: args.tableName, columnName: column.name }]
        : [];
    });
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
