/**
 * The types a saved field may be changed to in the Schema Builder, as its type picker lists them:
 * each candidate blocked whatever the field's values hold, and why, or marked by what the change can
 * do to them (keeps every value, converts some, may lose some). Read from the conversion rules
 * themselves (`pairBlocked`, `pairOutcome`), never restated here, so the picker and the save that
 * judges the stored values answer from one set of rules.
 *
 * On an entity stored per language, the save's own translation rules are asked too, and a change
 * one refuses is blocked with the save's words: a field that stops being translated, or becomes
 * translated, while how it is stored changes, and one kept per language whose translations column
 * would keep its old type. Inside a group or repeating rows, text is kept per language beside the one
 * structure, field by field, which the save's judgement of the values does not reach yet. A change that
 * stops translating such a text is blocked there (the field would read nothing in any language, its text
 * left beside the structure until that language's next write drops it), and so is one that does not keep
 * every value.
 *
 * @module dispatcher/helpers/type-change-targets
 */
import { z } from "zod";

import { respondList } from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { FIELD_TYPE_CATALOG } from "../../collections/fields/catalog";
import { isFieldLocalized } from "../../domains/i18n/classify-fields";
import { joiningFieldsLosingValues } from "../../domains/i18n/migration/archive-preflight";
import { deriveCompanionTableSpec } from "../../domains/i18n/migration/derive-companion-spec";
import { fieldTurningTranslatedRefusal } from "../../domains/i18n/migration/disable-keeping-overlays";
import { fieldsJoiningTranslation } from "../../domains/i18n/migration/field-joins-translation";
import {
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
  type LeavingTranslationRefusal,
} from "../../domains/i18n/migration/field-leaves-translation-rules";
import { retypedCompanionColumns } from "../../domains/i18n/migration/plan-companion-type-change";
import { fieldsLeavingTranslation } from "../../domains/i18n/migration/reconcile-companion";
import type { I18nTransitionKind } from "../../domains/i18n/migration/transition-state";
import {
  fieldsTurningTranslatedInside,
  sharedStructureShape,
  type SharedStructureShape,
  type StructuredField,
} from "../../domains/i18n/shared-structure";
import { getFieldType } from "../../domains/schema/field-types/field-type-registry";
import type {
  ColumnOrigin,
  SupportedDialect,
} from "../../domains/schema/services/field-column-descriptor";
import {
  fieldTypeInJson,
  fieldTypeOnDialect,
} from "../../domains/schema/value-conversion/type-change/field-type";
import {
  entityLabel,
  fieldTypeChangesOf,
  perLanguageBefore,
  textHeldPerLanguageRefusals,
  TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE,
  translationsColumnChanges,
} from "../../domains/schema/value-conversion/type-change/field-type-changes";
import {
  pairBlocked,
  type PairBlockReason,
} from "../../domains/schema/value-conversion/type-change/judge";
import {
  pairOutcome,
  pairOutcomeHeldInJson,
  type PairOutcome,
} from "../../domains/schema/value-conversion/type-change/pair-outcome";
import { NextlyError } from "../../errors/nextly-error";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  isRequired,
  numberRule,
  selectOptionValues,
} from "../../shared/lib/entry-validation";

import { getAdapterFromDI } from "./di";
import { toPaginationMeta } from "./service-envelope";

/** Why the save refuses a change whatever the field's values hold. */
export type TypeChangeBlock =
  | PairBlockReason
  /** It stops being translated while how it is stored changes (`refusalsForFieldsLeavingTranslation`). */
  | "leaves-translation"
  /** It becomes translated while how it is stored changes, losing values (`refusalsForFieldsJoiningTranslation`). */
  | "joins-translation"
  /** It stays translated, and its translations column would keep the old type (`translationsColumnChanges`). */
  | "translations-column"
  /** Text its containers keep per language, beside one structure, would stop being translated. */
  | "leaves-translation-inside"
  /** A value every language shares in its containers would become each language's own there. */
  | "joins-translation-inside"
  /** Every value it may hold there would have to be rewritten into the new type's form, which no save does. */
  | "needs-rewrite-inside"
  /** It would stay translated there, its values not all kept, which the save does not judge yet. */
  | "unjudged-inside";

