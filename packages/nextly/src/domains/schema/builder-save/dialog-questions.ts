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

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
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
import { computeFieldDiff } from "../services/field-diff";

/**
 * Refuse a dialog save whose request leaves a question the push asks unanswered, judged by the
 * push's own dispatcher over what the push would ask of the entity's table: the rename candidates
 * and the drops of columns holding values the preview of `desired` finds there. Thrown as the push
 * throws it (`PromptCancelledError`).
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
  // lists them for the person to confirm (`computeFieldDiff`). A field it keeps by name whose column
  // goes, a relationship stored in a link table now, is a change of storage the save carries.
  const removed = new Set(
    computeFieldDiff([...args.oldFields], [...args.newFields], {
      localized: storesPerLanguage({ localized: args.wasLocalized }),
      newLocalized: storesPerLanguage({ localized: args.isLocalized }),
    }).removed.map(field => toSnakeCase(field.name))
  );
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
  if (!answer.proceed) throw new PromptCancelledError();
}
