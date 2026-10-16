/**
 * Before a schema change makes a translated field shared, refuse what cannot move and archive what
 * will.
 *
 * A field that stops being translated keeps its other languages' values only because they are
 * written to `nextly_i18n_archive` before its companion column is dropped. That write happens here,
 * before the change alters anything: no main-table ALTER, no registry write, no companion DDL. An
 * archive that refuses the real values (a missing table, a drifted column) therefore stops the
 * change while nothing has moved, and the refusal says so.
 *
 * @module domains/i18n/migration/archive-preflight
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../../schemas/nextly-i18n-archive/ddl";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  buildLeavingFieldsArchiveStatements,
  type CompanionFieldLike,
  fieldsLeavingTranslation,
} from "./reconcile-companion";

/**
 * Creates the archive table when it is missing, then runs the given archive writes.
 *
 * @throws NextlyError `NEXTLY_MIGRATION_APPLY_FAILED` when the table cannot be created or a write
 *   is refused, before anything else has changed
 */
async function writeArchiveFirst(
  adapter: DrizzleAdapter,
  entity: string,
  writes: readonly string[]
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  try {
    for (const statement of getI18nArchiveDdl(dialect)) {
      await adapter.executeQuery(statement);
    }
    // MySQL's table DDL cannot restore an index the table is missing; the repair is tolerated
    // when the index is already there, as the schema executor tolerates it.
    const indexRepair = getI18nArchiveIndexRepairDdl(dialect);
    if (indexRepair) {
      try {
        await adapter.executeQuery(indexRepair);
      } catch (error) {
        if (!isIdempotencyError(error)) throw error;
      }
    }
    for (const statement of writes) {
      await adapter.executeQuery(statement);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage:
        "The localization archive could not be written, so nothing was changed. " +
        "A field that stops being translated keeps its other languages' values there.",
      logMessage: `localization archive not writable: ${reason}`,
      logContext: { entity },
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/** A field as a schema change describes it, with the flags the preflight reads. */
type LeavingFieldLike = CompanionFieldLike & {
  required?: boolean;
  unique?: boolean;
};

/**
 * The settings a field cannot carry while it stops being translated, as the Schema Builder names
 * them.
 */
function constraintsOf(field: LeavingFieldLike): string[] {
  return [
    ...(field.required === true ? ["Required"] : []),
    ...(field.unique === true ? ["Unique"] : []),
  ];
}

/**
 * The first step of every schema change that can make a translated field shared, taken before the
 * change alters anything. It is one call so the collection save, the collection, Single and
 * field-group schema dialogs and the Single save cannot answer it differently.
 *
 * Two things are refused:
 * - A field whose storage changes in the same edit: its type (text becoming a number) or its
 *   bounds (a shorter maximum length, a smaller precision). Its values are copied into the shared
 *   column as they are, without the conversion and confirmation such a change goes through on its
 *   own, so one the new column cannot hold would fail part-way, be truncated, or be kept against
 *   the field's new rules.
 * - A required or unique field. Its shared column is created, and its constraints checked, before
 *   the default language's values are copied into it, so at that moment every existing row holds
 *   the same placeholder or none. A required column then has nothing valid to hold (each dialect
 *   and path fails differently), and a unique one fails its check part-way through the change.
 *
 * Then every non-default language's value of each leaving field is written to the archive. The
 * writes are safe to repeat, so the companion transition that later drops the column, and a
 * migration file replayed elsewhere, can make them again without adding rows. Should a later step
 * of the change be refused, the rows written here are copies of values that are still in place.
 *
 * Nothing is asked when no field leaves translation, or when the entity is not translated before
 * and after the change (turning translation off for the whole entity archives by its own path).
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each reshaped or constrained field and the order
 *   that works, or `NEXTLY_MIGRATION_APPLY_FAILED` when the archive refuses the values
 */
export async function archiveFieldsLeavingTranslation(args: {
  adapter: DrizzleAdapter;
  /** The collection, Single or field group being changed. */
  entity: string;
  /** Its main table; the companion is `<tableName>_locales`. */
  tableName: string;
  /** Which builder made the entity's table, which decides a column's bounds. */
  builtBy: ColumnOrigin;
  /** The language whose value becomes the shared one, and is therefore not archived. */
  defaultLocale: string;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  wasLocalized: boolean;
  isLocalized: boolean;
}): Promise<void> {
  if (!args.wasLocalized || !args.isLocalized) return;
  const leaving = new Set(
    fieldsLeavingTranslation(args.oldFields, args.newFields)
  );
  if (leaving.size === 0) return;

  // The column a field is stored in: its kind and its bounds (length, precision, scale), as the
  // builder of this entity's table describes them. Any difference means the copy would put values
  // into a column of another shape than the one they were written to.
  const dialect = args.adapter.getCapabilities().dialect;
  const shapeOf = (field: LeavingFieldLike) => {
    const spec = fieldToLocalizedColumnSpec(field, dialect, args.builtBy);
    return spec
      ? [spec.kind, spec.length, spec.precision, spec.scale].join("|")
      : undefined;
  };
  const before = new Map(args.oldFields.map(f => [f.name, f]));
  const reshaped = args.newFields.filter(f => {
    const previous = before.get(f.name);
    return (
      leaving.has(f.name) &&
      previous !== undefined &&
      shapeOf(previous) !== shapeOf(f)
    );
  });
  if (reshaped.length > 0) {
    throw NextlyError.validation({
      errors: reshaped.map(f => ({
        path: `fields.${f.name}`,
        code: "RESHAPED_FIELD_LEAVES_TRANSLATION",
        message:
          `"${f.name}" changes how it is stored (its type, length or precision) in the same ` +
          `change that stops it being translated. Make it shared and save first, then change it.`,
      })),
      logContext: { entity: args.entity, fields: reshaped.map(f => f.name) },
    });
  }

  const constrained = args.newFields.filter(
    f => leaving.has(f.name) && constraintsOf(f).length > 0
  );
  if (constrained.length > 0) {
    throw NextlyError.validation({
      errors: constrained.map(f => {
        const settings = constraintsOf(f).join(" and ");
        return {
          path: `fields.${f.name}`,
          code: "CONSTRAINED_FIELD_LEAVES_TRANSLATION",
          message:
            `"${f.name}" is ${settings.toLowerCase()}, so it cannot stop being translated in the ` +
            `same change. Turn off ${settings} and save, make the field shared and save, then ` +
            `turn ${settings} back on.`,
        };
      }),
      logContext: {
        entity: args.entity,
        fields: constrained.map(f => f.name),
      },
    });
  }

  await writeArchiveFirst(
    args.adapter,
    args.entity,
    buildLeavingFieldsArchiveStatements({
      slug: args.entity,
      tableName: args.tableName,
      dialect,
      builtBy: args.builtBy,
      defaultLocale: args.defaultLocale,
      oldFields: args.oldFields,
      newFields: args.newFields,
    })
  );
}