/** A refusal in the save's own words: its code, why, and the changes that get there instead. */
export interface TypeChangeRefusalWords {
  code: string;
  reason: string;
  steps: string[];
}

/**
 * A type the picker offers, and the field as the Builder's change would save it: its own settings
 * (several values, its options, Unique, whether it is translated, the rules it keeps) decide the
 * column the change makes, so the field is judged with them and no others. Where none are given, the
 * saved field's are kept.
 */
export interface TypeChangeCandidate {
  type: string;
  field?: Readonly<Record<string, unknown>>;
}

/** One type a saved field could be changed to, as the picker shows it. */
export interface TypeChangeTarget {
  type: string;
  /** Why the change is refused whatever the field's values hold; null where it is not. */
  blocked: TypeChangeBlock | null;
  /** For a change a translation rule refuses, the save's own refusal; null otherwise. */
  refusal: TypeChangeRefusalWords | null;
  /** What the change can do to the field's values; null where it is blocked. */
  outcome: PairOutcome | null;
}

/** Where the entity a field belongs to keeps its translated values, as its save reads them. */
export interface TranslationLayout {
  /** Whether the entity stores its translatable fields per language (`storesPerLanguage`). */
  perLanguage: boolean;
  /**
   * Whether the save's own migration file gives a translated field's translations column its new
   * type, where the column changes on this database: a collection's save does; a Single's and a
   * field group's are applied by their push, which changes no translations column's type.
   */
  fileRetypes: boolean;
}

function wordsOf(refusal: LeavingTranslationRefusal): TypeChangeRefusalWords {
  return { code: refusal.code, reason: refusal.reason, steps: refusal.steps };
}

/**
 * The save's own refusal of changing `from` into `to`, a field of an entity stored per language,
 * by a translation rule: the field leaving translation reshaped, joining it reshaped so that values
 * would be lost, or staying translated with a translations column the save does not retype. Each
 * rule is the save's (`archiveFieldsLeavingTranslation`, `typeChangeRefusals`), asked of the one
 * field. Null where none refuses it.
 */
function translationRefusal(args: {
  from: FieldDefinition;
  to: FieldDefinition;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  fileRetypes: boolean;
}): { blocked: TypeChangeBlock; refusal: TypeChangeRefusalWords } | null {
  const oldFields = [args.from];
  const newFields = [args.to];
  const [leaving] = refusalsForFieldsLeavingTranslation({
    leaving: new Set(fieldsLeavingTranslation(oldFields, newFields)),
    newFields,
    oldFields,
    dialect: args.dialect,
    builtBy: args.builtBy,
    surface: "builder",
  });
  if (leaving !== undefined) {
    return { blocked: "leaves-translation", refusal: wordsOf(leaving) };
  }
  const [joining] = refusalsForFieldsJoiningTranslation({
    reshaped: joiningFieldsLosingValues(
      fieldsJoiningTranslation(oldFields, newFields),
      { oldFields, newFields, builtBy: args.builtBy },
      args.dialect
    ),
    surface: "builder",
  });
  if (joining !== undefined) {
    return { blocked: "joins-translation", refusal: wordsOf(joining) };
  }
  const staysTranslated =
    isFieldLocalized(args.from, true) && isFieldLocalized(args.to, true);
  // A collection's save file retypes the column where it changes on this database; one that
  // changes only on another database it deploys to is left behind, and so refused.
  const retypedByFile =
    args.fileRetypes &&
    retypedCompanionColumns({
      fields: [{ from: args.from, to: args.to }],
      dialect: args.dialect,
      builtBy: args.builtBy,
    }).length > 0;
  if (
    staysTranslated &&
    translationsColumnChanges(args.from, args.to, args.builtBy) &&
    !retypedByFile
  ) {
    return {
      blocked: "translations-column",
      refusal: {
        code: "TYPE_CHANGE_BLOCKED",
        reason: TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE,
        steps: [],
      },
    };
  }
  return null;
}

