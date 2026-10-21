/**
 * A localized Single as it stands live, for the comparison that keeps a
 * publish from reverting a newer shared value: its main row and its
 * components, in the shape a version snapshot holds, and the fields every
 * language shares in it.
 *
 * One reader for the Single's three paths that compare (its publish, taking
 * the live values, and publishing every language), so they cannot come to
 * judge different documents.
 *
 * @module domains/singles/services/live-shared-single
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { fieldGroupSlugList } from "../../field-groups/storage/field-group-field-type";
import { sharedFieldNames } from "../../versions/shared-publish-base";
import {
  resolveComponentFieldMap,
  tagComponentTypes,
} from "../../versions/tag-component-types";

/**
 * Read the Single's live document under the row lock the caller holds.
 *
 * @param deserialize Puts the main row in read shape, as the Single's query
 *   service does for every read.
 * @param translated The fields its translations table holds.
 */
export async function liveSharedSingle(
  tx: TransactionContext,
  deps: {
    fieldGroupDataService?: FieldGroupDataService;
    deserialize: (row: Record<string, unknown>) => Record<string, unknown>;
  },
  args: {
    singleMeta: DynamicSingleRecord;
    entryId: string;
    locale: string | null;
    translated: ReadonlySet<string>;
  }
): Promise<{ live: Record<string, unknown>; shared: string[] }> {
  const { singleMeta, entryId } = args;
  const fields = singleMeta.fields;
  const service = deps.fieldGroupDataService;
  const executor = tx.getDrizzle();
  const row = await tx.selectOne<Record<string, unknown>>(
    singleMeta.tableName,
    { where: { and: [{ column: "id", op: "=", value: entryId }] } }
  );
  const componentFields = service
    ? await resolveComponentFieldMap(fields, slug =>
        service.getComponentFields(slug, executor)
      )
    : new Map<string, FieldConfig[]>();
  // Components live in tables of their own, tagged as a snapshot holds them.
  const components = tagComponentTypes(
    await readComponentSubtrees({
      fieldGroupDataService: service,
      tx,
      entryId,
      parentTable: singleMeta.tableName,
      fieldConfigs: fields,
      locale: args.locale ?? undefined,
      reason: "shared-publish-base-component-read",
      logContext: { single: singleMeta.slug },
    }),
    fields,
    slug => componentFields.get(slug)
  );
  const live = {
    ...deps.deserialize(convertTimestampsToCamelCase({ ...(row ?? {}) })),
    ...components,
  };
  // A component whose values are kept per language belongs to its language.
  const perLanguage = service
    ? await perLanguageFieldNames(fields, new Set(args.translated), slug =>
        service.isComponentLocalized(slug, executor)
      )
    : args.translated;
  return { live, shared: sharedFieldNames(fields, perLanguage, live) };
}

/**
 * The fields judged per language when every language is published: the
 * translated fields, and each field whose component is translated. A dynamic
 * zone counts when any type it permits is translated. References are read
 * through `fieldGroupSlugList`, so a definition stored under the migrated
 * `fieldGroup` / `fieldGroups` keys counts as the field-group saver sees it.
 */
export async function perLanguageFieldNames(
  fieldConfigs: readonly FieldConfig[],
  localizedFieldNames: ReadonlySet<string>,
  isComponentLocalized: (slug: string) => Promise<boolean>
): Promise<Set<string>> {
  const names = new Set(localizedFieldNames);
  for (const field of fieldConfigs) {
    if (!isFieldGroupField(field)) continue;
    for (const slug of fieldGroupSlugList(field)) {
      if (await isComponentLocalized(slug)) {
        names.add(field.name);
        break;
      }
    }
  }
  return names;
}
