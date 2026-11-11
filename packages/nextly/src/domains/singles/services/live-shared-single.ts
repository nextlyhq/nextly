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
import { addressableFields } from "../../../shared/addressable-fields";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { storedAtThisLevel } from "../../../shared/lib/field-level-registry";
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
  // The components placed directly in each, whose values are rows of their own.
  const fieldsOf = (slug: string) =>
    Promise.resolve(args.componentFields.get(slug) ?? null);
  const perLanguage = await perLanguageFieldNames(
    args.fields,
    args.translated,
    isLocalized,
    fieldsOf
  );
  const views = new Map<string, (value: unknown) => unknown>();
  const byHand = new Set<string>();
  const excluded = new Set(args.translated);
  for (const field of args.fields) {
    if (!field.name || args.translated.has(field.name)) continue;
    if (!perLanguage.has(field.name) || !isFieldGroupField(field)) continue;
    // Compared even with no shared sub-fields: its instances are shared, and
    // a publish writes the change's set of them over everyone's.
    views.set(
      field.name,
      await componentView(fieldGroupSlugList(field), {
        componentFields: args.componentFields,
        isLocalized,
        fieldsOf,
        open: new Set(),
      })
    );
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
 * A component's fields whose values its instance holds: those at the top of its fields, and those
 * in a group with no name, which only lays them out where it sits.
 */
function storedOnInstance(fields: readonly FieldConfig[]): FieldConfig[] {
  return addressableFields(fields, {
    descendInto: storedAtThisLevel,
  }) as FieldConfig[];
}

/** What projecting a component value to its shared parts reads. */
interface SharedProjection {
  componentFields: ReadonlyMap<string, FieldConfig[]>;
  isLocalized: (slug: string) => Promise<boolean>;
  fieldsOf: (slug: string) => Promise<readonly FieldConfig[] | null>;
  /** The component types being projected on this path, so one that holds itself ends it. */
  open: ReadonlySet<string>;
}

/**
 * A component value as its shared parts, instance by instance: each instance's type, in order, and
 * its shared sub-fields. Not its row id, which a publish rewrites.
 *
 * A sub-field is shared when the component is kept whole, or when a translated component marks it
 * shared. A component placed directly in it that holds values per language is a sub-field of the
 * same kind as the field itself: compared through its own shared parts, the same way, rather than
 * whole, since what it holds in one language is not another's to compare.
 */
async function componentView(
  slugs: readonly string[],
  projection: SharedProjection
): Promise<(value: unknown) => unknown> {
  const kept = new Map<
    string,
    Map<string, ((value: unknown) => unknown) | null>
  >();
  for (const slug of slugs) {
    const shared = await sharedSubFields(slug, projection);
    if (shared.size > 0) kept.set(slug, shared);
  }
  const instance = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value ?? null;
    const row = value as Record<string, unknown>;
    // Whichever spelling the row stores its type under.
    const type = readFieldGroupType(row) ?? slugs[0];
    const subs = type ? kept.get(type) : undefined;
    return {
      type: type ?? null,
      shared: Object.fromEntries(
        Object.entries(row).flatMap(([key, sub]) => {
          if (subs?.has(key) !== true) return [];
          const view = subs.get(key);
          return [[key, view ? view(sub) : sub]];
        })
      ),
    };
  };
  return value =>
    Array.isArray(value) ? value.map(instance) : instance(value);
}

/**
 * One component type's shared sub-fields, each with the view it is compared through: none for one
 * compared whole, and the shared-parts view of a component placed in it that holds values per
 * language. Empty when none.
 */
async function sharedSubFields(
  slug: string,
  projection: SharedProjection
): Promise<Map<string, ((value: unknown) => unknown) | null>> {
  const shared = new Map<string, ((value: unknown) => unknown) | null>();
  const translated = await projection.isLocalized(slug);
  const open = new Set([...projection.open, slug]);
  for (const sub of storedOnInstance(
    projection.componentFields.get(slug) ?? []
  )) {
    const name = sub.name;
    if (!name) continue;
    if (translated && isFieldLocalized({ ...sub, name }, true)) continue;
    const perLanguage =
      isFieldGroupField(sub) &&
      !fieldGroupSlugList(sub).some(inner => open.has(inner)) &&
      (
        await perLanguageFieldNames(
          [sub],
          new Set(),
          projection.isLocalized,
          projection.fieldsOf
        )
      ).has(name);
    shared.set(
      name,
      perLanguage
        ? await componentView(fieldGroupSlugList(sub), { ...projection, open })
        : null
    );
  }
  return shared;
}

// Which fields hold values per language is one question with one answer, and
// the collection paths ask it as well, so it is kept beside the rest of the
// language code. Re-exported here, where this reader first held it.
export { perLanguageFieldNames };
