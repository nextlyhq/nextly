/**
 * Before a schema change archives translations, make sure the archive can take them.
 *
 * A field that stops being translated keeps its other languages' values only because they are
 * written to `nextly_i18n_archive` before its companion column is dropped. If that write cannot
 * happen, the change must not start at all: no main-table ALTER, no registry write, no companion
 * DDL. So every path that archives asks this first, before it changes anything, and a refusal
 * names what failed and says nothing was changed.
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

import { lit, q } from "./ddl-types";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  type CompanionFieldLike,
  fieldsLeavingTranslation,
} from "./reconcile-companion";

const ARCHIVE = "nextly_i18n_archive";

/**
 * Thrown inside the probe's transaction to roll it back. A `NextlyError`, so every adapter
 * hands it back unchanged rather than wrapping it as a database failure, which is what lets it
 * be told apart from a real one.
 */
const PROBE_ROLLED_BACK = NextlyError.internal({
  logContext: { reason: "archive write probe rolled back" },
});

/**
 * Creates the archive table when it is missing, and proves it accepts a row, without keeping
 * one: the probe row is written inside a transaction that is always rolled back.
 *
 * @param adapter - The database the change is about to run on
 * @param entity - The collection, Single or field group being changed, for the log
 * @throws NextlyError `NEXTLY_MIGRATION_APPLY_FAILED` when the table cannot be created or
 *   written, before anything else has changed
 */
export async function assertI18nArchiveWritable(
  adapter: DrizzleAdapter,
  entity: string
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
    await adapter.transaction(async ctx => {
      await ctx.execute(
        `INSERT INTO ${q(ARCHIVE, dialect)} ` +
          `(${q("collection", dialect)}, ${q("entry_id", dialect)}, ${q("locale", dialect)}, ${q("field", dialect)}, ${q("value", dialect)}) ` +
          `VALUES (${lit(entity)}, ${lit("preflight")}, ${lit("preflight")}, ${lit("preflight")}, NULL)`
      );
      throw PROBE_ROLLED_BACK;
    });
  } catch (error) {
    if (error === PROBE_ROLLED_BACK) return;
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
 * The precondition of every schema change that can make a translated field shared, asked before
 * the change alters anything. It is one call so the collection save, the collection, Single and
 * field-group schema dialogs and the Single save cannot answer it differently.
 *
 * Three things are refused here:
 * - A field whose storage changes in the same edit: its type (text becoming a number) or its
 *   bounds (a shorter maximum length, a smaller precision). Its values are copied into the shared
 *   column as they are, without the conversion and confirmation such a change goes through on its
 *   own, so one the new column cannot hold would fail part-way, be truncated, or be kept against
 *   the field's new rules.
 * - A required or unique field. Its shared column is created, and its constraints checked, before
 *   the default language's values are copied into it, so at that moment every existing row holds
 *   the same placeholder or none. A required column then has nothing valid to hold (each dialect
 *   and path fails differently), and a unique one fails its check part-way through the change.
 * - An archive that cannot take a row (`assertI18nArchiveWritable`), since the other languages'
 *   values are kept only there.
 *
 * Nothing is asked when no field leaves translation, or when the entity is not translated before
 * and after the change (turning translation off for the whole entity archives by its own path).
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each reshaped or constrained field and the order
 *   that works, or `NEXTLY_MIGRATION_APPLY_FAILED` from the archive check
 */
export async function assertFieldsCanLeaveTranslation(args: {
  adapter: DrizzleAdapter;
  /** The collection, Single or field group being changed. */
  entity: string;
  /** Which builder made the entity's table, which decides a column's bounds. */
  builtBy: ColumnOrigin;
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

  await assertI18nArchiveWritable(args.adapter, args.entity);
}
