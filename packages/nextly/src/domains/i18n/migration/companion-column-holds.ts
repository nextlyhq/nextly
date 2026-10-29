/**
 * Whether a column a translations table already has can be taken as the column of a field that is
 * newly translated: asked the one way by the Schema Builder's preflight and by the code-first sync.
 *
 * A change that stopped part-way (MySQL commits each schema statement on its own) can leave a
 * translated field's companion column in place, holding the values it had moved, and the next run
 * takes a column already there as the field's rather than adding it twice. One at least as wide
 * holds the field's values as it is (`columnHolds`); taken over one that cannot (another type, a
 * narrower length or precision, or NOT NULL, which a translation's column never is), the field
 * would be recorded over storage that cuts or refuses them. Such a column may still hold the only
 * copy of the field's values from that earlier change, so the refusal names both definitions and a
 * way on that keeps the column, never one that drops it.
 *
 * @module domains/i18n/migration/companion-column-holds
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { columnHolds } from "../../schema/pipeline/diff/declared-size";
import type { ColumnSpec } from "../../schema/pipeline/diff/types";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { resolveLocalizedFieldNames } from "../classify-fields";

import { ddlType } from "./ddl-types";
import {
  storageDiffers,
  type TranslationSurface,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionFieldLike } from "./reconcile-companion";
import type { RecordedEntity } from "./recorded-before";

/** One field whose companion column cannot hold its values, as a refusal names it. */
export interface CompanionColumnThatCannotHold {
  refusal: { path: string; code: string; message: string };
  /** The column with both definitions, for the log. */
  columns: { column: string; live: string; wanted: string };
}

/**
 * The fields among `fields`, each newly translated, whose companion column is already among `live`
 * and cannot hold every value the field allows. A field whose column is not there yet is not
 * among them: the transition adds it with the field's own definition.
 */