/**
 * The rules that refuse a value below a bound, each with the bound that refuses none: no text is
 * shorter than nothing, and no list holds fewer; a number has no least.
 */
const AT_LEAST: Readonly<Record<string, number>> = {
  minLength: 0,
  minRows: 0,
  minChips: 0,
  min: -Infinity,
};

/** The rules that refuse a value above a bound. */
const AT_MOST = ["maxLength", "maxRows", "maxChips", "max"] as const;

/** A field's pattern, stated on the field itself or under `validation`: none where it is empty. */
function patternOf(field: FieldDefinition): string | undefined {
  const stated = (field as unknown as Record<string, unknown>).pattern;
  const pattern = stated === undefined ? field.validation?.pattern : stated;
  return typeof pattern === "string" && pattern !== "" ? pattern : undefined;
}

/**
 * What the save asks of a field's values by its own settings, beyond what its type holds, each read
 * as the entry validator reads it: in either spelling, a bound left out as the one that refuses none.
 * Both what a change may newly refuse (`saveMayRefuse`) and whether the stored field is the one the
 * page knows (`savedAsKnown`) are read from this, so the answer is made from what is compared.
 */
function asksOf(field: FieldDefinition) {
  return {
    required: isRequired(field),
    unique: field.unique === true,
    atLeast: Object.entries(AT_LEAST).map(
      ([rule, none]) => numberRule(field, rule) ?? none
    ),
    atMost: AT_MOST.map(rule => numberRule(field, rule) ?? Infinity),
    pattern: patternOf(field),
  };
}

/** Whether `after` asks more of a value than `before` by a bound or a pattern: no pattern is known to allow all another does. */
function asksMore(
  before: ReturnType<typeof asksOf>,
  after: ReturnType<typeof asksOf>
): boolean {
  return (
    after.atLeast.some((bound, i) => bound > before.atLeast[i]) ||
    after.atMost.some((bound, i) => bound < before.atMost[i]) ||
    (after.pattern !== undefined && after.pattern !== before.pattern)
  );
}

/** The rules read elsewhere here, and a message, which refuses nothing. */
const RULES_READ: ReadonlySet<string> = new Set([
  ...Object.keys(AT_LEAST),
  ...AT_MOST,
  "pattern",
  "required",
  "message",
]);

/** Whether `to` states a rule no reader here knows that `from` does not state the same. */
function statesAnotherRule(
  from: FieldDefinition,
  to: FieldDefinition
): boolean {
  const before: Readonly<Record<string, unknown>> = { ...from.validation };
  return Object.entries({ ...to.validation }).some(
    ([rule, value]) =>
      !RULES_READ.has(rule) &&
      Boolean(value) &&
      JSON.stringify(value) !== JSON.stringify(before[rule])
  );
}

/**
 * Whether the save could refuse a value of `from` for something `to` asks that the pair of types does
 * not say (`pairOutcome`): Required or Unique newly on, a bound added or tightened, a pattern added or
 * changed, a plugin type's own check, or a rule none of these is. Which values are refused only the
 * values say, and the save judges each. What is carried over, loosened or turned off refuses none.
 */
function saveMayRefuse(from: FieldDefinition, to: FieldDefinition): boolean {
  const before = asksOf(from);
  const after = asksOf(to);
  const newly = (["required", "unique"] as const).some(
    ask => after[ask] && !before[ask]
  );
  return (
    newly ||
    asksMore(before, after) ||
    getFieldType(to.type)?.validate !== undefined ||
    statesAnotherRule(from, to)
  );
}

/**
 * Whether a field standing where the judged one does is text its containers keep per language, beside
 * the one structure every language shares (`translatedInsideContainers`).
 */
type TranslatedInside = (field: FieldDefinition) => boolean;

/** Whether `field` is text its containers keep per language, on an entity stored so. */
function keptPerLanguageInside(
  args: {
    inJson?: boolean;
    translatedInside?: TranslatedInside;
    layout?: TranslationLayout;
  },
  field: FieldDefinition
): boolean {
  return (
    args.layout?.perLanguage === true &&
    args.inJson === true &&
    args.translatedInside?.(field) === true
  );
}

