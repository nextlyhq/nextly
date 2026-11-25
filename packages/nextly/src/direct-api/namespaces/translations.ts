/**
 * Direct API `nextly.translations.*`: a translated field and its source, from server code.
 *
 * The same operations as the REST routes, through the functions those run. Trusted by default, as
 * the rest of the Direct API is: a trusted call reads every field. Keeping a translation as it is
 * stays a signed-in person's act, so it needs `overrideAccess: false` and the `user` who decided.
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
import type { DirectAPIConfig } from "../types";
import type { MutationResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { accessOptions, mergeConfig, runAsCaller } from "./helpers";

/** The document a call is of: an entry, or a Single. */
type TranslationTarget =
  | { collection: string; id: string; single?: never }
  | { single: string; collection?: never; id?: never };

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
}

/** The functions REST runs, loaded on first use: their modules reach the services that build this. */
const review = () => import("../../domains/i18n/pipeline/source-review");

function documentOf(target: TranslationTarget): TranslatedDocument {
  return target.single !== undefined
    ? { kind: "single", slug: target.single }
    : { kind: "collection", slug: target.collection, id: target.id };
}

/** The caller a call names, over the instance's defaults. */
function callerOf(ctx: NextlyContext, args: DirectAPIConfig): DocumentCaller {
  const config = mergeConfig(ctx.defaultConfig, args);
  const { user, authenticatedScope, request, overrideAccess } =
    accessOptions(config);
  return {
    user,
    authenticatedScope,
    request,
    context: config.context,
    overrideAccess: overrideAccess !== false,
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
  };
}
