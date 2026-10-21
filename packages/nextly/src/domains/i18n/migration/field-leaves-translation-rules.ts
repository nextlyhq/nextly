/**
 * Which fields cannot stop being translated, or become translated, in the change that asks for
 * it, and why.
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
    | "CONSTRAINED_FIELD_LEAVES_TRANSLATION"
    | "RESHAPED_FIELD_JOINS_TRANSLATION"
    | "RESHAPED_TRANSLATED_FIELD_RENAMED"
    | "TRANSLATED_FIELD_RENAMED_AS_TRANSLATION_ENDS"
    | "TRANSLATED_FIELD_RENAME_UNANSWERED"
    | "TRANSLATED_FIELD_REMOVED_BESIDE_ADDED";
  /** Why the field cannot leave or join translation in this change, as one sentence. */
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
 * Whether a field's storage differs between two descriptions of its column: its kind, or its
 * bounds (length, precision, scale). No description of the column before is no difference, since
 * there is nothing to judge.
 */
export function storageDiffers(
  before: LocalizedColumnSpec | null | undefined,
  after: LocalizedColumnSpec | null | undefined
): boolean {
  const shape = (spec: LocalizedColumnSpec | null | undefined) =>
    spec
      ? [spec.kind, spec.length, spec.precision, spec.scale].join("|")
      : undefined;
  return before !== undefined && shape(before) !== shape(after);
}

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
    if (storageDiffers(previousColumnOf(field), columnOf(field))) {
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

function reshapedJoiningRefusal(
  name: string,
  surface: Surface
): LeavingTranslationRefusal {
  return refusal(
    `fields.${name}`,
    "RESHAPED_FIELD_JOINS_TRANSLATION",
    surface === "builder"
      ? "Its type, length or precision changes in the same change that makes it translated."
      : `"${name}" changes how it is stored (its type, length or precision) in the same change ` +
          `that makes it translated.`,
    // The first step keeps the new storage and takes the field back to shared, so it is a change
    // of its own, with its own conversion and confirmation; the move to translated then copies
    // values that already fit.
    surface === "builder"
      ? [
          "Turn off Localized, keep the new type, length or precision, and save.",
          "Turn on Localized and save.",
        ]
      : [
          "Set `localized: false`, keep the new type, length or precision, and run `nextly migrate:create`.",
          "Set `localized: true` and run it again.",
        ]
  );
}

/**
 * The refusals for fields that become translated: each one in `reshaped`, whose storage changes
 * in the same change. Its shared value is copied as it is into a companion column of the new
 * shape, without the conversion and confirmation such a change goes through on its own:
 * PostgreSQL refuses the copy part-way, and MySQL converts or cuts the value to fit.
 *
 * Which fields are reshaped is judged by the caller, against the column the value sits in now
 * (`storageDiffers`), since only it knows how that column is described.
 */
export function refusalsForFieldsJoiningTranslation(args: {
  /** The joining fields whose storage changes, in field order. */
  reshaped: readonly string[];
  surface: Surface;
}): LeavingTranslationRefusal[] {
  return args.reshaped.map(name => reshapedJoiningRefusal(name, args.surface));
}

/**
 * A translated field the schema dialog offers as renamed, in a change that does not say whether it
 * was renamed or replaced. Taking either would guess about every language's value: a rename keeps
 * them under the new name, a replacement deletes them. Refused, so the admin decides.
 */
export function refusalsForTranslatedFieldRenameUnanswered(args: {
  /** The field's new name. */
  renamed: string;
}): LeavingTranslationRefusal[] {
  return [
    refusal(
      `fields.${args.renamed}`,
      "TRANSLATED_FIELD_RENAME_UNANSWERED",
      "It looks renamed, but the change does not say whether to keep its translations under the new name.",
      [
        "Review the change again and choose whether the field was renamed, which keeps its translations, or replaced, which deletes them.",
        "Save.",
      ]
    ),
  ];
}

/**
 * A translated field renamed in the same change that turns translation off for the whole entity.
 * The disable restores each field from the companion under the name it had, so the value would
 * land under a name no field has any more. Refused, naming the two saves that work.
 */
export function refusalsForTranslatedFieldRenamedAsTranslationEnds(args: {
  /** The renamed field's new name, when translation ends in the same change. */
  renamed: string | undefined;
}): LeavingTranslationRefusal[] {
  if (args.renamed === undefined) return [];
  return [
    refusal(
      `fields.${args.renamed}`,
      "TRANSLATED_FIELD_RENAMED_AS_TRANSLATION_ENDS",
      "It is renamed in the same change that turns translation off.",
      ["Rename it and save.", "Turn translation off and save."]
    ),
  ];
}

/**
 * The refusal for a translated field renamed in the same change that changes how it is stored.
 * Its values move with its column when it is renamed, and a rename keeps the column's type, so
 * the two together would leave every language's value behind. The Builder's paths only: a code
 * rename is not yet decided as one.
 */
export function refusalsForTranslatedFieldRenamedAndReshaped(args: {
  /** The renamed field's new name, when the rename changes its storage too. */
  reshaped: string | undefined;
}): LeavingTranslationRefusal[] {
  if (args.reshaped === undefined) return [];
  return [
    refusal(
      `fields.${args.reshaped}`,
      "RESHAPED_TRANSLATED_FIELD_RENAMED",
      "Its type, length or precision changes in the same change that renames it.",
      ["Rename it and save.", "Change its type, length or precision and save."]
    ),
  ];
}

/**
 * The refusal for translated fields a change removes while it adds other fields, when no rename was
 * decided for them. Read by name, each removed field's companion column is dropped with every
 * language's value, and the change cannot tell that from a rename the rule could not pick (two
 * renames, a rename beside a new field, a rename to another type), so nothing asked the admin
 * about the column. A removal on its own, or an addition on its own, is not refused.
 */
export function refusalsForTranslatedFieldsRemovedBesideAdded(args: {
  /** The translated fields the change removes, each of which has a companion column. */
  removed: readonly string[];
  /** The fields the change adds that get a column, translated or shared. */
  added: readonly string[];
}): LeavingTranslationRefusal[] {
  if (args.removed.length === 0 || args.added.length === 0) return [];
  const added = args.added.map(name => `"${name}"`).join(", ");
  return args.removed.map(name =>
    refusal(
      `fields.${name}`,
      "TRANSLATED_FIELD_REMOVED_BESIDE_ADDED",
      `"${name}" is translated, and this change removes it while adding ${added}. Removing it ` +
        `deletes every language's value, and in one change that cannot be told from a rename.`,
      [
        "Rename or remove one translated field and save.",
        "Then add or change the other fields and save.",
      ]
    )
  );
}