/** Why a change is blocked, and the save's own words for it where the save gives them. */
type Blocked = {
  blocked: TypeChangeBlock;
  refusal: TypeChangeRefusalWords | null;
};

/** Why a change of a field held in a container's JSON is blocked (`containerRefusal`), or null. */
type InsideRefusal = (candidate: FieldDefinition) => Blocked | null;

/**
 * Why a translation rule blocks changing the field into `candidate`, on an entity stored per language:
 * on its own row or column, the save's own (`translationRefusal`); inside a container, its rules there
 * (`inside`, `containerRefusal`). Null where none does.
 */
function refusalByTranslation(
  args: {
    field: FieldDefinition;
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
    inJson?: boolean;
    inside?: InsideRefusal;
    layout?: TranslationLayout;
  },
  candidate: FieldDefinition
): Blocked | null {
  if (args.layout?.perLanguage !== true) return null;
  if (args.inJson === true) return args.inside?.(candidate) ?? null;
  return translationRefusal({
    from: args.field,
    to: candidate,
    dialect: args.dialect,
    builtBy: args.builtBy,
    fileRetypes: args.layout.fileRetypes,
  });
}

/**
 * Each of `candidates` other than the field's own type, judged as a change from `field`, a field
 * as its entity stores it, on the database this runs on. `builtBy` and `componentRow` say where its
 * values are kept, as the save that would make the change reads them; `inJson`, that they are held
 * inside a named group's or a repeater's JSON value, as the save judges such a field. `layout`, where
 * the entity keeps its translated values. A field held in a container's JSON has no translations column
 * of its own, so the rules of one are not asked of it: `inside` judges it by the rules of the
 * container keeping it (`containerRefusal`), and `translatedInside` says whether it is text the
 * container keeps per language beside its structure (`translatedInsideContainers`), whose values the
 * save does not judge. A value held there is judged as its JSON writing stands (`pairOutcomeHeldInJson`),
 * since no save rewrites one.
 */
