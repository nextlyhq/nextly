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

import {
  countEntriesByKeptLocale,
  countParentsWithoutLocale,
  countValuesInColumns,
  countValuesByLocale,
  queryRows,
} from "../../schema/pipeline/classifier/count-helpers";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import { fieldsJoiningTranslation } from "./field-joins-translation";
import {
  type LeavingFieldLike,
  refusalsForFieldsLeavingTranslation,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { chosenLocaleOf, copyLiveness } from "./generate-down";
import { refusalsForConstrainedFieldsLeaving } from "./leaving-constraint-preconditions";
import { fieldsLeavingTranslation } from "./reconcile-companion";

/** One field leaving translation, as the preview reports it. */
export interface LeavingTranslationPreview {
  /** The field's name. */
  name: string;
  /**
   * Its column, which is how the classifier's prompts name it: a field `metaTitle` is stored as
   * `meta_title`.
   */
  column: string;
  /**
   * How many values move to the archive, by language. A language with none is absent. Null when
   * they could not be counted: the archive still takes them at Apply, so the preview says it does
   * not know rather than that there are none.
   */
  byLocale: Record<string, number> | null;
  /** The sum of `byLocale`, or null with it. */
  total: number | null;
  /**
   * How many entries have no row in the default language, and so keep another language's value as
   * the shared one: the first language by code. Null when it could not be counted.
   */
  entriesWithoutDefault: number | null;
  /**
   * The entries whose shared value comes from a language other than the default one, by that
   * language: what their default-language readers will see instead. With `byLocale`, whose
   * languages' readers will see the shared value, it names every reader whose page changes. Null
   * when it could not be counted.
   */
  sharedFrom: Record<string, number> | null;
  /** The language whose value becomes the shared one where it is live, and so is not archived. */
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
  /**
   * The site's languages in its order and whether each language publishes on its own: they decide
   * the language each entry's shared value comes from, as the apply decides it (`copyLiveness`).
   */
  languageOrder?: readonly string[];
  companionHasStatus?: boolean;
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

  const shapeRefusals = refusalsForFieldsLeavingTranslation({
    leaving: new Set(leaving),
    newFields: args.newFields,
    oldFields: args.oldFields,
    dialect: args.dialect,
    builtBy: args.builtBy,
    surface: "builder",
  });
  const refusals = new Map(
    [
      ...shapeRefusals,
      ...(await valueRefusals(
        args,
        leaving.filter(
          name => !shapeRefusals.some(r => r.path === `fields.${name}`)
        )
      )),
    ].map(refusal => [
      refusal.path.replace(/^fields\./, ""),
      { reason: refusal.reason, steps: refusal.steps },
    ])
  );

  const fields = args.oldFields
    .filter(f => leaving.includes(f.name))
    .flatMap(field => {
      const spec = fieldToLocalizedColumnSpec(
        field,
        args.dialect,
        args.builtBy
      );
      return spec ? [{ field, column: spec.name }] : [];
    });
  // Counted once for every field the change can apply to; a refused field's values move nowhere.
  const counted = fields
    .filter(({ field }) => !refusals.has(field.name))
    .map(({ column }) => column);
  const counts = await countsOf(args, counted);

  return fields.map(({ field, column }) => {
    const refusal = refusals.get(field.name);
    const byLocale =
      counts === null ? null : (counts.byColumn.get(column) ?? {});
    return {
      name: field.name,
      column,
      byLocale,
      total:
        byLocale === null
          ? null
          : Object.values(byLocale).reduce((sum, n) => sum + n, 0),
      entriesWithoutDefault: counts?.withoutDefault ?? null,
      sharedFrom: counts?.sharedFrom ?? null,
      defaultLocale: args.defaultLocale,
      restoreCommand: `nextly i18n:restore --collection ${args.slug} --field ${field.name}`,
      ...(refusal !== undefined ? { refusal } : {}),
    };
  });
}

/**
 * What Apply will refuse because the values cannot take a Required or Unique setting, asked as
 * Apply asks it (`refusalsForConstrainedFieldsLeaving`). None when they could not be read: Apply
 * asks again before anything runs, and refuses then.
 */
async function valueRefusals(args: PreviewLeavingArgs, leaving: string[]) {
  try {
    return await refusalsForConstrainedFieldsLeaving({
      adapter: {
        executeQuery: text => queryRows(args.db, args.dialect, text),
      },
      dialect: args.dialect,
      tableName: args.tableName,
      builtBy: args.builtBy,
      defaultLocale: args.defaultLocale,
      // The values Apply judges: the ones its copy keeps.
      liveness: copyLiveness(args.languageOrder, args.companionHasStatus),
      leaving: new Set(leaving),
      oldFields: args.oldFields,
      newFields: args.newFields,
      surface: "builder",
    });
  } catch {
    return [];
  }
}

/**
 * The counts the preview shows, or null when the database could not give them: a companion that
 * has drifted, or a read refused. The counts inform; the archive write at Apply is what keeps the
 * values, and it refuses on its own if it cannot.
 */
async function countsOf(
  args: PreviewLeavingArgs,
  columns: readonly string[]
): Promise<{
  byColumn: Map<string, Record<string, number>>;
  withoutDefault: number;
  sharedFrom: Record<string, number>;
} | null> {
  const companion = `${args.tableName}_locales`;
  // The language an entry keeps, ranked as the apply ranks it (`chosenRowOrder`), so the counts
  // say what the apply will do.
  const keptLocaleOf = (parent: string) =>
    chosenLocaleOf(
      {
        dialect: args.dialect,
        companionTable: companion,
        defaultLocale: args.defaultLocale,
        liveness: copyLiveness(args.languageOrder, args.companionHasStatus),
      },
      parent
    );
  try {
    return {
      byColumn: await countValuesByLocale(
        args.db,
        args.dialect,
        companion,
        columns,
        args.defaultLocale,
        keptLocaleOf
      ),
      sharedFrom: await countEntriesByKeptLocale(
        args.db,
        args.dialect,
        companion,
        args.defaultLocale,
        keptLocaleOf
      ),
      withoutDefault: await countParentsWithoutLocale(
        args.db,
        args.dialect,
        companion,
        args.defaultLocale
      ),
    };
  } catch {
    return null;
  }
}

/** One field becoming translated, as the preview reports it. */
export interface JoiningTranslationPreview {
  /** The field's name. */
  name: string;
  /** Its column on the main table, which its values leave for the translations table. */
  column: string;
  /**
   * How many entries hold a value in it: each becomes the default language's value, and every
   * other language falls back to it until it is translated. Null when it could not be counted.
   */
  values: number | null;
  /** The language whose value each one becomes. */
  defaultLocale: string;
}

/**
 * The fields becoming translated in this change, with how many values each keeps as the default
 * language's. Nothing unless the entity is translated before and after the change, as for the
 * fields leaving it. A count that cannot be read is reported as unknown rather than failing the
 * preview: the counts inform, and the apply moves every value whatever they say.
 */
export async function previewFieldsJoiningTranslation(
  args: PreviewLeavingArgs
): Promise<JoiningTranslationPreview[]> {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const joining = new Set(
    fieldsJoiningTranslation(args.oldFields, args.newFields)
  );
  if (joining.size === 0) return [];
  const fields = args.newFields
    .filter(f => joining.has(f.name))
    .flatMap(field => {
      const spec = fieldToLocalizedColumnSpec(
        field,
        args.dialect,
        args.builtBy
      );
      return spec ? [{ field, column: spec.name }] : [];
    });
  const counts = await mainValueCounts(
    args,
    fields.map(({ column }) => column)
  );
  return fields.map(({ field, column }) => ({
    name: field.name,
    column,
    values: counts?.get(column) ?? null,
    defaultLocale: args.defaultLocale,
  }));
}

/** How many entries hold a value in each of `columns` on the main table. */
async function mainValueCounts(
  args: PreviewLeavingArgs,
  columns: readonly string[]
): Promise<Map<string, number> | null> {
  try {
    return await countValuesInColumns(
      args.db,
      args.dialect,
      args.tableName,
      columns
    );
  } catch {
    return null;
  }
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
  args: Omit<
    PreviewLeavingArgs,
    "wasLocalized" | "isLocalized" | "companionHasStatus"
  > & {
    entity: { localized?: unknown; status?: unknown };
    requestedLocalized: boolean | undefined;
  },
  rest: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { entity, requestedLocalized, ...common } = args;
  const wasLocalized = entity.localized === true;
  const judged = {
    ...common,
    // A translated Draft/Published entity's translations table holds each language's own state.
    companionHasStatus: wasLocalized && entity.status === true,
    wasLocalized,
    isLocalized: requestedLocalized ?? wasLocalized,
  };
  const leaving = await previewFieldsLeavingTranslation(judged);
  const joining = await previewFieldsJoiningTranslation(judged);
  const body = withLeavingTranslation(preview, leaving);
  // A field becoming translated is a change even when nothing else is, as one leaving it is.
  return joining.length > 0
    ? { ...body, hasChanges: true, joiningTranslation: joining, ...rest }
    : { ...body, ...rest };
}
