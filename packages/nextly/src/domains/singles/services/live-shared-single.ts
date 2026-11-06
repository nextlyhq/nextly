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
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { perLanguageFieldNames } from "../../i18n/per-language-fields";
import {
  asIdSet,
  sharedFieldNames,
  type SharedViews,
} from "../../versions/shared-publish-base";
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
): Promise<SharedComparison & { live: Record<string, unknown> }> {
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
  return {
    live,
    ...(await sharedComparison({
      fields,
      translated: args.translated,
      document: live,
      componentFields,
      isComponentLocalized: slug =>
        service
          ? service.isComponentLocalized(slug, executor)
          : Promise.resolve(false),
    })),
  };
}

/**
 * A document's shared fields as the comparison judges them: their names, the
 * view some are compared through, and those no take of the live values copies.
 */
export interface SharedComparison {
  shared: string[];
  views: SharedViews;
  byHand: ReadonlySet<string>;
}

/**
 * Which of a localized document's fields every language shares, and how each
 * is compared.
 *
 * - A translated field belongs to its language.
 * - A component kept per language belongs to its language too, except for its
 *   instances (how many, of which type, in which order) and the sub-fields it
 *   marks shared, which every language shares: the field is compared through
 *   those alone, and left for the editor to copy by hand, since a take cannot
 *   match its instances to the change's safely.
 * - A junction's ids are compared as a set: a junction keeps no order.
 *
 * Whether a component is translated is asked once per distinct component the
 * fields reference, however many fields reference it.
 *
 * @param componentFields Each referenced component's fields, by slug.
 * @param unordered The fields kept in a junction.
 */
export async function sharedComparison(args: {
  fields: readonly FieldConfig[];
  translated: ReadonlySet<string>;
  document: Record<string, unknown>;
  componentFields: ReadonlyMap<string, FieldConfig[]>;
  isComponentLocalized: (slug: string) => Promise<boolean>;
  unordered?: readonly string[];
}): Promise<SharedComparison> {
  const asked = new Map<string, Promise<boolean>>();
  const isLocalized = (slug: string): Promise<boolean> => {
    let answer = asked.get(slug);
    if (!answer) {
      answer = args.isComponentLocalized(slug);
      asked.set(slug, answer);
    }
    return answer;
  };
  const perLanguage = await perLanguageFieldNames(
    args.fields,
    args.translated,
    isLocalized
  );
  const views = new Map<string, (value: unknown) => unknown>();
  const byHand = new Set<string>();
  const excluded = new Set(args.translated);
  for (const field of args.fields) {
    if (!field.name || args.translated.has(field.name)) continue;
    if (!perLanguage.has(field.name) || !isFieldGroupField(field)) continue;
    const kept = await sharedSubFields(
      field,
      args.componentFields,
      isLocalized
    );
    // Compared even with no shared sub-fields: its instances are shared, and
    // a publish writes the change's set of them over everyone's.
    views.set(field.name, componentView(kept, fieldGroupSlugList(field)[0]));
    byHand.add(field.name);
  }
  for (const name of args.unordered ?? []) views.set(name, asIdSet);
  return {
    shared: sharedFieldNames(args.fields, excluded, args.document),
    views,
    byHand,
  };
}

/**
 * Each component type's shared sub-fields: every field of a component kept
 * whole, and those a translated component marks shared. Empty when none.
 */
async function sharedSubFields(
  field: FieldConfig,
  componentFields: ReadonlyMap<string, FieldConfig[]>,
  isLocalized: (slug: string) => Promise<boolean>
): Promise<Map<string, Set<string>>> {
  const kept = new Map<string, Set<string>>();
  for (const slug of fieldGroupSlugList(field)) {
    const translated = await isLocalized(slug);
    const names = (componentFields.get(slug) ?? []).flatMap(sub => {
      const name = sub.name;
      if (!name) return [];
      return translated && isFieldLocalized({ ...sub, name }, true)
        ? []
        : [name];
    });
    if (names.length > 0) kept.set(slug, new Set(names));
  }
  return kept;
}

/**
 * A component value as its shared parts, instance by instance: each
 * instance's type, in order, and its shared sub-fields. Not its row id, which
 * a publish rewrites.
 */
function componentView(
  kept: ReadonlyMap<string, ReadonlySet<string>>,
  onlySlug: string | undefined
): (value: unknown) => unknown {
  const instance = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value ?? null;
    const row = value as Record<string, unknown>;
    // Whichever spelling the row stores its type under.
    const type = readFieldGroupType(row) ?? onlySlug;
    const names = type ? kept.get(type) : undefined;
    return {
      type: type ?? null,
      shared: Object.fromEntries(
        Object.entries(row).filter(([key]) => names?.has(key) === true)
      ),
    };
  };
  return value =>
    Array.isArray(value) ? value.map(instance) : instance(value);
}

// Which fields hold values per language is one question with one answer, and
// the collection paths ask it as well, so it is kept beside the rest of the
// language code. Re-exported here, where this reader first held it.
export { perLanguageFieldNames };
