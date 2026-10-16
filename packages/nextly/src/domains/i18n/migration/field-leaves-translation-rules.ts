/**
 * Which fields cannot stop being translated in the change that asks for it, and why.
 *
 * One answer for every surface that can make the change: the Schema Builder's paths
 * (`archiveFieldsLeavingTranslation`) and `nextly migrate:create`. Each surface words the way out
 * in its own terms, since the steps differ, but the rule is this one.
 *
 * Pure: no database. The archive's ability to take the values is asked where the change is
 * applied, not here.
 *
 * @module domains/i18n/migration/field-leaves-translation-rules
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionFieldLike } from "./reconcile-companion";
import type { LocalizedColumnSpec } from "./types";

/** A field as a schema change describes it, with the flags the rules read. */
export type LeavingFieldLike = CompanionFieldLike & {
  required?: boolean;
  unique?: boolean;
};

/** One field refused, in the shape a validation error carries. */
export interface LeavingTranslationRefusal {
  path: string;
  code:
    | "RESHAPED_FIELD_LEAVES_TRANSLATION"
    | "CONSTRAINED_FIELD_LEAVES_TRANSLATION";
  message: string;
}

/** The settings a field cannot carry while it stops being translated. */
function constraintsOf(field: LeavingFieldLike): ("required" | "unique")[] {
  return [
    ...(field.required === true ? (["required"] as const) : []),
    ...(field.unique === true ? (["unique"] as const) : []),
  ];
}

/**
 * The refusals for the fields in `leaving`.
 *
 * - A field whose storage changes in the same change: its type, or its bounds (length,
 *   precision, scale). Its values would be copied as they are into a column of another shape,
 *   without the conversion and confirmation such a change goes through on its own. Judged against
 *   the column the values sit in now, described by `oldFields` or, where the caller has no old
 *   definition, by `previousColumns`; a field neither describes is not judged.
 * - A required or unique field, or one a unique index covers (`uniqueIndexed`). Its shared column
 *   is created, and its constraints checked, before the default language's values are copied into
 *   it, so at that moment every existing row holds the same placeholder or none.
 *
 * @param surface - Whose steps the message names: the Schema Builder's settings and saves, or
 *   the config's flags and `nextly migrate:create`
 */
export function refusalsForFieldsLeavingTranslation(args: {
  leaving: ReadonlySet<string>;
  newFields: readonly LeavingFieldLike[];
  oldFields?: readonly LeavingFieldLike[];
  /** The companion columns as they are now, by column name, for a caller with no old fields. */
  previousColumns?: ReadonlyMap<string, LocalizedColumnSpec>;
  /** Fields a unique index covers, beside their own `unique` flag. */
  uniqueIndexed?: ReadonlySet<string>;
  dialect: SupportedDialect;
  /** Which builder made the entity's table, which decides a column's bounds. */
  builtBy: ColumnOrigin;
  surface: "builder" | "code";
}): LeavingTranslationRefusal[] {
  const refusals: LeavingTranslationRefusal[] = [];
  const columnOf = (field: LeavingFieldLike) =>
    fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
  const shape = (spec: LocalizedColumnSpec | null | undefined) =>
    spec
      ? [spec.kind, spec.length, spec.precision, spec.scale].join("|")
      : undefined;
  const before = new Map((args.oldFields ?? []).map(f => [f.name, f]));
  /** The column the field's values sit in now, when anything describes it. */
  const previousColumnOf = (field: LeavingFieldLike) => {
    const previous = before.get(field.name);
    if (previous !== undefined) return columnOf(previous);
    const name = columnOf(field)?.name;
    return name === undefined ? undefined : args.previousColumns?.get(name);
  };

  for (const field of args.newFields) {
    if (!args.leaving.has(field.name)) continue;
    const previous = previousColumnOf(field);
    if (previous !== undefined && shape(previous) !== shape(columnOf(field))) {
      refusals.push({
        path: `fields.${field.name}`,
        code: "RESHAPED_FIELD_LEAVES_TRANSLATION",
        message:
          `"${field.name}" changes how it is stored (its type, length or precision) in the same ` +
          `change that stops it being translated. Make it shared and save first, then change it.`,
      });
      continue;
    }
    const constraints = constraintsOf(field);
    if (
      args.uniqueIndexed?.has(field.name) &&
      !constraints.includes("unique")
    ) {
      constraints.push("unique");
    }
    if (constraints.length === 0) continue;
    refusals.push({
      path: `fields.${field.name}`,
      code: "CONSTRAINED_FIELD_LEAVES_TRANSLATION",
      message:
        args.surface === "builder"
          ? builderConstraintMessage(field.name, constraints)
          : codeConstraintMessage(field.name, constraints),
    });
  }
  return refusals;
}

function builderConstraintMessage(
  name: string,
  constraints: readonly ("required" | "unique")[]
): string {
  const settings = constraints
    .map(c => (c === "required" ? "Required" : "Unique"))
    .join(" and ");
  return (
    `"${name}" is ${constraints.join(" and ")}, so it cannot stop being translated in the same ` +
    `change. Turn off ${settings} and save, make the field shared and save, then turn ` +
    `${settings} back on.`
  );
}

function codeConstraintMessage(
  name: string,
  constraints: readonly ("required" | "unique")[]
): string {
  const flags = constraints.map(c => `\`${c}\``).join(" and ");
  return (
    `"${name}" is ${constraints.join(" and ")}, so it cannot stop being translated in the same ` +
    `migration. Remove ${flags} from the field and run \`nextly migrate:create\`, set ` +
    `\`localized: false\` and run it again, then put ${flags} back and run it once more.`
  );
}
