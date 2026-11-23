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
 * would keep its old type.
 *
 * @module dispatcher/helpers/type-change-targets
 */
import { z } from "zod";

import { respondList } from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { FIELD_TYPE_CATALOG } from "../../collections/fields/catalog";
import { isFieldLocalized } from "../../domains/i18n/classify-fields";
import { joiningFieldsLosingValues } from "../../domains/i18n/migration/archive-preflight";
import { fieldsJoiningTranslation } from "../../domains/i18n/migration/field-joins-translation";
import {
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
  type LeavingTranslationRefusal,
} from "../../domains/i18n/migration/field-leaves-translation-rules";
import { retypedCompanionColumns } from "../../domains/i18n/migration/plan-companion-type-change";
import { fieldsLeavingTranslation } from "../../domains/i18n/migration/reconcile-companion";
import type {
  ColumnOrigin,
  SupportedDialect,
} from "../../domains/schema/services/field-column-descriptor";
import {
  fieldTypeInJson,
  fieldTypeOnDialect,
} from "../../domains/schema/value-conversion/type-change/field-type";
import {
  TRANSLATIONS_COLUMN_KEEPS_ITS_TYPE,
  translationsColumnChanges,
} from "../../domains/schema/value-conversion/type-change/field-type-changes";
import {
  pairBlocked,
  type PairBlockReason,
} from "../../domains/schema/value-conversion/type-change/judge";
import {
  pairOutcome,
  type PairOutcome,
} from "../../domains/schema/value-conversion/type-change/pair-outcome";
import { NextlyError } from "../../errors/nextly-error";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

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
  | "translations-column";

/** A refusal in the save's own words: its code, why, and the changes that get there instead. */
export interface TypeChangeRefusalWords {
  code: string;
  reason: string;
  steps: string[];
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
 * Each of `candidates` other than the field's own type, judged as a change from `field`, a field
 * as its entity stores it, on the database this runs on. `builtBy` and `componentRow` say where its
 * values are kept, as the save that would make the change reads them; `inJson`, that they are held
 * inside a named group's or a repeater's JSON value, as the save judges such a field. `layout`, where
 * the entity keeps its translated values: a field held in a container's JSON is translated, or not,
 * with its container, so no translation rule is asked of it.
 */
export function typeChangeTargets(args: {
  field: FieldDefinition;
  candidates: readonly string[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
  inJson?: boolean;
  layout?: TranslationLayout;
}): TypeChangeTarget[] {
  const at = args.componentRow === true ? { componentRow: true } : {};
  const typeOf = (field: FieldDefinition) =>
    args.inJson === true
      ? fieldTypeInJson(field, args.dialect, args.builtBy)
      : fieldTypeOnDialect(field, args.dialect, args.builtBy, at);
  const from = typeOf(args.field);
  return args.candidates
    .filter(type => type !== args.field.type)
    .map(type => {
      const candidate = { ...args.field, type } as FieldDefinition;
      const to = typeOf(candidate);
      const blocked = pairBlocked(from, to);
      if (blocked !== null)
        return { type, blocked, refusal: null, outcome: null };
      const translation =
        args.layout?.perLanguage === true && args.inJson !== true
          ? translationRefusal({
              from: args.field,
              to: candidate,
              dialect: args.dialect,
              builtBy: args.builtBy,
              fileRetypes: args.layout.fileRetypes,
            })
          : null;
      if (translation !== null) return { type, ...translation, outcome: null };
      return {
        type,
        blocked: null,
        refusal: null,
        outcome: pairOutcome(from, to),
      };
    });
}

/**
 * What the type picker asks: the saved field, by its path of names through its groups and repeaters,
 * and the types it offers; the field types the catalog lists where it names none.
 */
const TargetsRequest = z.object({
  field: z.array(z.string().min(1)).min(1).max(20),
  candidates: z.array(z.string().min(1)).max(100).optional(),
});

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
  const adapter = getAdapterFromDI();
  if (adapter === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "adapter-not-initialized" },
    });
  }
  const items = typeChangeTargets({
    field: found.field,
    inJson: found.inJson,
    candidates:
      request.candidates ?? FIELD_TYPE_CATALOG.map(entry => entry.type),
    dialect: adapter.getCapabilities().dialect,
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
