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
  /** Why the field cannot leave translation in this change, as one sentence. */
  reason: string;
  /** The changes that get there instead, in order, each one sentence. */
  steps: string[];
  /** `reason` and `steps` as one paragraph, for a surface that shows a single message. */
  message: string;
}

/**
 * A refusal whose message is derived from its reason and steps, so a surface that lists the
 * steps and one that prints the message cannot say different things.
 */
function refusal(
  path: string,
  code: LeavingTranslationRefusal["code"],
  reason: string,
  steps: string[]
): LeavingTranslationRefusal {
  return { path, code, reason, steps, message: [reason, ...steps].join(" ") };
}

type Surface = "builder" | "code";
type Constraint = "required" | "unique";

/**
 * The settings a field cannot carry while it stops being translated: its own flags, and
 * `unique` when a unique index covers it without the flag.
 */
function constraintsOf(
  field: LeavingFieldLike,
  uniqueIndexed: ReadonlySet<string> | undefined
): Constraint[] {
  const unique =
    field.unique === true || uniqueIndexed?.has(field.name) === true;
  return [
    ...(field.required === true ? (["required"] as const) : []),
    ...(unique ? (["unique"] as const) : []),
  ];
}

function reshapedRefusal(
  name: string,
  surface: Surface
): LeavingTranslationRefusal {
  return refusal(
    `fields.${name}`,
    "RESHAPED_FIELD_LEAVES_TRANSLATION",
    surface === "builder"
      ? "Its type, length or precision changes in the same change that stops it being translated."
      : `"${name}" changes how it is stored (its type, length or precision) in the same change ` +
          `that stops it being translated.`,
    surface === "builder"
      ? ["Turn off Localized and save.", "Change how it is stored and save."]
      : [
          "Set `localized: false` and run `nextly migrate:create`.",
          "Change how it is stored, and run it again.",
        ]
  );
}

function constrainedRefusal(
  name: string,
  constraints: readonly Constraint[],
  surface: Surface
): LeavingTranslationRefusal {
  const builder = surface === "builder";
  return refusal(
    `fields.${name}`,
    "CONSTRAINED_FIELD_LEAVES_TRANSLATION",
    // The Builder shows the reason beside the field it is about, so it does not name it again; a
    // migration's refusal is read on its own and does.
    builder
      ? `A ${constraints.join(" and ")} field can't stop being translated in the same change.`
      : `"${name}" is ${constraints.join(" and ")}, so it cannot stop being translated in the same migration.`,
    builder
      ? builderConstraintSteps(constraints)
      : codeConstraintSteps(constraints)
  );
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
  surface: Surface;
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
      refusals.push(reshapedRefusal(field.name, args.surface));
      continue;
    }
    const constraints = constraintsOf(field, args.uniqueIndexed);
    if (constraints.length > 0) {
      refusals.push(constrainedRefusal(field.name, constraints, args.surface));
    }
  }
  return refusals;
}

function builderConstraintSteps(constraints: readonly Constraint[]): string[] {
  const settings = constraints
    .map(c => (c === "required" ? "Required" : "Unique"))
    .join(" and ");
  // Each step names the Builder control it uses, and ends where the author saves.
  return [
    `Turn off ${settings} and save.`,
    "Turn off Localized and save.",
    `Turn ${settings} back on and save.`,
  ];
}

function codeConstraintSteps(constraints: readonly Constraint[]): string[] {
  const flags = constraints.map(c => `\`${c}\``).join(" and ");
  return [
    `Remove ${flags} from the field and run \`nextly migrate:create\`.`,
    "Set `localized: false` and run it again.",
    `Put ${flags} back and run it once more.`,
  ];
}
