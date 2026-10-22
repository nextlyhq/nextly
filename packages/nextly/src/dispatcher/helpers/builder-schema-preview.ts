/**
 * The Schema Builder's preview of a change to one collection, Single or field group, as its
 * dispatcher answers it: what the change does to the table, the rename candidates the same
 * pipeline run detected, what moves to the localization archive for fields leaving translation,
 * and the version the editor echoes back on Apply.
 *
 * The three dispatchers differ in how they build the desired schema and which entity they read;
 * from there the preview is one sequence, kept here so the three cannot answer differently.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { appLocalization } from "../../domains/i18n/configured-locales";
import { offeredCompanionRename } from "../../domains/i18n/migration/companion-rename";
import { previewBodyWithLeavingTranslation } from "../../domains/i18n/migration/preview-leaving-translation";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import type { RenameCandidate } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";
import { toRenameCandidateWire } from "../../domains/schema/pipeline/rename-candidate-wire";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
import type { ColumnOrigin } from "../../domains/schema/services/field-column-descriptor";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

export async function builderSchemaPreviewBody(args: {
  desired: DesiredSchema;
  db: unknown;
  dialect: SupportedDialect;
  /** The entity's slug, as `nextly i18n:restore --collection` takes it. */
  slug: string;
  tableName: string;
  builtBy: ColumnOrigin;
  /** The entity's registry record, which says whether it is translated now. */
  entity: { localized?: unknown };
  currentFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** The request's localized flag, when the Builder sent one. */
  requestedLocalized: boolean | undefined;
  schemaVersion: number | undefined;
}): Promise<Record<string, unknown>> {
  const { db, dialect, tableName, currentFields, newFields } = args;
  // A field becoming translated takes its value to the companion before main drops its column,
  // so the preview judges that drop as the apply will: with the same default language.
  const pipelinePreview = await previewDesiredSchema({
    desired: args.desired,
    db,
    dialect,
    defaultLocale: appLocalization()?.defaultLocale ?? "en",
  });
  const legacyShape = await translatePipelinePreviewToLegacy(pipelinePreview, {
    tableName,
    currentFields,
    newFields,
    db,
    dialect,
  });
  // Detected by the same pipeline run, so they describe the same diff; a translated field's
  // rename, which the pipeline cannot see on the main table, is offered on its companion.
  const renamed = [
    ...pipelinePreview.candidates,
    ...(await translatedFieldRename(args, args.entity.localized === true)),
  ];
  return previewBodyWithLeavingTranslation(
    // A rename offered on the companion is a change though the main table has none, so the
    // builder opens its dialog to ask for the answer the apply requires.
    {
      ...legacyShape,
      hasChanges: legacyShape.hasChanges || renamed.length > 0,
    },
    {
      db,
      dialect,
      slug: args.slug,
      tableName,
      builtBy: args.builtBy,
      defaultLocale: appLocalization()?.defaultLocale ?? "en",
      oldFields: currentFields,
      newFields,
      entity: args.entity,
      requestedLocalized: args.requestedLocalized,
    },
    {
      renamed: renamed.map(toRenameCandidateWire),
      schemaVersion: args.schemaVersion,
    }
  );
}

/**
 * The rename of a translated field, which lives on the companion and so is not among the
 * pipeline's candidates: the one the apply accepts back (`offeredCompanionRename`).
 */
async function translatedFieldRename(
  args: Parameters<typeof builderSchemaPreviewBody>[0],
  wasLocalized: boolean
): Promise<RenameCandidate[]> {
  const offered = await offeredCompanionRename({
    tableName: args.tableName,
    oldFields: args.currentFields,
    newFields: args.newFields,
    wasLocalized,
    isLocalized: args.requestedLocalized ?? wasLocalized,
    dialect: args.dialect,
    builtBy: args.builtBy,
  });
  return offered ? [offered.candidate] : [];
}
