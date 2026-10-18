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

import { companionRenameCandidate } from "../../domains/i18n/migration/companion-rename";
import { previewBodyWithLeavingTranslation } from "../../domains/i18n/migration/preview-leaving-translation";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import type { RenameCandidate } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";
import { toRenameCandidateWire } from "../../domains/schema/pipeline/rename-candidate-wire";
import type { DesiredSchema } from "../../domains/schema/pipeline/types";
import type { ColumnOrigin } from "../../domains/schema/services/field-column-descriptor";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

import { getConfigFromDI } from "./di";

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
    defaultLocale: getConfigFromDI()?.localization?.defaultLocale ?? "en",
  });
  const legacyShape = await translatePipelinePreviewToLegacy(pipelinePreview, {
    tableName,
    currentFields,
    newFields,
    db,
    dialect,
  });
  return previewBodyWithLeavingTranslation(
    legacyShape,
    {
      db,
      dialect,
      slug: args.slug,
      tableName,
      builtBy: args.builtBy,
      defaultLocale: getConfigFromDI()?.localization?.defaultLocale ?? "en",
      oldFields: currentFields,
      newFields,
      entity: args.entity,
      requestedLocalized: args.requestedLocalized,
    },
    {
      // Detected by the same pipeline run, so they describe the same diff; a translated field's
      // rename, which the pipeline cannot see on the main table, is offered on its companion.
      renamed: [
        ...pipelinePreview.candidates,
        ...(await translatedFieldRename(args, args.entity.localized === true)),
      ].map(toRenameCandidateWire),
      schemaVersion: args.schemaVersion,
    }
  );
}

/**
 * The rename of a translated field, which lives on the companion and so is not among the
 * pipeline's candidates: the one the main table's rule (`detectFieldRename`) finds, offered on the
 * companion when the field is translated before and after (`companionRenameCandidate`).
 */
async function translatedFieldRename(
  args: Parameters<typeof builderSchemaPreviewBody>[0],
  wasLocalized: boolean
): Promise<RenameCandidate[]> {
  const { DynamicCollectionSchemaService } = await import(
    "../../domains/dynamic-collections/services/dynamic-collection-schema-service"
  );
  const candidate = companionRenameCandidate({
    tableName: args.tableName,
    detected: new DynamicCollectionSchemaService(
      undefined,
      args.dialect
    ).detectFieldRename(args.currentFields, args.newFields),
    wasLocalized,
    isLocalized: args.requestedLocalized ?? wasLocalized,
    dialect: args.dialect,
    builtBy: args.builtBy,
  });
  return candidate ? [candidate] : [];
}
