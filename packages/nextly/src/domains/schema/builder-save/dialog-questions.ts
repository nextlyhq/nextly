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
import { offeredCompanionRename } from "../../i18n/migration/companion-rename";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { previewDesiredSchema } from "../pipeline/preview";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
  type LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";
import { PromptCancelledError } from "../pipeline/prompt-dispatcher/errors";
import { pushQuestionSet } from "../pipeline/pushschema-pipeline";
import type { Resolution } from "../pipeline/resolution/types";
import type { DesiredSchema } from "../pipeline/types";
import {
  columnsNotDescribed,
  leftoverColumns,
} from "../services/collection-schema-apply";
import {
  fieldsStoredOnRow,
  toSnakeCase,
  type ColumnOrigin,
} from "../services/field-column-descriptor";
import { rowFieldDiff } from "../services/field-diff";
import {
  fieldsLosingTheirColumn,
  relationshipsDroppingLinks,
} from "../services/field-storage-moves";

/**
 * Refuse a dialog save whose request leaves a question the push asks unanswered, judged by the
 * push's own dispatcher over what the push would ask of the entity's table: the rename candidates
 * and the drops of columns holding values the preview of `desired` finds there, and the drop of
 * each removed field kept per language, whose values the translations table holds, confirmed by
 * name or answered as the rename the dialog offered. Refused as the push refuses it (`cancelled`).
 */
export async function refuseUnansweredDialogQuestions(args: {
  desired: DesiredSchema;
  db: unknown;
  dialect: SupportedDialect;
  /** The entity's table, the only one its migration file changes. */
  tableName: string;
  /** Which builder made the entity's table, which decides its columns (`ColumnOrigin`). */
  builtBy: ColumnOrigin;
  /** The fields before and after the change, and whether the entity is translated before and after. */
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  wasLocalized: boolean;
  isLocalized: boolean;
  renameResolutions: readonly BrowserRenameResolution[];
  eventResolutions: readonly Resolution[];
  legacy?: LegacyResolutionsBundle;
  /**
   * The row columns the save's planned moves carry into a group (`planEntityMoves`), whose values
   * its file copies before the column goes. Never the request's hints alone: a column named there
   * but not planned as a move is still asked about.
   */
  moved?: readonly string[];
  /**
   * Set by a collection's dialog: a column of its own table that no field describes, left
   * unanswered by the request, is refused as the push refuses it (`columnsNotDescribed`), rather
   * than as cancelled.
   */
  collection?: { slug: string };
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
  // The drops the request answers for are those of the fields the change removes, as the dialog
  // lists them for the person to confirm (`rowFieldDiff`), a field inside a group with no name
  // included, and those of the fields it keeps by name that lose their column on the row
  // (`fieldsLosingTheirColumn`).
  const wasStored = storesPerLanguage({ localized: args.wasLocalized });
  const removedFields = rowFieldDiff(args.oldFields, args.newFields, {
    localized: wasStored,
    newLocalized: storesPerLanguage({ localized: args.isLocalized }),
  }).removed;
  const losingColumn = fieldsLosingTheirColumn(args.oldFields, args.newFields, {
    dialect: args.dialect,
    builtBy: args.builtBy,
  });
  // A column a move carries into a group is not a drop: the save's file copies its values before
  // the column goes, so it is asked nothing (`moved`, from the save's planned moves).
  const moved = new Set(args.moved ?? []);
  const removed = new Set(
    [...removedFields, ...losingColumn]
      .map(field => toSnakeCase(field.name))
      .filter(column => !moved.has(column))
  );
  // A removed field kept per language, or one kept by name that loses its column, has its values
  // in the translations table, which the preview does not read: its drop is confirmed by the
  // field's name, as the dialog sends it, or
  // answered as the rename the dialog offered for it on the translations table
  // (`offeredCompanionRename`, the one offer the preview shows and the apply takes back), `rename`
  // keeping its values and `drop_and_add` the consent to lose them. A resolution naming any other
  // pair answers nothing. Unanswered, the file would drop every language's values with nobody
  // asked.
  // Asked of where the values are stored, as the apply's `resolveCompanionRename` is: under
  // per-language storage an untranslated entity keeps them in the translations table too.
  const offered = await offeredCompanionRename({
    tableName: args.tableName,
    oldFields: args.oldFields,
    newFields: args.newFields,
    wasLocalized: wasStored,
    isLocalized: storesPerLanguage({ localized: args.isLocalized }),
    dialect: args.dialect,
    builtBy: args.builtBy,
  });
  const answeredAsOffered = (column: string) =>
    offered !== undefined &&
    offered.candidate.fromColumn === column &&
    args.renameResolutions.some(
      resolution =>
        resolution.tableName === offered.candidate.tableName &&
        resolution.fromColumn === offered.candidate.fromColumn &&
        resolution.toColumn === offered.candidate.toColumn
    );
  const confirmedByName = (field: FieldDefinition) =>
    args.legacy?.byFieldName[field.name]?.action === "confirm_drop";
  const unconfirmedTranslated = [...removedFields, ...losingColumn].filter(
    field =>
      isFieldLocalized(field, wasStored) &&
      !answeredAsOffered(toSnakeCase(field.name)) &&
      !confirmedByName(field)
  );
  // A relationship whose links go with a link table, removed or kept by name with its links moving
  // into, out of or to another link table, takes every link with it, which the preview, reading
  // the entity's own columns, does not ask about: its drop is confirmed by the field's name, as the
  // dialog confirms each change it warns of.
  const unconfirmedLinks = relationshipsDroppingLinks(
    args.oldFields,
    args.newFields,
    args.builtBy,
    args.dialect
  ).filter(field => !confirmedByName(field));
  const unconfirmed = [...unconfirmedTranslated, ...unconfirmedLinks];
  if (unconfirmed.length > 0) {
    throw cancelled(
      args.tableName,
      unconfirmed.map(field => field.name)
    );
  }
  // The push's own questions of the entity's table (`pushQuestionSet`: a drop a rename candidate
  // covers is asked as that pair), of which the drops asked are those of the fields the change
  // removes or takes the column of, as the dialog lists them.
  const asked = pushQuestionSet({
    candidates,
    events: preview.events.filter(event => event.tableName === args.tableName),
  });
  const events = asked.events.filter(
    event => event.kind !== "destructive_drop" || removed.has(event.columnName)
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
  if (answer.proceed) return;
  // What the dispatch left unanswered on the collection's own table, by the push's own decision
  // once the answers are applied (`leftoverColumns`): a column of it that no field describes,
  // before or after the change, is one the Builder never made, and the save is refused naming it,
  // as the push refuses it. One the request answers, as a rename onto a field it adds or a drop it
  // confirms, is not left over. Any other unanswered question is the cancellation it is.
  if (args.collection !== undefined) {
    const described = new Set(
      [
        ...fieldsStoredOnRow(args.oldFields),
        ...fieldsStoredOnRow(args.newFields),
      ].map(field => toSnakeCase(field.name))
    );
    const leftover = leftoverColumns(
      args.tableName,
      { candidates, events },
      answer,
      args.renameResolutions
    ).filter(column => !described.has(column));
    if (leftover.length > 0) {
      throw columnsNotDescribed(args.collection.slug, args.tableName, leftover);
    }
  }
  throw cancelled(args.tableName, []);
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