export function companionColumnsThatCannotHold(args: {
  fields: readonly CompanionFieldLike[];
  live: readonly ColumnSpec[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  /** Whose steps the way on names: the Schema Builder's, or the config's. */
  surface: TranslationSurface;
}): CompanionColumnThatCannotHold[] {
  if (args.live.length === 0) return [];
  return args.fields.flatMap(field => {
    const found = liveAndWanted(field, args);
    if (!found) return [];
    const { column, wanted } = found;
    return columnHolds(column, wanted, { sizes: enforcesSizes(args.dialect) })
      ? []
      : [cannotHold(field.name, column, wanted, args.surface, "new")];
  });
}

/** SQLite stores what a column is declared to bound whatever its size, so a size never decides. */
const enforcesSizes = (dialect: SupportedDialect) => dialect !== "sqlite";

/**
 * `field`'s companion column as the database has it, and the column the field declares: the type
 * the transition would add it with, which allows NULL as a translation's column always does.
 * Undefined when the field has no companion column, or the database has none for it yet.
 */
function liveAndWanted(
  field: CompanionFieldLike,
  args: {
    live: readonly ColumnSpec[];
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
  }
): { column: ColumnSpec; wanted: ColumnSpec } | undefined {
  const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
  const column = spec && args.live.find(c => c.name === spec.name);
  if (!spec || !column) return undefined;
  return {
    column,
    wanted: {
      name: column.name,
      type: ddlType(spec, args.dialect),
      nullable: true,
    },
  };
}

/** What the code-first sync does with the columns of fields translated before the run. */
export interface ColumnsTranslatedBeforePlan {
  /** Columns to alter to their field's declared type, which holds everything they hold. */
  widen: { column: string; type: string }[];
  /** Columns of fields changed in this run that cannot hold them and cannot be widened. */
  refuse: CompanionColumnThatCannotHold[];
  /** The same, for fields this run did not change: reported, never failed. */
  warn: CompanionColumnThatCannotHold[];
}

/**
 * What the code-first sync does with the companion column of each field translated before the run
 * and still translated, judged against the column as the database has it.
 *
 * The sync only ever adds a translations column, so a field whose config raised its length or
 * precision kept the narrower column, which cuts or refuses the longer values. Where the field's
 * declared type is the same kind and holds everything the column holds, the column is widened to
 * it. Judged live rather than by what this run changed, so a run stopped part-way, or a raise
 * from before widening existed, is finished by the next run. A column already wide enough is left
 * as it is, narrower bounds included: the field's own validation holds the new limit. Nullability
 * is not judged here: a column's NULL rule is kept as it is.
 *
 * A column that cannot hold the field and cannot be widened to it (another kind, or a decimal
 * with fewer digits on one side of the point) is never converted. For a field this run changed
 * it is refused; for one it did not, it is reported on every run, so the state is never silent
 * and an install nobody changed does not start failing.
 */
export function planColumnsTranslatedBefore(args: {
  /** The fields translated before the run and still translated, as declared now. */
  fields: readonly CompanionFieldLike[];
  /** The same fields as the registry recorded them before the run, by name. */
  before: ReadonlyMap<string, CompanionFieldLike>;
  live: readonly ColumnSpec[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): ColumnsTranslatedBeforePlan {
  const plan: ColumnsTranslatedBeforePlan = { widen: [], refuse: [], warn: [] };
  const sizes = enforcesSizes(args.dialect);
  const specOf = (field: CompanionFieldLike | undefined) =>
    field === undefined
      ? undefined
      : fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
  for (const field of args.fields) {
    const found = liveAndWanted(field, args);
    if (!found) continue;
    const { column, wanted } = found;
    const asIs: ColumnSpec = { ...column, nullable: true };
    if (columnHolds(asIs, wanted, { sizes })) continue;
    if (columnHolds(wanted, asIs, { sizes })) {
      plan.widen.push({ column: column.name, type: wanted.type });
      continue;
    }
    const changed = storageDiffers(
      specOf(args.before.get(field.name)),
      specOf(field)
    );
    (changed ? plan.refuse : plan.warn).push(
      cannotHold(field.name, column, wanted, "code", "translated before")
    );
  }
  return plan;
}

/**
 * One entity's companion columns as the code-first sync judges them against the registry as it
 * recorded the entity before the run: the refusals, each column that cannot hold a field the run
 * newly translates or one it changed, and the plan for the columns of fields translated before.
 * The reconcile acts on it, and `nextly migrate` asks it before recording a run's metadata, so a
 * refused change is judged the same way wherever it is applied.
 */
export function judgeCompanionColumns(args: {
  /** The entity's translated fields, as declared now. */
  fields: readonly CompanionFieldLike[];
  /** The entity as the registry recorded it before the run; `null` when it held none. */
  recordedBefore: RecordedEntity | null;
  live: readonly ColumnSpec[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): {
  refused: CompanionColumnThatCannotHold[];
  plan: ColumnsTranslatedBeforePlan;
} {
  const recorded =
    args.recordedBefore?.localized === true ? args.recordedBefore.fields : [];
  const translatedBefore = new Set(
    resolveLocalizedFieldNames([...recorded], true)
  );
  const judged = {
    live: args.live,
    dialect: args.dialect,
    builtBy: args.builtBy,
  };
  const plan = planColumnsTranslatedBefore({
    ...judged,
    fields: args.fields.filter(f => translatedBefore.has(f.name)),
    before: new Map(recorded.map(f => [f.name, f])),
  });
  return {
    refused: [
      ...companionColumnsThatCannotHold({
        ...judged,
        fields: args.fields.filter(f => !translatedBefore.has(f.name)),
        surface: "code",
      }),
      ...plan.refuse,
    ],
    plan,
  };
}

/** A column's definition as a refusal names it: its type, its size, and NOT NULL if it has it. */
function declaredColumn(column: ColumnSpec): string {
  const type =
    column.typeModifier === undefined
      ? column.type
      : `${column.type}(${column.typeModifier})`;
  return column.nullable ? type : `${type} NOT NULL`;
}

/**
 * The refusal or warning for one field, by whose the column is.
 *
 * - A field newly translated over a column already there: a column of a type the field could take
 *   may hold the field's values from a change that did not finish, and giving the field the
 *   column's definition finishes that change with them. A NOT NULL column is not one a change
 *   made, so only another name gets past it.
 * - A field translated before, whose own column it is: its values are there and are never
 *   converted between types, so the way on is the column's definition again. Another name would
 *   leave every translation behind in a column nothing reads.
 */
function cannotHold(
  field: string,
  column: ColumnSpec,
  wanted: ColumnSpec,
  surface: TranslationSurface,
  whose: "new" | "translated before"
): CompanionColumnThatCannotHold {
  const live = declaredColumn(column);
  const giveIt = surface === "builder" ? "Save" : "Declare";
  const message =
    whose === "translated before"
      ? `The translations table's column "${column.name}" (${live}) cannot hold every value ` +
        `${field} now allows (${declaredColumn(wanted)}), and a translated field's values are ` +
        `not converted from one type to another. ${giveIt} ${field} with that column's type, ` +
        "length or precision again to keep its translations."
      : column.nullable
        ? `The translations table already has a column "${column.name}" (${live}) that ` +
          `cannot hold every value ${field} allows (${declaredColumn(wanted)}). It may hold ` +
          "this field's values from an earlier change that did not finish. " +
          `${giveIt} ${field} with that column's type, length or precision to use it, or ` +
          "give the field another name."
        : `The translations table already has a column "${column.name}" (${live}), which ` +
          `refuses an empty value as a translation's column never does. Give ${field} ` +
          "another name.";
  return {
    refusal: {
      path: `fields.${field}`,
      code: "COLUMN_ALREADY_EXISTS",
      message,
    },
    columns: { column: column.name, live, wanted: wanted.type },
  };
}
