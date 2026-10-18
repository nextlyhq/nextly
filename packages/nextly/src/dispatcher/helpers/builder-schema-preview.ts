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

import { columnsMovingToCompanion } from "../../domains/i18n/migration/field-joins-translation";
import { previewBodyWithLeavingTranslation } from "../../domains/i18n/migration/preview-leaving-translation";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
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
  // so the preview judges that drop as the apply will.
  const wasLocalized = args.entity.localized === true;
  const pipelinePreview = await previewDesiredSchema({
    desired: args.desired,
    db,
    dialect,
    columnsMovedToCompanion: columnsMovingToCompanion({
      tableName,
      dialect,
      builtBy: args.builtBy,
      oldFields: currentFields,
      newFields,
      wasLocalized,
      isLocalized: args.requestedLocalized ?? wasLocalized,
    }),
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
      // Detected by the same pipeline run, so they describe the same diff.
      renamed: pipelinePreview.candidates.map(toRenameCandidateWire),
      schemaVersion: args.schemaVersion,
    }
  );
}
