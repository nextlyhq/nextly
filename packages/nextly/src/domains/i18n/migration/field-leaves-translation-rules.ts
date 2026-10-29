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
    | "REQUIRED_FIELD_LEAVES_WITHOUT_VALUES"
    | "UNIQUE_FIELD_LEAVES_OVER_DUPLICATES"
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
export function refusal(
  path: string,
  code: LeavingTranslationRefusal["code"],
  reason: string,
  steps: string[]
): LeavingTranslationRefusal {
  return { path, code, reason, steps, message: [reason, ...steps].join(" ") };
}

/** Whose steps a refusal names: the Schema Builder's settings, or the config and its CLI. */
export type TranslationSurface = "builder" | "code";
type Surface = TranslationSurface;
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
 * Whether a field stored as `after` describes holds every value it held as `before` describes:
 * the same kind, no shorter a length, and as many digits on each side of a decimal point. A bound
 * that is not stated is no bound.
 */
export function storageHolds(
  after: LocalizedColumnSpec,
  before: LocalizedColumnSpec
): boolean {
  if (after.kind !== before.kind) return false;
  const length = (spec: LocalizedColumnSpec) => spec.length ?? Infinity;
  if (length(after) < length(before)) return false;
  if (after.precision === undefined || before.precision === undefined) {
    return true;
  }
  const scale = (spec: LocalizedColumnSpec) => spec.scale ?? 0;
  return (
    scale(after) >= scale(before) &&
    after.precision - scale(after) >= before.precision - scale(before)
  );
}

/**
 * The refusals for fields joining translation whose values an earlier apply of the change already
 * moved into the translations table, when the change also narrows how the field is stored. The
 * values are kept as they are, so some would stand against the field's narrower rules; and the
 * order the joining refusal gives (shared first) would add an empty shared column while the values
 * sit in the translations table. So the way on finishes the earlier change first.
 */
export function refusalsForMovedJoinsNarrowed(args: {
  narrowed: readonly string[];
  surface: Surface;
}): LeavingTranslationRefusal[] {
  return args.narrowed.map(name =>
    refusal(
      `fields.${name}`,
      "RESHAPED_FIELD_JOINS_TRANSLATION",
      `An earlier change that made "${name}" translated did not finish, and its values are ` +
        "already in the translations table; this change narrows its type, length or precision.",
      args.surface === "builder"
        ? [
            "Save it with its earlier type, length or precision, to finish that change.",
            "Then narrow it and save.",
          ]
        : [
            `Declare "${name}" with its earlier type, length or precision, and sync.`,
            "Then narrow it and sync again.",
          ]
    )
  );
}

/**
 * The settings a field leaving translation has to take on after its values are shared: its own
 * flags, and `unique` when a unique index covers it without the flag.
 */
export function leavingFieldConstraints(
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

/**
 * The refusals for the fields in `leaving`.
 *
 * - A field whose storage changes in the same change: its type, or its bounds (length,
 *   precision, scale). Its values would be copied as they are into a column of another shape,
 *   without the conversion and confirmation such a change goes through on its own. Judged against
 *   the column the values sit in now, described by `oldFields` or, where the caller has no old
 *   definition, by `previousColumns`; a field neither describes is not judged.
 *
 * A Required or Unique field is not refused here: every surface creates its shared column without
 * the setting and applies it after the copy (`withoutLeavingConstraints`), and whether the values
 * can take it is asked of the database (`refusalsForConstrainedFieldsLeaving`).
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
    }
  }
  return refusals;
}

/**
 * `fields` with each field in `leaving` that carries a leaving field's settings made optional and
 * not unique: the shape its shared column is created in, before the default language's values are
 * copied into it. Every other field is returned as it is.
 */
export function withoutLeavingConstraints<F extends LeavingFieldLike>(
  fields: readonly F[],
  leaving: ReadonlySet<string>
): F[] {
  return fields.map(f =>
    leaving.has(f.name) && leavingFieldConstraints(f, undefined).length > 0
      ? { ...f, required: false, unique: false }
      : f
  );
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
 *
 * The change that turns translation on is refused the same way for the fields that become
 * translated: it moves each one's main column under a name the field keeps, so it follows no
 * rename at all, and its refusal names turning translation on as the first save.
 */
export function refusalsForTranslatedFieldsRemovedBesideAdded(args: {
  /** The translated fields the change removes, each of which has a companion column. */
  removed: readonly string[];
  /** The fields the change adds that get a column, translated or shared. */
  added: readonly string[];
  /** Whether this change turns translation on, so the removed fields become translated in it. */
  translationStarts?: boolean;
}): LeavingTranslationRefusal[] {
  if (args.removed.length === 0 || args.added.length === 0) return [];
  const added = args.added.map(name => `"${name}"`).join(", ");
  const steps = [
    "Rename or remove one translated field and save.",
    "Then add or change the other fields and save.",
  ];
  return args.removed.map(name =>
    refusal(
      `fields.${name}`,
      "TRANSLATED_FIELD_REMOVED_BESIDE_ADDED",
      args.translationStarts
        ? `"${name}" becomes translated, and this change removes it while adding ${added}. ` +
            `Turning translation on keeps a field's value only under the name it already has, ` +
            `so its value would be deleted, and in one change that cannot be told from a rename.`
        : `"${name}" is translated, and this change removes it while adding ${added}. Removing it ` +
            `deletes every language's value, and in one change that cannot be told from a rename.`,
      args.translationStarts
        ? [
            "Turn translation on with the fields as they are and save.",
            ...steps,
          ]
        : steps
    )
  );
}