export function typeChangeTargets(args: {
  field: FieldDefinition;
  candidates: readonly TypeChangeCandidate[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
  inJson?: boolean;
  translatedInside?: TranslatedInside;
  inside?: InsideRefusal;
  layout?: TranslationLayout;
}): TypeChangeTarget[] {
  const at = args.componentRow === true ? { componentRow: true } : {};
  const typeOf = (field: FieldDefinition) =>
    args.inJson === true
      ? fieldTypeInJson(field, args.dialect, args.builtBy)
      : fieldTypeOnDialect(field, args.dialect, args.builtBy, at);
  const from = typeOf(args.field);
  return args.candidates
    .filter(candidate => candidate.type !== args.field.type)
    .map(({ type, field }) => {
      // Asked under its saved name: a rename is the save's to judge, with the rest of it.
      const candidate = {
        ...(field ?? args.field),
        name: args.field.name,
        type,
      } as FieldDefinition;
      const to = typeOf(candidate);
      const blocked = pairBlocked(from, to);
      if (blocked !== null)
        return { type, blocked, refusal: null, outcome: null };
      const translation = refusalByTranslation(args, candidate);
      if (translation !== null) return { type, ...translation, outcome: null };
      const judged =
        args.inJson === true
          ? pairOutcomeHeldInJson(from, to)
          : pairOutcome(from, to);
      // Text kept per language beside a container's structure is not among the values the save judges,
      // so until it is, a change there is open only where every value is kept.
      if (keptPerLanguageInside(args, args.field)) {
        return judged === "keeps" && !saveMayRefuse(args.field, candidate)
          ? { type, blocked: null, refusal: null, outcome: judged }
          : { type, blocked: "unjudged-inside", refusal: null, outcome: null };
      }
      // Every value it may hold there would need rewriting, which the save refuses, whatever they are.
      if (judged === "needs-rewrite") {
        return {
          type,
          blocked: "needs-rewrite-inside",
          refusal: null,
          outcome: null,
        };
      }
      const outcome = saveMayRefuse(args.field, candidate)
        ? "may-lose"
        : judged;
      return { type, blocked: null, refusal: null, outcome };
    });
}

/**
 * The widest bounded text column any supported database makes: PostgreSQL's `varchar` limit. A width
 * past it is no column a save could make, and a candidate stating one would have a text that long
 * made to judge it, so it is refused as the request's own error.
 */
const WIDEST_TEXT_COLUMN = 10_485_760;

/** A stated width, read as far as the column builders read one (`declaredMaxLength`): bounded here. */
const StatedWidth = z
  .unknown()
  .refine(width => typeof width !== "number" || width <= WIDEST_TEXT_COLUMN, {
    message: `A width is at most ${WIDEST_TEXT_COLUMN} characters.`,
  })
  .optional();

/**
 * A field as the change would save it. Of its settings, those the rules read are parsed here; a
 * choice's options are a list, a relationship's an object, and each is read as far as it is one.
 */
const CandidateField = z.looseObject({
  hasMany: z.boolean().nullish(),
  unique: z.boolean().nullish(),
  localized: z.boolean().nullish(),
  options: z
    .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
    .nullish(),
  // A field group's width is a top-level `maxLength`; a collection's, its rule's.
  maxLength: StatedWidth,
  validation: z.looseObject({ maxLength: StatedWidth }).nullish(),
});

/** The settings the page knows a field as saved by, each as the Builder loads it. */
const SavedSettings = z.object({
  hasMany: z.boolean(),
  unique: z.boolean(),
  /** Left out where the saved definition does not say: the type's own default. */
  localized: z.boolean().optional(),
  options: z.array(z.string()),
  /** Its rules, Required among them. */
  validation: z.record(z.string(), z.unknown()).default({}),
});

/**
 * What the type picker asks: the saved field, by its path of names through its groups and repeaters,
 * the type and settings the page knows it as saved by, and the types it offers, each with the field
 * as the change would save it; the field types the catalog lists where it names none.
 */
const TargetsRequest = z.object({
  field: z.array(z.string().min(1)).min(1).max(20),
  // What the page knows the field as saved by: an answer for another type, or other settings, is
  // refused, since the picker's marks would describe a definition that is no longer stored.
  type: z.string().min(1),
  saved: SavedSettings.optional(),
  candidates: z
    .array(
      z.object({ type: z.string().min(1), field: CandidateField.optional() })
    )
    .max(100)
    .optional(),
});

/**
 * Whether the stored field reads by the settings the page knows it as saved by. Each is compared as
 * it reads, never as it is written, so a definition that leaves a default out and one that states it
 * are the same: whether it is translated by `isFieldLocalized`, its options by their values, and what
 * it asks of a value by `asksOf`, over the rules a Builder save writes: Required, and those under
 * `validation`, taken together as the page loads them. Not compared: a rule of another name or stated
 * on the field itself, a plugin type's own options, and a number's or a text's storage. No Builder save
 * writes or changes these, and the page does not keep each as it is stored.
 */
function savedAsKnown(
  stored: FieldDefinition,
  known: z.infer<typeof SavedSettings>
): boolean {
  const asKnown = { ...stored, localized: known.localized };
  const asking = (unique: unknown, validation: unknown) =>
    JSON.stringify(
      asksOf({ unique, validation } as unknown as FieldDefinition)
    );
  const values = (options: readonly string[]) =>
    JSON.stringify([...options].sort());
  return (
    (stored.hasMany === true) === known.hasMany &&
    asking(stored.unique, {
      required: stored.required,
      ...stored.validation,
    }) === asking(known.unique, known.validation) &&
    isFieldLocalized(stored, true) === isFieldLocalized(asKnown, true) &&
    values(selectOptionValues(stored)) === values(known.options)
  );
}

/**
 * The fields on one level as a value is read there: a group with no name holds its fields on the
 * level it stands on, so they are found there, by their own names.
 */
function onLevel(fields: readonly FieldDefinition[]): FieldDefinition[] {
  return fields.flatMap(field =>
    field.type === "group" && !field.name
      ? onLevel(field.fields ?? [])
      : [field]
  );
}

/**
 * The field at `path` among `fields`, by name through groups and repeaters, if there is one, and
 * whether its value is held inside a container's JSON value: below a named group or a repeater.
 */
function fieldAt(
  fields: readonly FieldDefinition[],
  path: readonly string[],
  inJson = false
): { field: FieldDefinition; inJson: boolean } | undefined {
  const [name, ...rest] = path;
  const found = onLevel(fields).find(field => field.name === name);
  if (found === undefined) return undefined;
  if (rest.length === 0) return { field: found, inJson };
  return fieldAt(found.fields ?? [], rest, true);
}

/** `fields` with `field` standing at `path`, found by name through groups and repeaters as `fieldAt` does. */
function withFieldAt(
  fields: readonly FieldDefinition[],
  path: readonly string[],
  field: FieldDefinition
): FieldDefinition[] {
  const [name, ...rest] = path;
  return fields.map(each => {
    if (each.type === "group" && !each.name) {
      return { ...each, fields: withFieldAt(each.fields ?? [], path, field) };
    }
    if (each.name !== name) return each;
    return rest.length === 0
      ? field
      : { ...each, fields: withFieldAt(each.fields ?? [], rest, field) };
  });
}

/**
 * Whether `field`, standing at `path` among `fields`, is text its containers keep per language, beside the
 * one structure every language shares: asked of the shape the storage itself splits the outermost container
 * by (`sharedStructureShape`), so the two never disagree on what is kept there. Whatever the entity's own
 * switch says: each installation keeps its text per language.
 */
function translatedInsideContainers(
  fields: readonly FieldDefinition[],
  path: readonly string[],
  field: FieldDefinition
): boolean {
  const [outermost, ...rest] = path;
  const held = rest.at(-1);
  const container = onLevel(withFieldAt(fields, path, field)).find(
    each => each.name === outermost
  );
  if (container === undefined || held === undefined) return false;
  const shape = rest
    .slice(0, -1)
    .reduce<SharedStructureShape | null>(
      (level, name) => level?.inner[name] ?? null,
      sharedStructureShape(container)
    );
  return shape?.texts.includes(held) === true;
}

/** The entity a route answers for, as its save names it in a refusal. */
export interface TypeChangeEntity {
  kind: I18nTransitionKind;
  slug: string;
}

/**
 * Why changing the field at `path` among `fields` into `candidate` is blocked by the rules of the
 * container keeping it, on an entity stored per language, or null where none is. The save's own rules
 * first, over the save's own reading of the change, in its own words: a translated text there that
 * would stop being translated (`textHeldPerLanguageRefusals`), and a shared value there that would
 * become translated (`fieldsTurningTranslatedInside`). Then one the save does not refuse, where the
 * value is lost all the same: the container's first text on an entity keeping nothing per language yet,
 * whose translations the save makes empty, so the first save in one language takes it from the others.
 */
function containerRefusal(
  args: {
    fields: readonly FieldDefinition[];
    path: readonly string[];
    entity: TypeChangeEntity;
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
    componentRow?: boolean;
  },
  saved: FieldDefinition,
  candidate: FieldDefinition
): Blocked | null {
  const at = args.path.join(".");
  const next = withFieldAt(args.fields, args.path, candidate);
  const [held] = textHeldPerLanguageRefusals(
    {
      label: entityLabel(args.entity.kind, args.entity.slug),
      // Read for which fields the entity keeps per language before the change; no table is read.
      table: "",
      ...perLanguageBefore({ localized: true }, "", args.fields),
      previous: args.fields,
      next,
      builtBy: args.builtBy,
      ...(args.componentRow === true ? { componentRow: true } : {}),
    },
    fieldTypeChangesOf({
      previous: args.fields,
      next,
      dialect: args.dialect,
      builtBy: args.builtBy,
      ...(args.componentRow === true ? { componentRow: true } : {}),
      nested: true,
    })
  ).filter(refusal => refusal.path === at);
  if (held !== undefined) {
    return {
      blocked: "leaves-translation-inside",
      refusal: { code: held.code, reason: held.message, steps: [] },
    };
  }
  const turning = fieldTurningTranslatedRefusal(
    args.entity,
    fieldsTurningTranslatedInside(
      args.fields as unknown as StructuredField[],
      next as unknown as StructuredField[]
    ).filter(path => path === at)
  );
  if (turning !== undefined) {
    return {
      blocked: "joins-translation-inside",
      refusal: {
        code: turning.code,
        reason: turning.publicMessage,
        steps: [],
      },
    };
  }
  const firstText =
    !translatedInsideContainers(args.fields, args.path, saved) &&
    translatedInsideContainers(args.fields, args.path, candidate) &&
    keepsNothingPerLanguage(args);
  if (firstText) return { blocked: "joins-translation-inside", refusal: null };
  return null;
}

/**
 * Whether the entity keeps no translations table: none of `fields` has a column there, as the
 * table is made (`deriveCompanionTableSpec`). Its first text inside a container gets one made empty.
 */
function keepsNothingPerLanguage(args: {
  fields: readonly FieldDefinition[];
  entity: TypeChangeEntity;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): boolean {
  return (
    deriveCompanionTableSpec({
      slug: args.entity.slug,
      kind: args.entity.kind,
      fields: args.fields as unknown as Parameters<
        typeof deriveCompanionTableSpec
      >[0]["fields"],
      dialect: args.dialect,
      // Neither names a column; only whether the table has one is asked.
      defaultLocale: "en",
      collectionLocalized: true,
      builtBy: args.builtBy,
    }) === null
  );
}

/**
 * The type picker's answer for a saved field of an entity whose stored fields are `fields`, as a
 * list (`{ items, meta }`). Shared by the collection, Single and field-group routes, so the three
 * answer alike; `layout` says where each keeps its translated values.
 */
export function respondTypeChangeTargets(args: {
  fields: readonly FieldDefinition[];
  body: unknown;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
  layout: TranslationLayout;
  /** The entity, as its save names it in a refusal the answer repeats. */
  entity: TypeChangeEntity;
}): Response {
  let request: z.infer<typeof TargetsRequest>;
  try {
    request = TargetsRequest.parse(args.body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) throw nextlyValidationFromZod(error);
    throw error;
  }
  const found = fieldAt(args.fields, request.field);
  if (found === undefined) {
    throw NextlyError.notFound({
      message: `No saved field ${request.field.join(".")}.`,
    });
  }
  if (
    found.field.type !== request.type ||
    (request.saved !== undefined && !savedAsKnown(found.field, request.saved))
  ) {
    throw NextlyError.conflict({
      message: `The saved field ${request.field.join(".")} has changed since the page was loaded. Reload it to see the field as saved.`,
    });
  }
  const adapter = getAdapterFromDI();
  if (adapter === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "adapter-not-initialized" },
    });
  }
  const dialect = adapter.getCapabilities().dialect;
  const items = typeChangeTargets({
    field: found.field,
    inJson: found.inJson,
    translatedInside: field =>
      translatedInsideContainers(args.fields, request.field, field),
    inside: candidate =>
      containerRefusal(
        {
          fields: args.fields,
          path: request.field,
          entity: args.entity,
          dialect,
          builtBy: args.builtBy,
          ...(args.componentRow === true ? { componentRow: true } : {}),
        },
        found.field,
        candidate
      ),
    candidates:
      request.candidates ??
      FIELD_TYPE_CATALOG.map(entry => ({ type: entry.type })),
    dialect,
    builtBy: args.builtBy,
    ...(args.componentRow === true ? { componentRow: true } : {}),
    layout: args.layout,
  });
  return respondList(
    items,
    toPaginationMeta({
      total: items.length,
      page: 1,
      limit: Math.max(items.length, 1),
      totalPages: 1,
    })
  );
}
