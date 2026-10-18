/**
 * What a schema change's preview says about fields that stop being translated.
 *
 * Applying the change archives every non-default language's value of such a field and keeps the
 * default language's value as the shared one (`archiveFieldsLeavingTranslation`). Before Apply,
 * the Schema Builder shows how many values in which languages that moves, how to bring them back,
 * and, for a field that cannot leave translation in one change, why not. One helper for the
 * collection, Single and field-group previews, so the three cannot say different things.
 *
 * @module domains/i18n/migration/preview-leaving-translation
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { countValuesByLocale } from "../../schema/pipeline/classifier/count-helpers";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import {
  type LeavingFieldLike,
  refusalsForFieldsLeavingTranslation,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { fieldsLeavingTranslation } from "./reconcile-companion";

/** One field leaving translation, as the preview reports it. */
export interface LeavingTranslationPreview {
  /** The field's name. */
  name: string;
  /** How many values move to the archive, by language. A language with none is absent. */
  byLocale: Record<string, number>;
  /** The sum of `byLocale`. */
  total: number;
  /** The language whose value becomes the shared one, and so is not archived. */
  defaultLocale: string;
  /** The command that brings the archived values back once the field is translated again. */
  restoreCommand: string;
  /**
   * Why the change will be refused, and the changes that get there instead, when it will be;
   * Apply is not offered then.
   */
  refusal?: { reason: string; steps: string[] };
}

/**
 * The fields leaving translation in this change, with what moves where.
 *
 * Nothing unless the entity is translated before and after the change. A count that cannot be
 * read is reported as none rather than failing the preview: the counts inform, while the archive
 * write at Apply is what keeps the values, and it refuses on its own if it cannot.
 */
export interface PreviewLeavingArgs {
  db: unknown;
  dialect: SupportedDialect;
  /** The collection, Single or field group, as `nextly i18n:restore --collection` takes it. */
  slug: string;
  /** Its main table; the companion is `<tableName>_locales`. */
  tableName: string;
  builtBy: ColumnOrigin;
  defaultLocale: string;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  wasLocalized: boolean;
  isLocalized: boolean;
}

export async function previewFieldsLeavingTranslation(
  args: PreviewLeavingArgs
): Promise<LeavingTranslationPreview[]> {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const leaving = fieldsLeavingTranslation(args.oldFields, args.newFields);
  if (leaving.length === 0) return [];

  const refusals = new Map(
    refusalsForFieldsLeavingTranslation({
      leaving: new Set(leaving),
      newFields: args.newFields,
      oldFields: args.oldFields,
      dialect: args.dialect,
      builtBy: args.builtBy,
      surface: "builder",
    }).map(refusal => [
      refusal.path.replace(/^fields\./, ""),
      { reason: refusal.reason, steps: refusal.steps },
    ])
  );

  const previews: LeavingTranslationPreview[] = [];
  for (const field of args.oldFields.filter(f => leaving.includes(f.name))) {
    const column = fieldToLocalizedColumnSpec(
      field,
      args.dialect,
      args.builtBy
    );
    let byLocale: Record<string, number> = {};
    if (column) {
      try {
        byLocale = await countValuesByLocale(
          args.db,
          args.dialect,
          `${args.tableName}_locales`,
          column.name,
          args.defaultLocale
        );
      } catch {
        byLocale = {};
      }
    }
    const refusal = refusals.get(field.name);
    previews.push({
      name: field.name,
      byLocale,
      total: Object.values(byLocale).reduce((sum, n) => sum + n, 0),
      defaultLocale: args.defaultLocale,
      restoreCommand: `nextly i18n:restore --collection ${args.slug} --field ${field.name}`,
      ...(refusal !== undefined ? { refusal } : {}),
    });
  }
  return previews;
}

/**
 * A preview with the fields leaving translation added. Such a field is a change even when nothing
 * else is, so the builder opens its dialog instead of saving straight away.
 */
export function withLeavingTranslation<T extends { hasChanges: boolean }>(
  preview: T,
  leaving: readonly LeavingTranslationPreview[]
): T & { leavingTranslation: LeavingTranslationPreview[] } {
  return {
    ...preview,
    hasChanges: preview.hasChanges || leaving.length > 0,
    leavingTranslation: [...leaving],
  };
}

/**
 * A schema preview's response body: the pipeline's preview with the fields leaving translation
 * added, and whatever else the preview returns beside it (its rename candidates and the version
 * the editor echoes back on Apply). Assembled once for the collection, Single and field-group
 * previews.
 *
 * Whether the entity is translated before the change is read from its registry record; whether it
 * will be after is the request's flag, falling back to the record when the request leaves it out.
 */
export async function previewBodyWithLeavingTranslation(
  preview: { hasChanges: boolean },
  args: Omit<PreviewLeavingArgs, "wasLocalized" | "isLocalized"> & {
    entity: { localized?: unknown };
    requestedLocalized: boolean | undefined;
  },
  rest: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { entity, requestedLocalized, ...common } = args;
  const wasLocalized = entity.localized === true;
  const leaving = await previewFieldsLeavingTranslation({
    ...common,
    wasLocalized,
    isLocalized: requestedLocalized ?? wasLocalized,
  });
  return { ...withLeavingTranslation(preview, leaving), ...rest };
}
