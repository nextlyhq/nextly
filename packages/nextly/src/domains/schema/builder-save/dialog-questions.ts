/**
 * The questions a Schema Builder dialog's push asks before it changes anything, asked of a save
 * that runs its own migration file instead: a pair of columns the change may rename, and a column
 * holding values that the change removes the field of. The push refuses a request that leaves
 * either unanswered, rather
 * than drop a column's values on a question nobody answered (`BrowserPromptDispatcher`); a file
 * written from the same request would drop them, so that save is refused the same way, before
 * anything is written. The admin's dialog answers each pair it shows and confirms each drop, so
 * only a request that leaves one out is refused.
 *
 * @module domains/schema/builder-save/dialog-questions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { appLocalization } from "../../i18n/configured-locales";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { previewDesiredSchema } from "../pipeline/preview";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
  type LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";
import { PromptCancelledError } from "../pipeline/prompt-dispatcher/errors";
import type { Resolution } from "../pipeline/resolution/types";
import type { DesiredSchema } from "../pipeline/types";
import { toSnakeCase } from "../services/field-column-descriptor";
import { rowFieldDiff } from "../services/field-diff";

/**
 * Refuse a dialog save whose request leaves a question the push asks unanswered, judged by the
 * push's own dispatcher over what the push would ask of the entity's table: the rename candidates
 * and the drops of columns holding values the preview of `desired` finds there, and the drop of
 * each removed field kept per language, whose values the translations table holds. Refused as the
 * push refuses it (`cancelled`).
 */
export async function refuseUnansweredDialogQuestions(args: {
  desired: DesiredSchema;
  db: unknown;
  dialect: SupportedDialect;
  /** The entity's table, the only one its migration file changes. */
  tableName: string;
  /** The fields before and after the change, and whether the entity is translated before and after. */
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  wasLocalized: boolean;
  isLocalized: boolean;
  renameResolutions: readonly BrowserRenameResolution[];
  eventResolutions: readonly Resolution[];
  legacy?: LegacyResolutionsBundle;
}): Promise<void> {
  const preview = await previewDesiredSchema({
    desired: args.desired,
    db: args.db,
    dialect: args.dialect,
    defaultLocale: appLocalization()?.defaultLocale ?? "en",
  });
  const candidates = preview.candidates.filter(
    candidate => candidate.tableName === args.tableName
  );
  // A drop a rename candidate covers is asked as that pair, as the push asks it: answering
  // `drop_and_add` is the consent to lose its values.
  const covered = new Set(candidates.map(candidate => candidate.fromColumn));
  // The drops the request answers for are those of the fields the change removes, as the dialog
  // lists them for the person to confirm (`rowFieldDiff`), a field inside a group with no name
  // included. A field it keeps by name whose column goes, a relationship stored in a link table
  // now, is a change of storage the save carries.
  const wasStored = storesPerLanguage({ localized: args.wasLocalized });
  const removedFields = rowFieldDiff(args.oldFields, args.newFields, {
    localized: wasStored,
    newLocalized: storesPerLanguage({ localized: args.isLocalized }),
  }).removed;
  const removed = new Set(removedFields.map(field => toSnakeCase(field.name)));
  // A removed field kept per language has its values in the translations table, which the
  // preview does not read: its drop is confirmed by the field's name, as the dialog sends it, or
  // by its translations column's drop event; or it is answered as a rename's pair, `rename`
  // keeping its values and `drop_and_add` the consent to lose them, as the push takes a pair's
  // answer. Unanswered, the file would drop every language's values with nobody asked.
  const companion = `${args.tableName}_locales`;
  const answeredAsPair = (column: string) =>
    args.renameResolutions.some(
      resolution =>
        resolution.fromColumn === column &&
        (resolution.tableName === companion ||
          resolution.tableName === args.tableName)
    );
  const unconfirmedTranslated = removedFields.filter(field => {
    const column = toSnakeCase(field.name);
    return (
      isFieldLocalized(field, wasStored) &&
      !answeredAsPair(column) &&
      args.legacy?.byFieldName[field.name]?.action !== "confirm_drop" &&
      !args.eventResolutions.some(
        resolution =>
          resolution.kind === "confirm_drop" &&
          resolution.eventId === `destructive_drop:${companion}.${column}`
      )
    );
  });
  if (unconfirmedTranslated.length > 0) {
    throw cancelled(
      args.tableName,
      unconfirmedTranslated.map(field => field.name)
    );
  }
  const events = preview.events.filter(
    event =>
      event.tableName === args.tableName &&
      (event.kind !== "destructive_drop" ||
        (removed.has(event.columnName) && !covered.has(event.columnName)))
  );
  if (candidates.length === 0 && events.length === 0) return;
  const answer = await new BrowserPromptDispatcher(
    [...args.renameResolutions],
    [...args.eventResolutions],
    args.legacy
  ).dispatch({
    candidates,
    events,
    classification: preview.classification,
    channel: "browser",
  });
  if (!answer.proceed) throw cancelled(args.tableName, []);
}

/**
 * A save refused for a question its request left unanswered, told as the push tells it: the push's
 * own cancellation (`PromptCancelledError`) as the apply failure it answers with, its message the
 * person reads.
 */
function cancelled(table: string, unconfirmed: readonly string[]): NextlyError {
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: new PromptCancelledError().message,
    logContext: {
      reason: "unanswered-dialog-question",
      table,
      ...(unconfirmed.length > 0 ? { unconfirmedDrops: [...unconfirmed] } : {}),
    },
  });
}
