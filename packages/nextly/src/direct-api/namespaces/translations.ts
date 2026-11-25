/**
 * Direct API `nextly.translations.*`: a translated document's texts, their sources and the
 * suggestions open for them, from server code.
 *
 * The same operations as the REST routes, through the functions those run. Trusted by default, as
 * the rest of the Direct API is: a trusted call reads every field, and may dismiss a suggestion.
 * Keeping a translation as it is, and accepting a suggestion, stay a signed-in person's acts, so
 * each needs `overrideAccess: false` and the `user` who decided.
 *
 * @experimental
 *
 * @module direct-api/namespaces/translations
 */
import type {
  DocumentCaller,
  TranslatedDocument,
} from "../../domains/i18n/pipeline/document-access";
import type {
  FieldInLanguage,
  KeepCurrentInput,
  SourceChange,
} from "../../domains/i18n/pipeline/source-review";
import type { AcceptedSuggestion } from "../../domains/i18n/pipeline/suggestions";
import type { UnitsAnswer } from "../../domains/i18n/pipeline/unit-answer";
import type { DirectAPIConfig } from "../types";
import type { MutationResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { accessOptions, mergeConfig, runAsCaller } from "./helpers";

/** The document a call is of: an entry, or a Single. */
type TranslationTarget =
  | { collection: string; id: string; single?: never }
  | { single: string; collection?: never; id?: never };

/**
 * One open suggestion of a document, in its language.
 *
 * @experimental
 */
export interface SuggestionInLanguage {
  locale: string;
  /** The suggestion's id, as `units` answered it. */
  suggestionId: string;
}

/**
 * An accepted suggestion, and the document's version now.
 *
 * @experimental
 */
export interface SuggestionAccepted
  extends SuggestionInLanguage,
    AcceptedSuggestion {}

export interface TranslationsNamespace {
  /**
   * What changed in a translated field's source since its translation was made: the source then
   * and now, or why the older text is not there to show.
   *
   * @experimental
   */
  sourceChange(
    args: TranslationTarget & FieldInLanguage & DirectAPIConfig
  ): Promise<SourceChange>;
  /**
   * Mark a field's translation as right against its source as that is now, naming the fingerprints
   * `sourceChange` answered. The text, its origin and any draft stay as they are.
   *
   * @experimental
   */
  keepCurrent(
    args: TranslationTarget & KeepCurrentInput & DirectAPIConfig
  ): Promise<MutationResult<FieldInLanguage>>;
  /**
   * A document's translatable texts in one language: each text's value, whether the caller may
   * change it, the languages it may be translated from, and the suggestion open for it.
   *
   * @experimental
   */
  units(
    args: TranslationTarget & { locale: string } & DirectAPIConfig
  ): Promise<UnitsAnswer>;
  /**
   * Accept a suggestion: its text, or `value` where the person changed it, becomes that language's,
   * as the person's own save of it would, and the suggestion is gone. A `value` of `null` clears
   * the text.
   *
   * @experimental
   */
  acceptSuggestion(
    args: TranslationTarget &
      SuggestionInLanguage & { value?: unknown } & DirectAPIConfig
  ): Promise<MutationResult<SuggestionAccepted>>;
  /**
   * Dismiss a suggestion. The text it is for stays as it is.
   *
   * @experimental
   */
  dismissSuggestion(
    args: TranslationTarget & SuggestionInLanguage & DirectAPIConfig
  ): Promise<MutationResult<SuggestionInLanguage>>;
}

/** The functions REST runs, loaded on first use: their modules reach the services that build this. */
const review = () => import("../../domains/i18n/pipeline/source-review");
const suggestions = () => import("../../domains/i18n/pipeline/suggestions");

function documentOf(target: TranslationTarget): TranslatedDocument {
  return target.single !== undefined
    ? { kind: "single", slug: target.single }
    : { kind: "collection", slug: target.collection, id: target.id };
}

/** The caller a call names, over the instance's defaults. */
function callerOf(ctx: NextlyContext, args: DirectAPIConfig): DocumentCaller {
  const config = mergeConfig(ctx.defaultConfig, args);
  const { user, authenticatedScope, request, overrideAccess, ...fields } =
    accessOptions(config);
  return {
    user,
    authenticatedScope,
    request,
    context: config.context,
    overrideAccess: overrideAccess !== false,
    // A trusted call may still ask for the field rules, as whoever it names.
    enforceFieldAccess: fields.enforceFieldAccess,
    fieldAccessUser: fields.fieldAccessUser,
  };
}

export function createTranslationsNamespace(
  ctx: NextlyContext
): TranslationsNamespace {
  return {
    sourceChange: args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const { sourceChange } = await review();
        return sourceChange(documentOf(callArgs), callerOf(ctx, callArgs), {
          locale: callArgs.locale,
          field: callArgs.field,
        });
      }),
    keepCurrent: args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const { locale, field, valueFingerprint, sourceFingerprint } = callArgs;
        const { keepCurrent } = await review();
        await keepCurrent(documentOf(callArgs), callerOf(ctx, callArgs), {
          locale,
          field,
          valueFingerprint,
          sourceFingerprint,
        });
        return {
          message: "Translation kept as it is.",
          item: { locale, field },
        };
      }),
    units: args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const { unitsAnswer } = await import(
          "../../domains/i18n/pipeline/unit-answer"
        );
        return unitsAnswer(documentOf(callArgs), callerOf(ctx, callArgs), {
          locale: callArgs.locale,
        });
      }),
    acceptSuggestion: args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const { locale, suggestionId, value } = callArgs;
        const { acceptSuggestion } = await suggestions();
        const accepted = await acceptSuggestion(
          documentOf(callArgs),
          callerOf(ctx, callArgs),
          {
            locale,
            id: suggestionId,
            // Null is a text the person cleared; only undefined is none.
            ...(value === undefined ? {} : { value }),
          }
        );
        return {
          message: "Suggestion accepted.",
          item: { locale, suggestionId, ...accepted },
        };
      }),
    dismissSuggestion: args =>
      runAsCaller(ctx.defaultConfig, args, async callArgs => {
        const { locale, suggestionId } = callArgs;
        const { dismissSuggestion } = await suggestions();
        await dismissSuggestion(documentOf(callArgs), callerOf(ctx, callArgs), {
          locale,
          id: suggestionId,
        });
        return {
          message: "Suggestion dismissed.",
          item: { locale, suggestionId },
        };
      }),
  };
}
